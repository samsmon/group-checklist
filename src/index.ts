import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import { requestMeta } from "./middleware/logger";
import { rooms, broadcastToRoom } from "./ws";
import authRoutes from "./routes/auth";
import projectRoutes from "./routes/projects";
import { authMiddleware } from "./routes/auth";
import { getProject, canAccess } from "./lib/access";
import type { AppEnv } from "./types";

export { broadcastToRoom };

const app = new Hono<AppEnv>();

// Global middleware
app.use("*", logger());
app.use("*", requestMeta);

// Global error handler
app.onError((err, c) => {
  console.error(`[error] ${c.req.method} ${c.req.path}:`, err);
  return c.json({ error: err.message || "Internal Server Error" }, 500);
});

// Health check — also pings the DB so Neon doesn't scale to zero
app.get("/health", async (c) => {
  try {
    const { default: sql } = await import("./db");
    await sql`SELECT 1`;
    return c.json({ ok: true, db: "ok", ts: new Date().toISOString() });
  } catch (e: any) {
    return c.json({ ok: false, db: e.message, ts: new Date().toISOString() }, 503);
  }
});

// API routes
app.route("/api/auth", authRoutes);
app.route("/api/projects", projectRoutes);

// WebSocket: /ws/:slug
const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket<unknown>>();

app.get(
  "/ws/:slug",
  authMiddleware,
  async (c, next) => {
    // Same visibility rules as the REST API: private rooms are owner-only
    const project = await getProject(c.req.param("slug") ?? "");
    if (!project) return c.json({ error: "not found" }, 404);
    if (!canAccess(project, c.get("user")?.id)) return c.json({ error: "access denied" }, 403);
    await next();
  },
  upgradeWebSocket((c) => {
    const slug = c.req.param("slug") as string;
    return {
      onOpen(_evt, ws) {
        const raw = ws.raw as ServerWebSocket<unknown>;
        if (!rooms.has(slug)) rooms.set(slug, new Set());
        rooms.get(slug)!.add(raw);
        console.log(`[ws] joined ${slug} (${rooms.get(slug)!.size} clients)`);
      },
      onClose(_evt, ws) {
        const raw = ws.raw as ServerWebSocket<unknown>;
        rooms.get(slug)?.delete(raw);
        if (rooms.get(slug)?.size === 0) rooms.delete(slug);
        console.log(`[ws] left ${slug}`);
      },
      onMessage(evt) {
        if (evt.data === "ping") {
          (evt.target as ServerWebSocket<unknown>).send("pong");
        }
      },
      onError(evt) {
        console.error(`[ws] error in ${slug}:`, evt);
      },
    };
  })
);

// Static files
app.use("/*", serveStatic({ root: "./public" }));
app.get("*", serveStatic({ path: "./public/index.html" }));

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
  websocket,
};

console.log(`Server running on http://localhost:${port}`);
