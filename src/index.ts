import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { compress } from "hono/compress";
import { etag } from "hono/etag";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { BadRequest } from "./lib/validate";
import {
  loginLimiter,
  registerLimiter,
  writeLimiter,
  chatLimiter,
  importLimiter,
  wsLimiter,
} from "./middleware/rateLimit";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import { requestMeta } from "./middleware/logger";
import { broadcastToRoom, canJoin, joinRoom, leaveRoom, roomSize } from "./ws";
import authRoutes from "./routes/auth";
import projectRoutes from "./routes/projects";
import groupRoutes from "./routes/groups";
import { authMiddleware } from "./routes/auth";
import { getProject, canAccess } from "./lib/access";
import type { AppEnv } from "./types";

export { broadcastToRoom };

const app = new Hono<AppEnv>();

// Global middleware
if (process.env.NODE_ENV !== "test") app.use("*", logger());
app.use("*", requestMeta);

// Security headers. Alpine's standard build compiles expressions with Function(), hence
// 'unsafe-eval'; the UI also uses inline style attributes. Everything else is same-origin.
// HSTS is left to the edge (Cloudflare/Fly): includeSubDomains here would reach sibling hosts.
app.use(
  "*",
  secureHeaders({
    strictTransportSecurity: false,
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    xFrameOptions: "DENY",
    referrerPolicy: "same-origin",
  })
);

// Global error handler
app.onError((err, c) => {
  if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
  // Details stay in the server log; clients get a generic message
  console.error(`[error] ${c.req.method} ${c.req.path}:`, err);
  return c.json({ error: "Internal Server Error" }, 500);
});

// Cap request bodies (the CSV/Markdown import is the largest legitimate payload)
app.use(
  "/api/*",
  bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "payload too large" }, 413) })
);

// Rate limits (per client IP). requestMeta above has already set c.get("ip").
app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/register", registerLimiter);
app.use("/api/projects/*", writeLimiter);
app.use("/api/groups/*", writeLimiter);
app.use("/api/projects/:slug/messages", chatLimiter);
app.use("/api/projects/:slug/items/:id/comments", chatLimiter);
app.use("/api/projects/:slug/items/import", importLimiter);

// Health check — reports 503 when the database is unreachable (used by the Docker healthcheck)
app.get("/health", async (c) => {
  try {
    const { default: sql } = await import("./db");
    await sql`SELECT 1`;
    return c.json({ ok: true, db: "ok", ts: new Date().toISOString() });
  } catch (e: any) {
    console.error("[health] db check failed:", e.message);
    return c.json({ ok: false, db: "error", ts: new Date().toISOString() }, 503);
  }
});

// API routes
app.route("/api/auth", authRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/groups", groupRoutes);

// WebSocket: /ws/:slug
const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket<unknown>>();

app.use("/ws/*", wsLimiter);
app.get(
  "/ws/:slug",
  authMiddleware,
  async (c, next) => {
    // Same visibility rules as the REST API: private rooms are owner-only
    const slug = c.req.param("slug") ?? "";
    const project = await getProject(slug);
    if (!project) return c.json({ error: "not found" }, 404);
    if (!canAccess(project, c.get("user")?.id)) return c.json({ error: "access denied" }, 403);
    if (canJoin(slug, c.get("ip")) !== "ok") return c.json({ error: "too many connections" }, 429);
    await next();
  },
  upgradeWebSocket((c) => {
    const slug = c.req.param("slug") as string;
    const meta = { userId: c.get("user")?.id ?? null, ip: c.get("ip") };
    return {
      onOpen(_evt, ws) {
        joinRoom(slug, ws.raw as ServerWebSocket<unknown>, meta);
        console.log(`[ws] joined ${slug} (${roomSize(slug)} clients)`);
      },
      onClose(_evt, ws) {
        leaveRoom(slug, ws.raw as ServerWebSocket<unknown>);
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

// Unknown API paths answer in JSON instead of falling through to the SPA page
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

// Static files. Compression and ETag apply only here (not to the API or WebSocket upgrades).
// Fonts and the version-named Alpine file never change under the same URL, so they cache for
// a year; everything else is revalidated with the ETag (304 when unchanged).
const isDynamic = (path: string) => path.startsWith("/api/") || path.startsWith("/ws/") || path === "/health";
const onlyStatic = (mw: MiddlewareHandler): MiddlewareHandler => (c, next) =>
  isDynamic(c.req.path) ? next() : mw(c, next);

app.use("/*", onlyStatic(compress()));
app.use("/*", onlyStatic(etag()));
app.use("/*", async (c, next) => {
  await next();
  if (isDynamic(c.req.path) || c.req.method !== "GET" || c.res.status !== 200) return;
  c.header(
    "Cache-Control",
    /^\/(fonts|vendor)\//.test(c.req.path) ? "public, max-age=31536000, immutable" : "no-cache"
  );
});
app.use("/*", serveStatic({ root: "./public" }));
app.get("*", serveStatic({ path: "./public/index.html" }));

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
  // The only message clients send is "ping": anything bigger is dropped by the server
  websocket: { ...websocket, maxPayloadLength: 1024 },
};

console.log(`Server running on http://localhost:${port}`);
