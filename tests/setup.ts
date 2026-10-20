// Runs before every test file (bunfig.toml). Gives the tests a real Postgres and applies the migrations.
//
// - TEST_DATABASE_URL set (CI, or a local Postgres): use it. Only localhost is accepted so a test run can
//   never touch a real database by mistake.
// - Otherwise: start PGlite (Postgres compiled to WASM) inside this process behind a throw-away TCP port.
//   Nothing is installed or left running.
import { createServer } from "net";
import { resolve } from "path";
import { afterAll } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "../src/lib/migrate";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "test-secret-test-secret-test-secret-1234";
process.env.DB_SSL = "disable";

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => ok(port));
    });
  });
}

let stop: (() => Promise<void>) | null = null;
let url = process.env.TEST_DATABASE_URL;

if (url) {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`TEST_DATABASE_URL must point at localhost, got "${host}"`);
  }
} else {
  const { PGlite } = await import("@electric-sql/pglite");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
  const db = await PGlite.create({ extensions: { pgcrypto } });
  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 10 });
  await server.start();
  url = `postgres://postgres@127.0.0.1:${port}/postgres`;
  stop = async () => { await server.stop(); await db.close(); };
}

process.env.DATABASE_URL = url;

const admin = postgres(url, { max: 1, onnotice: () => {} });
await runMigrations(admin, resolve(import.meta.dir, "../migrations"), () => {});
await admin.end();

afterAll(async () => {
  if (stop) await stop();
});
