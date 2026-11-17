import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { loginSchema, passwordSchema, setupSchema, userInputSchema, type User } from '../shared/auth.ts';
import { HttpError, transaction } from './store.ts';

declare global {
  namespace Express {
    interface Request { authUser: User; sessionHash: string }
  }
}

const cookieName = 'inquiry_session';
const sessionDuration = 7 * 24 * 60 * 60 * 1000;
const scryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const userColumns = 'id, username, display_name AS displayName, role, enabled, created_at AS createdAt';
type UserRow = Omit<User, 'enabled'> & { enabled: number };

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64, scryptOptions).toString('hex')}`;
}

function matchesPassword(password: string, stored: string) {
  const parts = stored.split(':');
  return timingSafeEqual(scryptSync(password, parts[0], 64, scryptOptions), Buffer.from(parts[1], 'hex'));
}

function readUser(db: DatabaseSync, id: string): User {
  const row = db.prepare(`SELECT ${userColumns} FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  if (!row) throw new HttpError(404, '用户不存在');
  return { ...row, enabled: row.enabled === 1 };
}

function readSession(db: DatabaseSync, req: Request) {
  const token = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const row = db.prepare(`SELECT sessions.user_id FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE token_hash = ? AND expires_at > ? AND users.enabled = 1`).get(tokenHash, Date.now()) as { user_id: string } | undefined;
  if (!row) return null;
  return { user: readUser(db, row.user_id), tokenHash };
}

function startSession(db: DatabaseSync, req: Request, res: Response, userId: string) {
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(createHash('sha256').update(token).digest('hex'), userId, Date.now() + sessionDuration);
  res.cookie(cookieName, token, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/', maxAge: sessionDuration });
}

function insertUser(db: DatabaseSync, input: z.infer<typeof userInputSchema>) {
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(input.username)) throw new HttpError(409, '用户名已存在');
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, input.username, input.displayName, hashPassword(input.password), input.role, new Date().toISOString());
  return readUser(db, id);
}

export function authRouter(db: DatabaseSync) {
  const router = Router();
  const loginAttempts = new Map<string, { count: number; until: number }>();

  router.get('/auth/session', (req, res) => {
    res.json({ setupRequired: !db.prepare('SELECT id FROM users LIMIT 1').get(), user: readSession(db, req)?.user ?? null });
  });

  router.post('/auth/setup', (req, res) => {
    const input = setupSchema.parse(req.body);
    const user = transaction(db, () => {
      if (db.prepare('SELECT id FROM users LIMIT 1').get()) throw new HttpError(409, '管理员已创建，请登录');
      return insertUser(db, { ...input, role: 'admin' });
    });
    startSession(db, req, res, user.id);
    res.status(201).json(user);
  });

  router.post('/auth/login', (req, res) => {
    const input = loginSchema.parse(req.body);
    for (const [address, attempt] of loginAttempts) {
      if (attempt.until <= Date.now()) loginAttempts.delete(address);
    }
    const address = req.ip!;
    const attempt = loginAttempts.get(address);
    if (attempt && attempt.count >= 10) {
      res.set('Retry-After', String(Math.ceil((attempt.until - Date.now()) / 1000)));
      throw new HttpError(429, '登录失败次数过多，请 15 分钟后再试');
    }
    const row = db.prepare('SELECT id, password_hash, enabled FROM users WHERE username = ?').get(input.username) as
      { id: string; password_hash: string; enabled: number } | undefined;
    if (!row || !matchesPassword(input.password, row.password_hash) || row.enabled !== 1) {
      loginAttempts.set(address, { count: (attempt?.count ?? 0) + 1, until: attempt?.until ?? Date.now() + 15 * 60 * 1000 });
      throw new HttpError(401, '用户名或密码错误，或账号已停用');
    }
    loginAttempts.delete(address);
    const previous = readSession(db, req);
    if (previous) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(previous.tokenHash);
    startSession(db, req, res, row.id);
    res.json(readUser(db, row.id));
  });

  router.use((req, _res, next) => {
    const session = readSession(db, req);
    if (!session) throw new HttpError(401, '请先登录');
    req.authUser = session.user;
    req.sessionHash = session.tokenHash;
    next();
  });

  router.post('/auth/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
    res.clearCookie(cookieName, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/' });
    res.json({ ok: true });
  });

  router.post('/auth/password', (req, res) => {
    const input = z.object({ currentPassword: passwordSchema, password: passwordSchema }).parse(req.body);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.authUser.id) as { password_hash: string };
    if (!matchesPassword(input.currentPassword, row.password_hash)) throw new HttpError(400, '当前密码不正确');
    transaction(db, () => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(input.password), req.authUser.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.authUser.id);
    });
    res.clearCookie(cookieName, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/' });
    res.json({ ok: true });
  });

  router.use('/users', (req, _res, next) => {
    if (req.authUser.role !== 'admin') throw new HttpError(403, '仅管理员可管理用户');
    next();
  });

  router.get('/users', (_req, res) => {
    res.json((db.prepare(`SELECT ${userColumns} FROM users ORDER BY created_at, id`).all() as UserRow[])
      .map(row => ({ ...row, enabled: row.enabled === 1 })));
  });

  router.post('/users', (req, res) => {
    res.status(201).json(insertUser(db, userInputSchema.parse(req.body)));
  });

  router.patch('/users/:id', (req, res) => {
    const input = z.object({ enabled: z.boolean() }).parse(req.body);
    const user = readUser(db, req.params.id);
    if (!input.enabled && user.id === req.authUser.id) throw new HttpError(400, '不能停用自己的账号');
    transaction(db, () => {
      db.prepare('UPDATE users SET enabled = ? WHERE id = ?').run(Number(input.enabled), user.id);
      if (!input.enabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    });
    res.json({ ...user, enabled: input.enabled });
  });

  router.post('/users/:id/password', (req, res) => {
    const input = z.object({ password: passwordSchema }).parse(req.body);
    const user = readUser(db, req.params.id);
    if (user.id === req.authUser.id) throw new HttpError(400, '请通过修改密码更改自己的密码');
    transaction(db, () => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(input.password), user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    });
    res.json({ ok: true });
  });

  return router;
}
