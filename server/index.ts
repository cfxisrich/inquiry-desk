import { z } from 'zod';
import { createDatabase } from './db.ts';
import { createApp } from './app.ts';

const env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4311),
  DATABASE_PATH: z.string().min(1).default('./data/inquiry.sqlite'),
  COMPANY_NAME: z.string().trim().min(1).default('我的公司'),
  AI_BASE_URL: z.url().default('https://api.openai.com/v1'),
  AI_API_KEY: z.string().default(''),
  AI_MODEL: z.string().default(''),
}).parse(process.env);

const db = createDatabase(env.DATABASE_PATH);
const server = createApp(db, {
  companyName: env.COMPANY_NAME,
  aiBaseUrl: env.AI_BASE_URL,
  aiApiKey: env.AI_API_KEY,
  aiModel: env.AI_MODEL,
}).listen(env.PORT, '127.0.0.1', (error?: Error) => {
  if (error) {
    console.error(`服务启动失败：${error.message}`);
    db.close();
    process.exitCode = 1;
    return;
  }
  console.log(`询报价服务已启动 http://127.0.0.1:${env.PORT}`);
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
