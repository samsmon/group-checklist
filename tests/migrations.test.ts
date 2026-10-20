import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import postgres from "postgres";
import { runMigrations } from "../src/lib/migrate";
import { sql, register, api } from "./helpers";

const dir = resolve(import.meta.dir, "../migrations");

describe("migrations", () => {
  test("every file is recorded and a second run does nothing", async () => {
    const rows = await sql`SELECT name FROM schema_migrations ORDER BY name`;
    expect(rows.map((r) => r.name)).toEqual([
      "001_init.sql",
      "002_item_type_comments_messages.sql",
      "003_project_groups.sql",
    ]);
    const again = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      expect(await runMigrations(again, dir, () => {})).toEqual([]);
    } finally {
      await again.end();
    }
  });

  test("the schema has what the code uses", async () => {
    const tables = (await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`).map((r) => r.table_name);
    for (const t of ["users", "projects", "checklist_items", "item_pics", "item_completions", "item_comments", "project_messages", "logs", "project_groups"]) {
      expect(tables).toContain(t);
    }
    const cols = (await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'projects'`).map((r) => r.column_name);
    for (const c of ["group_id", "archived_at", "pinned_at", "last_activity_at"]) expect(cols).toContain(c);
  });

  test("003 can be applied again and backfills last_activity_at from the log", async () => {
    const me = await register("mig");
    const p = (await api("POST", "/api/projects", { session: me, body: { name: "Backfill" } })).json;
    await sql`INSERT INTO logs (project_id, actor_name, action, created_at) VALUES (${p.id}, 'x', 'item.created', '2020-01-02T03:04:05Z')`;
    await sql`UPDATE projects SET last_activity_at = NULL WHERE id = ${p.id}`;

    await sql.unsafe(readFileSync(resolve(dir, "003_project_groups.sql"), "utf-8"));

    const [row] = await sql`SELECT last_activity_at FROM projects WHERE id = ${p.id}`;
    // the newest log row for this checklist (the real project.created one is newer than the 2020 row)
    expect(new Date(row.last_activity_at).getTime()).toBeGreaterThan(new Date("2020-01-02T03:04:05Z").getTime());
  });

  test("bumping last_activity_at does not count as an edit, a rename does", async () => {
    const me = await register("trg");
    const p = (await api("POST", "/api/projects", { session: me, body: { name: "Trigger" } })).json;
    const [before] = await sql`SELECT updated_at FROM projects WHERE id = ${p.id}`;
    await new Promise((r) => setTimeout(r, 30));
    await sql`UPDATE projects SET last_activity_at = NOW() WHERE id = ${p.id}`;
    const [bumped] = await sql`SELECT updated_at FROM projects WHERE id = ${p.id}`;
    expect(bumped.updated_at.getTime()).toBe(before.updated_at.getTime());
    await sql`UPDATE projects SET name = 'Renamed' WHERE id = ${p.id}`;
    const [renamed] = await sql`SELECT updated_at FROM projects WHERE id = ${p.id}`;
    expect(renamed.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });

  test("deleting a user removes their groups and checklists", async () => {
    const me = await register("cascade");
    const g = (await api("POST", "/api/groups", { session: me, body: { name: "G" } })).json;
    await api("POST", "/api/projects", { session: me, body: { name: "P", group_id: g.id } });
    await sql`DELETE FROM users WHERE id = ${me.id}`;
    expect((await sql`SELECT 1 FROM project_groups WHERE owner_id = ${me.id}`).length).toBe(0);
    expect((await sql`SELECT 1 FROM projects WHERE owner_id = ${me.id}`).length).toBe(0);
  });
});
