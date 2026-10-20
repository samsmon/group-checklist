import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/index";
import { api, register } from "./helpers";

// A real server on a free port, so the WebSocket handshake, heartbeat and close codes run for real
let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch, websocket: app.websocket });
  base = `127.0.0.1:${server.port}`;
});
afterAll(() => server.stop(true));

type Socket = { ws: WebSocket; messages: string[]; closed: Promise<CloseEvent> };

function connect(slug: string, cookie?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    // Bun's WebSocket accepts a headers option, which a browser would send as the cookie jar
    const ws = new WebSocket(`ws://${base}/ws/${slug}`, { headers: { cookie: cookie ?? "", "cf-connecting-ip": "10.20.0.1" } } as any);
    const messages: string[] = [];
    const closed = new Promise<CloseEvent>((done) => ws.addEventListener("close", (e) => done(e as CloseEvent)));
    ws.addEventListener("message", (e) => messages.push(String(e.data)));
    ws.addEventListener("open", () => resolve({ ws, messages, closed }));
    ws.addEventListener("error", () => reject(new Error("handshake failed")));
  });
}

const until = async (check: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

async function publicChecklist() {
  const owner = await register("wsown");
  const p = (await api("POST", "/api/projects", { session: owner, body: { name: "Live", visibility: "public" } })).json;
  return { owner, slug: p.slug as string };
}

describe("websocket", () => {
  test("a ping is answered with a pong and the server keeps running", async () => {
    const { slug } = await publicChecklist();
    const s = await connect(slug);
    s.ws.send("ping");
    await until(() => s.messages.includes("pong"));
    s.ws.send("ping");
    await until(() => s.messages.filter((m) => m === "pong").length === 2);
    // still serving normal requests after the heartbeat
    expect((await fetch(`http://${base}/health`)).status).toBe(200);
    s.ws.close();
  });

  test("events reach everyone in the room", async () => {
    const { owner, slug } = await publicChecklist();
    const a = await connect(slug);
    const b = await connect(slug, owner.cookie);
    await api("POST", `/api/projects/${slug}/items`, { session: owner, body: { title: "shared item" } });
    for (const s of [a, b]) {
      await until(() => s.messages.some((m) => m.includes("item.created") && m.includes("shared item")));
    }
    a.ws.close();
    b.ws.close();
  });

  test("a private checklist refuses strangers at the handshake", async () => {
    const owner = await register("wspriv");
    const stranger = await register("wsstr");
    const p = (await api("POST", "/api/projects", { session: owner, body: { name: "Hidden" } })).json;
    await expect(connect(p.slug)).rejects.toThrow();
    await expect(connect(p.slug, stranger.cookie)).rejects.toThrow();
    const ok = await connect(p.slug, owner.cookie);
    ok.ws.close();
  });

  test("turning a checklist private disconnects everyone but the owner, with code 4403", async () => {
    const { owner, slug } = await publicChecklist();
    const viewer = await connect(slug);
    const mine = await connect(slug, owner.cookie);
    await api("PATCH", `/api/projects/${slug}`, { session: owner, body: { visibility: "private" } });
    const closed = await viewer.closed;
    expect(closed.code).toBe(4403);
    await new Promise((r) => setTimeout(r, 150));
    expect(mine.ws.readyState).toBe(WebSocket.OPEN);
    mine.ws.close();
  });

  test("deleting the checklist disconnects everyone with code 4404", async () => {
    const { owner, slug } = await publicChecklist();
    const viewer = await connect(slug);
    await api("DELETE", `/api/projects/${slug}`, { session: owner });
    expect((await viewer.closed).code).toBe(4404);
  });

  test("a message larger than 1 KB drops the connection", async () => {
    const { slug } = await publicChecklist();
    const s = await connect(slug);
    s.ws.send("x".repeat(4096));
    const closed = await s.closed;
    expect(closed.code).not.toBe(1000);
  });
});
