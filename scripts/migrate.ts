import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sslEnv = process.env.DB_SSL ?? "prefer";
const ssl = sslEnv === "disable" ? false : (sslEnv as "prefer" | "require");
const sql = postgres(process.env.DATABASE_URL, { ssl, max: 1, onnotice: () => {} });

const dir = resolve(import.meta.dir, "../migrations");
const files = readdirSync(dir).filter((f) => /^\d+.*\.sql$/.test(f)).sort();

try {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const applied = new Set((await sql`SELECT name FROM schema_migrations`).map((r) => r.name));

  // Databases created before this runner existed already have the 001 schema.
  if (applied.size === 0 && files[0]) {
    const [{ exists }] = await sql<{ exists: boolean }[]>`
      SELECT to_regclass('public.users') IS NOT NULL AS exists
    `;
    if (exists) {
      await sql`INSERT INTO schema_migrations (name) VALUES (${files[0]})`;
      applied.add(files[0]);
      console.log(`Existing schema detected, marked ${files[0]} as applied.`);
    }
  }

  for (const file of files) {
    if (applied.has(file)) continue;
    const content = readFileSync(resolve(dir, file), "utf-8");
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    console.log(`Applied ${file}`);
  }

  console.log("Migrations up to date.");
} catch (err: any) {
  console.error("Migration failed:", err.message);
  process.exit(1);
} finally {
  await sql.end();
}
