import { describe, expect, test } from "bun:test";
import { api, register, sql } from "./helpers";

describe("groups", () => {
  test("need a signed-in user", async () => {
    expect((await api("GET", "/api/groups")).status).toBe(401);
    expect((await api("POST", "/api/groups", { body: { name: "x" } })).status).toBe(401);
  });

  test("create, list, rename, describe, archive", async () => {
    const me = await register("grp");
    const created = await api("POST", "/api/groups", { session: me, body: { name: "  Thesis  ", description: "Chapters and reading" } });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ name: "Thesis", description: "Chapters and reading", position: 0, checklist_count: 0 });
    const second = await api("POST", "/api/groups", { session: me, body: { name: "Chores" } });
    expect(second.json.position).toBe(1);

    const list = await api("GET", "/api/groups", { session: me });
    expect(list.json.map((g: any) => g.name)).toEqual(["Thesis", "Chores"]);

    const id = created.json.id;
    expect((await api("PATCH", `/api/groups/${id}`, { session: me, body: { name: "Thesis 2026" } })).json.name).toBe("Thesis 2026");
    expect((await api("PATCH", `/api/groups/${id}`, { session: me, body: { description: null } })).json.description).toBeNull();

    const archived = await api("PATCH", `/api/groups/${id}`, { session: me, body: { archived: true } });
    expect(archived.json.archived_at).not.toBeNull();
    expect((await api("GET", "/api/groups", { session: me })).json.map((g: any) => g.name)).toEqual(["Chores"]);
    expect((await api("GET", "/api/groups?archived=1", { session: me })).json.map((g: any) => g.name)).toEqual(["Thesis 2026"]);
    expect((await api("PATCH", `/api/groups/${id}`, { session: me, body: { archived: false } })).json.archived_at).toBeNull();
  });

  test("validation", async () => {
    const me = await register("grpv");
    expect((await api("POST", "/api/groups", { session: me, body: { name: "   " } })).status).toBe(400);
    expect((await api("POST", "/api/groups", { session: me, body: { name: "x".repeat(101) } })).status).toBe(400);
    expect((await api("POST", "/api/groups", { session: me, body: { name: "ok", description: "d".repeat(501) } })).status).toBe(400);
    const g = (await api("POST", "/api/groups", { session: me, body: { name: "ok" } })).json;
    expect((await api("PATCH", `/api/groups/${g.id}`, { session: me, body: {} })).status).toBe(400);
    expect((await api("PATCH", `/api/groups/${g.id}`, { session: me, body: { name: "" } })).status).toBe(400);
    expect((await api("PATCH", `/api/groups/${g.id}`, { session: me, body: { archived: "yes" } })).status).toBe(400);
    expect((await api("PATCH", `/api/groups/${g.id}`, { session: me, body: { position: -1 } })).status).toBe(400);
    expect((await api("PATCH", "/api/groups/not-a-uuid", { session: me, body: { name: "x" } })).status).toBe(404);
  });

  test("rollup counts tasks only and skips archived checklists", async () => {
    const me = await register("roll");
    const g = (await api("POST", "/api/groups", { session: me, body: { name: "Launch" } })).json;
    const a = (await api("POST", "/api/projects", { session: me, body: { name: "A", group_id: g.id } })).json;
    const b = (await api("POST", "/api/projects", { session: me, body: { name: "B", group_id: g.id } })).json;
    for (const [slug, title, type] of [[a.slug, "Section", "section"], [a.slug, "T1", "task"], [a.slug, "T2", "task"], [b.slug, "T3", "task"]]) {
      await api("POST", `/api/projects/${slug}/items`, { session: me, body: { title, item_type: type } });
    }
    const items = (await api("GET", `/api/projects/${a.slug}`, { session: me })).json.items;
    const t1 = items.find((i: any) => i.title === "T1");
    const section = items.find((i: any) => i.title === "Section");
    await api("POST", `/api/projects/${a.slug}/items/${t1.id}/complete`, { session: me, body: { done_by_name: "me" } });
    await api("POST", `/api/projects/${a.slug}/items/${section.id}/complete`, { session: me, body: { done_by_name: "me" } });

    let row = (await api("GET", "/api/groups", { session: me })).json.find((x: any) => x.id === g.id);
    expect(row).toMatchObject({ checklist_count: 2, item_count: 3, completed_count: 1 });

    await api("PATCH", `/api/projects/${b.slug}`, { session: me, body: { archived: true } });
    row = (await api("GET", "/api/groups", { session: me })).json.find((x: any) => x.id === g.id);
    expect(row).toMatchObject({ checklist_count: 1, item_count: 2, completed_count: 1 });
  });

  test("deleting a group keeps its checklists", async () => {
    const me = await register("del");
    const g = (await api("POST", "/api/groups", { session: me, body: { name: "Temp" } })).json;
    const p = (await api("POST", "/api/projects", { session: me, body: { name: "Keep me", group_id: g.id } })).json;
    const res = await api("DELETE", `/api/groups/${g.id}`, { session: me });
    expect(res.json).toEqual({ ok: true, ungrouped: 1 });
    const after = await api("GET", `/api/projects/${p.slug}`, { session: me });
    expect(after.status).toBe(200);
    expect(after.json.group_id).toBeNull();
    expect((await api("DELETE", `/api/groups/${g.id}`, { session: me })).status).toBe(404);
  });

  test("other people cannot see or change them", async () => {
    const owner = await register("own");
    const other = await register("oth");
    const g = (await api("POST", "/api/groups", { session: owner, body: { name: "Private plans" } })).json;

    expect((await api("GET", "/api/groups", { session: other })).json).toEqual([]);
    expect((await api("PATCH", `/api/groups/${g.id}`, { session: other, body: { name: "mine now" } })).status).toBe(404);
    expect((await api("DELETE", `/api/groups/${g.id}`, { session: other })).status).toBe(404);

    // ...and cannot file their own checklist into it
    const mine = (await api("POST", "/api/projects", { session: other, body: { name: "Mine" } })).json;
    expect((await api("POST", "/api/projects", { session: other, body: { name: "x", group_id: g.id } })).status).toBe(404);
    expect((await api("PATCH", `/api/projects/${mine.slug}`, { session: other, body: { group_id: g.id } })).status).toBe(404);

    const still = await sql`SELECT name FROM project_groups WHERE id = ${g.id}`;
    expect(still[0].name).toBe("Private plans");
  });

  test("a person can have at most 200 groups", async () => {
    const me = await register("cap");
    const rows = Array.from({ length: 200 }, (_, i) => ({ owner_id: me.id, name: `g${i}`, position: i }));
    await sql`INSERT INTO project_groups ${sql(rows, "owner_id", "name", "position")}`;
    expect((await api("POST", "/api/groups", { session: me, body: { name: "one too many" } })).status).toBe(400);
  });
});
