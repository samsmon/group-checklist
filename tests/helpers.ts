import server from "../src/index";
import sql from "../src/db";

export { sql };

let ipCounter = 0;

export type Session = { cookie: string; id: string; username: string; ip: string };

// Calls the app in-process (no network). Every session gets its own fake client IP so the per-IP
// rate limits (register 5/hour, writes 120/min) do not interfere between tests.
export async function api(
  method: string,
  path: string,
  opts: { body?: unknown; session?: Session | null; ip?: string; raw?: boolean } = {}
): Promise<{ status: number; json: any; headers: Headers }> {
  const headers: Record<string, string> = {
    "cf-connecting-ip": opts.session?.ip ?? opts.ip ?? "10.0.0.1",
  };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.session) headers["cookie"] = opts.session.cookie;
  const res = await server.fetch(
    new Request("http://test.local" + path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  );
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}

export async function register(name = "user"): Promise<Session> {
  const ip = `10.1.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
  const username = `${name}-${Math.random().toString(36).slice(2, 10)}`;
  const res = await server.fetch(
    new Request("http://test.local/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ username, password: "correct-horse-battery" }),
    })
  );
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  const body = await res.json();
  return { cookie, id: body.id, username, ip };
}

// Fast bulk insert of checklists for list/filter tests
export async function seedChecklists(ownerId: string, names: string[], groupId: string | null = null) {
  const rows = names.map((name, i) => ({
    owner_id: ownerId,
    name,
    slug: `seed${ownerId.slice(0, 4)}${Math.random().toString(36).slice(2, 8)}${i}`.slice(0, 20),
    group_id: groupId,
  }));
  return sql`INSERT INTO projects ${sql(rows, "owner_id", "name", "slug", "group_id")} RETURNING id, slug, name`;
}
