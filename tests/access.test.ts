import { describe, expect, test } from "bun:test";
import { api, register } from "./helpers";

async function checklistWithItem(owner: Awaited<ReturnType<typeof register>>, visibility: "public" | "private") {
  const p = (await api("POST", "/api/projects", { session: owner, body: { name: `${visibility} list`, visibility } })).json;
  const item = (await api("POST", `/api/projects/${p.slug}/items`, { session: owner, body: { title: "first task" } })).json;
  return { slug: p.slug as string, itemId: item.id as string };
}

describe("access rules", () => {
  test("private checklists are owner-only, public ones are readable by anyone", async () => {
    const owner = await register("ac1");
    const stranger = await register("ac2");
    const priv = await checklistWithItem(owner, "private");
    const pub = await checklistWithItem(owner, "public");

    expect((await api("GET", `/api/projects/${priv.slug}`, { session: stranger })).status).toBe(403);
    expect((await api("GET", `/api/projects/${priv.slug}/items`)).status).toBe(403);
    expect((await api("GET", `/api/projects/${pub.slug}`)).status).toBe(200);
    expect((await api("GET", `/api/projects/${priv.slug}/logs?level=public`, { session: stranger })).status).toBe(403);
  });

  test("an item id from another checklist is not reachable through my own slug", async () => {
    const victim = await register("idor1");
    const attacker = await register("idor2");
    const secret = await checklistWithItem(victim, "private");
    const mine = await checklistWithItem(attacker, "private");

    await api("POST", `/api/projects/${secret.slug}/items/${secret.itemId}/complete`, { session: victim, body: { done_by_name: "victim" } });
    await api("POST", `/api/projects/${secret.slug}/items/${secret.itemId}/comments`, { session: victim, body: { body: "private note" } });

    // undo the completion, read comments, add a comment, remove a PIC: all through the attacker's own slug
    const viaMine = (path: string) => `/api/projects/${mine.slug}/items/${secret.itemId}${path}`;
    expect((await api("DELETE", viaMine("/complete"), { session: attacker })).status).toBe(404);
    expect((await api("GET", viaMine("/comments"), { session: attacker })).status).toBe(404);
    expect((await api("POST", viaMine("/comments"), { session: attacker, body: { body: "hi" } })).status).toBe(404);
    expect((await api("POST", viaMine("/pics"), { session: attacker, body: { name: "x" } })).status).toBe(404);
    expect((await api("DELETE", viaMine(""), { session: attacker })).status).toBe(404);

    // the victim's data is untouched
    const view = await api("GET", `/api/projects/${secret.slug}`, { session: victim });
    expect(view.json.items[0].completion).not.toBeNull();
    const comments = await api("GET", `/api/projects/${secret.slug}/items/${secret.itemId}/comments`, { session: victim });
    expect(comments.json.comments.length).toBe(1);
  });

  test("malformed ids are 404/400, never 500", async () => {
    const me = await register("ids");
    const { slug } = await checklistWithItem(me, "private");
    expect((await api("PATCH", `/api/projects/${slug}/items/not-a-uuid`, { session: me, body: { title: "x" } })).status).toBe(404);
    expect((await api("DELETE", `/api/projects/${slug}/items/batch`, { session: me, body: { ids: ["nope"] } })).status).toBe(400);
    expect((await api("PATCH", `/api/projects/${slug}/items/reorder`, { session: me, body: { order: [{ id: "nope", display_order: 1 }] } })).status).toBe(400);
    expect((await api("GET", `/api/projects/${slug}/logs?before=garbage`, { session: me })).status).toBe(400);
    expect((await api("POST", `/api/projects/${slug}/items`, { session: me, body: "[]" })).status).toBe(400);
  });

  test("public logs hide ip and user agent; the owner's admin view keeps them", async () => {
    const me = await register("logs");
    const { slug } = await checklistWithItem(me, "public");
    const pub = await api("GET", `/api/projects/${slug}/logs?level=public`);
    expect(pub.status).toBe(200);
    expect(pub.json.logs.length).toBeGreaterThan(0);
    for (const row of pub.json.logs) {
      expect(row).not.toHaveProperty("ip");
      expect(row).not.toHaveProperty("user_agent");
    }
    expect((await api("GET", `/api/projects/${slug}/logs?level=admin`)).status).toBe(403);
    const admin = await api("GET", `/api/projects/${slug}/logs?level=admin`, { session: me });
    expect(admin.json.logs[0]).toHaveProperty("ip");
  });

  test("reorder log rows store a count, not the whole order", async () => {
    const me = await register("reord");
    const p = (await api("POST", "/api/projects", { session: me, body: { name: "R", visibility: "public" } })).json;
    const ids: string[] = [];
    for (const title of ["a", "b", "c"]) {
      ids.push((await api("POST", `/api/projects/${p.slug}/items`, { session: me, body: { title } })).json.id);
    }
    const order = ids.reverse().map((id, i) => ({ id, display_order: i }));
    expect((await api("PATCH", `/api/projects/${p.slug}/items/reorder`, { session: me, body: { order } })).status).toBe(200);
    const logs = (await api("GET", `/api/projects/${p.slug}/logs?level=public`)).json.logs;
    const row = logs.find((l: any) => l.action === "item.reordered");
    expect(row.payload).toEqual({ count: 3 });
  });
});
