import { Pool } from "pg";

// 개발 중 핫리로드로 Pool 이 여러 번 생기지 않도록 전역에 보관합니다.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

export const pool =
  globalForDb.pgPool ??
  new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;
