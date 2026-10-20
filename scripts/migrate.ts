import { resolve } from "path";
import postgres from "postgres";
import { runMigrations } from "../src/lib/migrate";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sslEnv = process.env.DB_SSL ?? "prefer";
const ssl = sslEnv === "disable" ? false : (sslEnv as "prefer" | "require");
const sql = postgres(process.env.DATABASE_URL, { ssl, max: 1, onnotice: () => {} });

try {
  await runMigrations(sql, resolve(import.meta.dir, "../migrations"));
  console.log("Migrations up to date.");
} catch (err: any) {
  console.error("Migration failed:", err.message);
  process.exit(1);
} finally {
  await sql.end();
}
