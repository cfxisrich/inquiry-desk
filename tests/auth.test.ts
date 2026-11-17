import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { createApp } from '../server/app.ts';
import { createDatabase } from '../server/db.ts';
import type { SessionState, User } from '../shared/auth.ts';
import type { AppState } from '../shared/domain.ts';

const adminInput = { username: 'admin', displayName: '管理员', password: 'admin-password-123' };
const memberInput = { username: 'member', displayName: '业务员', password: 'member-password-123', role: 'member' };

async function startApp(t: TestContext, path = ':memory:') {
  const db = createDatabase(path);
  const server = createApp(db, { companyName: '测试公司', aiBaseUrl: '', aiApiKey: '', aiModel: '' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  });
  return {
    db,
    async call<T>(path: string, method = 'GET', body?: unknown, cookie = '', requestHeader = true) {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(requestHeader ? { 'X-Inquiry-Request': '1' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        body: await response.json() as T,
        cookie: response.headers.getSetCookie()[0]?.split(';')[0] ?? '',
        headers: response.headers,
      };
    },
  };
}

test('首次创建管理员后关闭初始化入口，未登录不能读取或修改业务', async t => {
  const app = await startApp(t);
  assert.deepEqual((await app.call<SessionState>('/auth/session')).body, { setupRequired: true, user: null });
  assert.equal((await app.call('/auth/setup', 'POST', adminInput, '', false)).status, 403);
  assert.equal((await app.call('/auth/setup', 'POST', { ...adminInput, password: 'short' })).status, 400);
  for (const [path, method] of [['/state', 'GET'], ['/products', 'POST'], ['/products/id', 'PUT'], ['/products/import', 'POST'], ['/inquiries', 'POST'], ['/inquiries/id/status', 'PATCH'], ['/quotes', 'POST'], ['/quotes/id/sent', 'POST'], ['/followups', 'POST'], ['/demo', 'POST'], ['/users', 'GET']]) {
    assert.equal((await app.call(path, method, method === 'GET' ? undefined : {})).status, 401, path);
  }
  const setup = await app.call<User>('/auth/setup', 'POST', { ...adminInput, username: ' Admin ' });
  assert.equal(setup.status, 201);
  assert.equal(setup.body.username, 'admin');
  assert.equal(setup.body.role, 'admin');
  assert.equal(setup.body.enabled, true);
  assert.deepEqual(Object.keys(setup.body).sort(), ['createdAt', 'displayName', 'enabled', 'id', 'role', 'username']);
  assert.match(setup.headers.get('set-cookie')!, /HttpOnly/i);
  assert.match(setup.headers.get('set-cookie')!, /SameSite=Strict/i);
  assert.match(setup.headers.get('set-cookie')!, /Path=\//i);
  assert.deepEqual((await app.call<SessionState>('/auth/session', 'GET', undefined, setup.cookie)).body, { setupRequired: false, user: setup.body });
  assert.equal((await app.call('/state', 'GET', undefined, setup.cookie)).status, 200);
  assert.equal((await app.call('/auth/setup', 'POST', { ...adminInput, username: 'another' })).status, 409);
  const stored = app.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(setup.body.id) as { password_hash: string };
  assert.ok(!stored.password_hash.includes(adminInput.password));
  const token = setup.cookie.split('=')[1];
  assert.equal((app.db.prepare('SELECT token_hash FROM sessions').get() as { token_hash: string }).token_hash, createHash('sha256').update(token).digest('hex'));
});

test('普通用户可操作共享业务，但不能管理账号，用户接口不暴露密码', async t => {
  const app = await startApp(t);
  const admin = await app.call<User>('/auth/setup', 'POST', adminInput);
  const member = await app.call<User>('/users', 'POST', memberInput, admin.cookie);
  assert.equal(member.status, 201);
  assert.equal((await app.call('/users', 'POST', { ...memberInput, username: 'MEMBER' }, admin.cookie)).status, 409);
  assert.equal((await app.call('/users', 'POST', { ...memberInput, username: 'second', role: 'owner' }, admin.cookie)).status, 400);
  const session = await app.call<User>('/auth/login', 'POST', memberInput);
  assert.equal(session.status, 200);
  assert.equal((await app.call('/state', 'GET', undefined, session.cookie)).status, 200);
  const created = await app.call('/products', 'POST', { sku: 'TEST', name: '轴承', specification: '', unit: '件', priceCents: 100 }, session.cookie);
  assert.equal(created.status, 201);
  assert.equal((await app.call<AppState>('/state', 'GET', undefined, admin.cookie)).body.products.length, 1);
  for (const [path, method, body] of [
    ['/users', 'GET', undefined],
    ['/users', 'POST', { ...memberInput, username: 'other' }],
    [`/users/${admin.body.id}`, 'PATCH', { enabled: false }],
    [`/users/${admin.body.id}/password`, 'POST', { password: 'replacement-password' }],
  ] as const) {
    assert.equal((await app.call(path, method, body, session.cookie)).status, 403);
  }
  const users = (await app.call<User[]>('/users', 'GET', undefined, admin.cookie)).body;
  assert.equal(users.length, 2);
  for (const user of users) assert.deepEqual(Object.keys(user).sort(), ['createdAt', 'displayName', 'enabled', 'id', 'role', 'username']);
  assert.equal((await app.call(`/users/${admin.body.id}`, 'PATCH', { enabled: false }, admin.cookie)).status, 400);
  assert.equal((await app.call(`/users/${admin.body.id}/password`, 'POST', { password: 'new-password-123' }, admin.cookie)).status, 400);
});

test('登录验证密码，退出和会话过期后业务接口拒绝访问', async t => {
  const app = await startApp(t);
  const admin = await app.call<User>('/auth/setup', 'POST', adminInput);
  assert.equal((await app.call('/auth/login', 'POST', { ...adminInput, password: 'wrong-password' })).status, 401);
  assert.equal((await app.call('/auth/login', 'POST', { ...adminInput, username: 'missing' })).status, 401);
  assert.equal((await app.call('/auth/logout', 'POST', {}, admin.cookie)).status, 200);
  assert.equal((await app.call('/state', 'GET', undefined, admin.cookie)).status, 401);
  const loggedIn = await app.call<User>('/auth/login', 'POST', { ...adminInput, username: 'ADMIN' });
  assert.equal(loggedIn.status, 200);
  assert.notEqual(loggedIn.cookie, admin.cookie);
  app.db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1);
  assert.equal((await app.call('/state', 'GET', undefined, loggedIn.cookie)).status, 401);
  assert.deepEqual((await app.call<SessionState>('/auth/session', 'GET', undefined, loggedIn.cookie)).body, { setupRequired: false, user: null });
});

test('停用撤销用户所有会话，重新启用后旧会话仍无效', async t => {
  const app = await startApp(t);
  const admin = await app.call<User>('/auth/setup', 'POST', adminInput);
  const member = await app.call<User>('/users', 'POST', memberInput, admin.cookie);
  const first = await app.call('/auth/login', 'POST', memberInput);
  const second = await app.call('/auth/login', 'POST', memberInput);
  const disabled = await app.call<User>(`/users/${member.body.id}`, 'PATCH', { enabled: false }, admin.cookie);
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.enabled, false);
  for (const cookie of [first.cookie, second.cookie]) assert.equal((await app.call('/state', 'GET', undefined, cookie)).status, 401);
  assert.equal((await app.call('/auth/login', 'POST', memberInput)).status, 401);
  assert.equal((await app.call(`/users/${member.body.id}`, 'PATCH', { enabled: true }, admin.cookie)).status, 200);
  for (const cookie of [first.cookie, second.cookie]) assert.equal((await app.call('/state', 'GET', undefined, cookie)).status, 401);
  assert.equal((await app.call('/auth/login', 'POST', memberInput)).status, 200);
});

test('重置与自行修改密码撤销全部会话，新密码才可再次登录', async t => {
  const app = await startApp(t);
  const admin = await app.call<User>('/auth/setup', 'POST', adminInput);
  const member = await app.call<User>('/users', 'POST', memberInput, admin.cookie);
  const first = await app.call('/auth/login', 'POST', memberInput);
  const second = await app.call('/auth/login', 'POST', memberInput);
  assert.equal((await app.call(`/users/${member.body.id}/password`, 'POST', { password: 'reset-password-123' }, admin.cookie)).status, 200);
  for (const cookie of [first.cookie, second.cookie]) assert.equal((await app.call('/state', 'GET', undefined, cookie)).status, 401);
  assert.equal((await app.call('/auth/login', 'POST', memberInput)).status, 401);
  const reset = await app.call('/auth/login', 'POST', { ...memberInput, password: 'reset-password-123' });
  const other = await app.call('/auth/login', 'POST', { ...memberInput, password: 'reset-password-123' });
  assert.equal(reset.status, 200);
  assert.equal((await app.call('/auth/password', 'POST', { currentPassword: 'wrong-password', password: 'changed-password-123' }, reset.cookie)).status, 400);
  assert.equal((await app.call('/state', 'GET', undefined, reset.cookie)).status, 200);
  assert.equal((await app.call('/auth/password', 'POST', { currentPassword: 'reset-password-123', password: 'changed-password-123' }, reset.cookie)).status, 200);
  for (const cookie of [reset.cookie, other.cookie]) assert.equal((await app.call('/state', 'GET', undefined, cookie)).status, 401);
  assert.equal((await app.call('/auth/login', 'POST', { ...memberInput, password: 'reset-password-123' })).status, 401);
  assert.equal((await app.call('/auth/login', 'POST', { ...memberInput, password: 'changed-password-123' })).status, 200);
  assert.equal((await app.call('/state', 'GET', undefined, admin.cookie)).status, 200);
});

test('旧数据库升级保留商品，管理员和会话在重启后仍可用', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'inquiry-auth-test-'));
  const databasePath = join(directory, 'inquiry.sqlite');
  t.after(() => rmSync(directory, { recursive: true }));
  const legacy = new DatabaseSync(databasePath);
  legacy.exec('CREATE TABLE products (id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, data TEXT NOT NULL CHECK (json_valid(data))) STRICT');
  legacy.prepare('INSERT INTO products (id, sku, data) VALUES (?, ?, ?)').run('old-product', 'OLD', JSON.stringify({ id: 'old-product', sku: 'OLD', name: '既有商品', specification: '', unit: '件', priceCents: 200, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }));
  legacy.close();
  const session = { cookie: '' };
  await t.test('升级并初始化管理员', async t => {
    const app = await startApp(t, databasePath);
    const setup = await app.call<User>('/auth/setup', 'POST', adminInput);
    assert.equal(setup.status, 201);
    session.cookie = setup.cookie;
    assert.equal((await app.call<AppState>('/state', 'GET', undefined, setup.cookie)).body.products[0].name, '既有商品');
  });
  await t.test('重启后直接使用已保存的会话', async t => {
    const app = await startApp(t, databasePath);
    const state = (await app.call<SessionState>('/auth/session', 'GET', undefined, session.cookie)).body;
    assert.equal(state.setupRequired, false);
    assert.equal(state.user?.username, 'admin');
    assert.equal((await app.call<AppState>('/state', 'GET', undefined, session.cookie)).body.products[0].sku, 'OLD');
    assert.equal((await app.call('/auth/login', 'POST', adminInput)).status, 200);
  });
});

test('连续十次登录失败后限制继续尝试', async t => {
  const app = await startApp(t);
  await app.call('/auth/setup', 'POST', adminInput);
  for (const attempt of Array.from({ length: 10 }, (_, index) => index)) {
    assert.equal((await app.call('/auth/login', 'POST', { ...adminInput, password: 'wrong-password' })).status, 401, `第 ${attempt + 1} 次`);
  }
  const limited = await app.call('/auth/login', 'POST', adminInput);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});
