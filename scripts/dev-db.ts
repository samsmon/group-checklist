// A throw-away Postgres for local development, no installation needed: PGlite (Postgres compiled to
// WASM) behind a TCP port, with the migrations applied. Data is kept in ./.dev-db between runs;
// pass --memory to start empty every time.
//
//   bun run dev:db            # prints the DATABASE_URL, then keeps running
//   DATABASE_URL=... DB_SSL=disable JWT_SECRET=... bun run dev
import { resolve } from "path";
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { runMigrations } from "../src/lib/migrate";

const port = Number(process.env.DEV_DB_PORT) || 5433;
const memory = process.argv.includes("--memory");
const dataDir = resolve(import.meta.dir, "../.dev-db");

const db = await PGlite.create({ dataDir: memory ? undefined : dataDir, extensions: { pgcrypto } });
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 10 });
await server.start();

const url = `postgres://postgres@127.0.0.1:${port}/postgres`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
await runMigrations(admin, resolve(import.meta.dir, "../migrations"));
await admin.end();

console.log(`\nDev database ready (${memory ? "in memory" : "stored in .dev-db"}).`);
console.log(`DATABASE_URL=${url}\nDB_SSL=disable\n`);

const stop = async () => { await server.stop(); await db.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
