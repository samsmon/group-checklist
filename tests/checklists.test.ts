import { describe, expect, test } from "bun:test";
import { api, register, seedChecklists, sql } from "./helpers";

const names = (res: { json: any }) => res.json.map((p: any) => p.name);

describe("listing checklists", () => {
  test("search, group filter, archive filter, sort, paging and total", async () => {
    const me = await register("list");
    const g = (await api("POST", "/api/groups", { session: me, body: { name: "Work" } })).json;
    await seedChecklists(me.id, Array.from({ length: 150 }, (_, i) => `Task list ${String(i).padStart(3, "0")}`));
    await seedChecklists(me.id, ["Sprint plan", "Sprint retro", "100% done", "a_b"], g.id);

    const all = await api("GET", "/api/projects", { session: me });
    expect(all.json.length).toBe(100); // default limit
    expect(all.headers.get("x-total-count")).toBe("154");

    const page2 = await api("GET", "/api/projects?limit=100&offset=100&sort=name", { session: me });
    expect(page2.json.length).toBe(54);
    expect((await api("GET", "/api/projects?limit=1000", { session: me })).json.length).toBe(154); // capped at 200

    // search is case-insensitive and treats % and _ literally
    expect(names(await api("GET", "/api/projects?q=SPRINT&sort=name", { session: me }))).toEqual(["Sprint plan", "Sprint retro"]);
    expect(names(await api("GET", "/api/projects?q=%25", { session: me }))).toEqual(["100% done"]);
    expect(names(await api("GET", "/api/projects?q=a_b", { session: me }))).toEqual(["a_b"]);
    expect(names(await api("GET", "/api/projects?q=a_", { session: me }))).toEqual(["a_b"]);

    // group filter
    const inGroup = await api("GET", `/api/projects?group=${g.id}&sort=name`, { session: me });
    expect(names(inGroup)).toEqual(["100% done", "a_b", "Sprint plan", "Sprint retro"]);
    expect(inGroup.headers.get("x-total-count")).toBe("4");
    expect((await api("GET", "/api/projects?group=none", { session: me })).headers.get("x-total-count")).toBe("150");
  });

  test("bad query values are 400, not 500", async () => {
    const me = await register("badq");
    expect((await api("GET", "/api/projects?group=nope", { session: me })).status).toBe(400);
    expect((await api("GET", "/api/projects?sort=random", { session: me })).status).toBe(400);
    expect((await api("GET", "/api/projects?q=" + "x".repeat(101), { session: me })).status).toBe(400);
    expect((await api("GET", "/api/projects?limit=abc&offset=-5", { session: me })).status).toBe(200);
    expect((await api("GET", "/api/projects")).status).toBe(401);
  });

  test("only my checklists are listed", async () => {
    const a = await register("mine");
    const b = await register("theirs");
    await seedChecklists(a.id, ["A1"]);
    await seedChecklists(b.id, ["B1", "B2"]);
    expect(names(await api("GET", "/api/projects", { session: a }))).toEqual(["A1"]);
    expect((await api("GET", "/api/projects", { session: b })).headers.get("x-total-count")).toBe("2");
  });

  test("pinned first, then most recent activity; activity comes from the log writer", async () => {
    const me = await register("act");
    const mk = async (name: string) => (await api("POST", "/api/projects", { session: me, body: { name } })).json;
    const old = await mk("Old");
    const middle = await mk("Middle");
    const fresh = await mk("Fresh");
    // set a known order, then let a real action bump "Old"
    await sql`UPDATE projects SET last_activity_at = NOW() - interval '3 days' WHERE id = ${old.id}`;
    await sql`UPDATE projects SET last_activity_at = NOW() - interval '2 days' WHERE id = ${middle.id}`;
    await sql`UPDATE projects SET last_activity_at = NOW() - interval '1 day' WHERE id = ${fresh.id}`;
    expect(names(await api("GET", "/api/projects", { session: me }))).toEqual(["Fresh", "Middle", "Old"]);

    await api("POST", `/api/projects/${old.slug}/items`, { session: me, body: { title: "something happened" } });
    expect(names(await api("GET", "/api/projects", { session: me }))).toEqual(["Old", "Fresh", "Middle"]);

    // owner-only management does not count as activity
    await api("PATCH", `/api/projects/${middle.slug}`, { session: me, body: { name: "Middle renamed" } });
    expect(names(await api("GET", "/api/projects", { session: me }))).toEqual(["Old", "Fresh", "Middle renamed"]);

    // pin wins over activity; unpin returns to activity order
    await api("PATCH", `/api/projects/${middle.slug}`, { session: me, body: { pinned: true } });
    const pinned = await api("GET", "/api/projects", { session: me });
    expect(names(pinned)[0]).toBe("Middle renamed");
    expect(pinned.json[0].pinned_at).not.toBeNull();
    await api("PATCH", `/api/projects/${middle.slug}`, { session: me, body: { pinned: false } });
    expect(names(await api("GET", "/api/projects", { session: me }))[0]).toBe("Old");
  });

  test("progress counts tasks only", async () => {
    const me = await register("prog");
    const p = (await api("POST", "/api/projects", { session: me, body: { name: "Counts" } })).json;
    await api("POST", `/api/projects/${p.slug}/items`, { session: me, body: { title: "Part 1", item_type: "section" } });
    for (const t of ["a", "b", "c"]) await api("POST", `/api/projects/${p.slug}/items`, { session: me, body: { title: t } });
    const items = (await api("GET", `/api/projects/${p.slug}`, { session: me })).json.items;
    await api("POST", `/api/projects/${p.slug}/items/${items.find((i: any) => i.title === "a").id}/complete`, { session: me, body: { done_by_name: "me" } });
    await api("POST", `/api/projects/${p.slug}/items/${items.find((i: any) => i.title === "Part 1").id}/complete`, { session: me, body: { done_by_name: "me" } });
    const row = (await api("GET", "/api/projects", { session: me })).json.find((x: any) => x.id === p.id);
    expect(row).toMatchObject({ item_count: 3, completed_count: 1 });
  });
});

describe("organising a checklist", () => {
  test("move into a group and back out, archive and restore, pin", async () => {
    const me = await register("org");
    const g = (await api("POST", "/api/groups", { session: me, body: { name: "G" } })).json;
    const p = (await api("POST", "/api/projects", { session: me, body: { name: "Movable" } })).json;
    expect(p.group_id).toBeNull();

    expect((await api("PATCH", `/api/projects/${p.slug}`, { session: me, body: { group_id: g.id } })).json.group_id).toBe(g.id);
    expect((await api("GET", `/api/projects?group=${g.id}`, { session: me })).json.length).toBe(1);
    expect((await api("PATCH", `/api/projects/${p.slug}`, { session: me, body: { group_id: null } })).json.group_id).toBeNull();

    const archived = await api("PATCH", `/api/projects/${p.slug}`, { session: me, body: { archived: true } });
    expect(archived.json.archived_at).not.toBeNull();
    expect((await api("GET", "/api/projects", { session: me })).json.some((x: any) => x.id === p.id)).toBe(false);
    expect((await api("GET", "/api/projects?archived=1", { session: me })).json.map((x: any) => x.id)).toContain(p.id);
    // archived checklists still open by their link
    expect((await api("GET", `/api/projects/${p.slug}`, { session: me })).status).toBe(200);
    expect((await api("PATCH", `/api/projects/${p.slug}`, { session: me, body: { archived: false } })).json.archived_at).toBeNull();
  });

  test("validation and ownership", async () => {
    const me = await register("orgv");
    const other = await register("orgo");
    const p = (await api("POST", "/api/projects", { session: me, body: { name: "P" } })).json;
    const patch = (body: unknown, session = me) => api("PATCH", `/api/projects/${p.slug}`, { session, body });
    expect((await patch({ group_id: "nope" })).status).toBe(400);
    expect((await patch({ archived: "true" })).status).toBe(400);
    expect((await patch({ pinned: 1 })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ pinned: true }, other)).status).toBe(403);
    expect((await api("POST", "/api/projects", { session: me, body: { name: "x", group_id: "nope" } })).status).toBe(400);
  });

  test("viewers of a public checklist do not see owner-only fields", async () => {
    const me = await register("pub");
    const p = (await api("POST", "/api/projects", { session: me, body: { name: "Shared", visibility: "public" } })).json;
    await api("PATCH", `/api/projects/${p.slug}`, { session: me, body: { pinned: true } });

    const owner = await api("GET", `/api/projects/${p.slug}`, { session: me });
    expect(owner.json.is_owner).toBe(true);
    expect(owner.json).toHaveProperty("pinned_at");

    const guest = await api("GET", `/api/projects/${p.slug}`);
    expect(guest.status).toBe(200);
    expect(guest.json.is_owner).toBe(false);
    for (const key of ["owner_id", "group_id", "pinned_at", "archived_at", "last_activity_at"]) {
      expect(guest.json).not.toHaveProperty(key);
    }
  });
});
