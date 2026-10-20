import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import type postgres from "postgres";

// Applies every migrations/*.sql file once, in name order, and records it in schema_migrations.
// A database created before this runner existed (it already has `users`) gets the first file marked as applied.
export async function runMigrations(
  sql: postgres.Sql,
  dir: string,
  log: (message: string) => void = console.log
): Promise<string[]> {
  const files = readdirSync(dir).filter((f) => /^\d+.*\.sql$/.test(f)).sort();

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const applied = new Set((await sql`SELECT name FROM schema_migrations`).map((r) => r.name as string));

  if (applied.size === 0 && files[0]) {
    const [{ exists }] = await sql<{ exists: boolean }[]>`
      SELECT to_regclass('public.users') IS NOT NULL AS exists
    `;
    if (exists) {
      await sql`INSERT INTO schema_migrations (name) VALUES (${files[0]})`;
      applied.add(files[0]);
      log(`Existing schema detected, marked ${files[0]} as applied.`);
    }
  }

  const done: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const content = readFileSync(resolve(dir, file), "utf-8");
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    done.push(file);
    log(`Applied ${file}`);
  }
  return done;
}
