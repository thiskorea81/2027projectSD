// DB 마이그레이션 실행: db/migrations/*.sql 을 이름 순서대로, 아직 적용 안 된 것만 실행합니다.
//   node scripts/migrate.ts
// 개발용 컨테이너는 시작할 때 자동으로 실행합니다(docker/dev-entrypoint.sh).
// 여러 컨테이너가 동시에 시작해도 advisory lock 으로 한 번만 적용됩니다.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const DIR = new URL("../db/migrations/", import.meta.url).pathname;
const LOCK_KEY = 2027_0001;

export async function migrate(connectionString = process.env.DATABASE_URL) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set(
      (await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name as string),
    );
    const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
    let applied = 0;
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`[migrate] ${file} 적용 실패: ${(err as Error).message}`);
      }
      console.log(`[migrate] 적용: ${file}`);
      applied++;
    }
    if (applied === 0) console.log("[migrate] 새로 적용할 마이그레이션 없음");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
