import { z } from 'zod';

export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,40}$/, '用户名需为 3–40 位字母、数字、下划线、点或短横线');
export const passwordSchema = z.string().min(8, '密码至少 8 位').max(128, '密码最多 128 位');
export const loginSchema = z.object({ username: usernameSchema, password: passwordSchema });
export const setupSchema = loginSchema.extend({ displayName: z.string().trim().min(1, '请输入姓名').max(80) });
export const userInputSchema = setupSchema.extend({ role: z.enum(['admin', 'member']) });

export type User = Omit<z.infer<typeof userInputSchema>, 'password'> & {
  id: string; enabled: boolean; createdAt: string;
};
export type SessionState = { setupRequired: boolean; user: User | null };
