import { Hono } from "hono";
import sql from "../db";
import { getProject, canAccess, isOwner } from "../lib/access";
import { parseLimit } from "../lib/validate";
import type { AppEnv } from "../types";

const logs = new Hono<AppEnv>();

// GET / — fetch logs for a project
// Query params:
//   level = "public" | "admin" (admin requires owner)
//   limit = number (default 50, max 200)
//   before = ISO timestamp (cursor-based pagination)
logs.get("/", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user?.id)) return c.json({ error: "access denied" }, 403);

  const level = c.req.query("level") ?? "public";
  if (level !== "public" && level !== "admin") {
    return c.json({ error: "level must be public or admin" }, 400);
  }

  // Admin logs only visible to owner
  if (level === "admin" && !isOwner(project, user?.id)) {
    return c.json({ error: "owner only" }, 403);
  }

  const limit = parseLimit(c.req.query("limit"), 50, 200);

  const beforeRaw = c.req.query("before");
  let before: Date | null = null;
  if (beforeRaw) {
    before = new Date(beforeRaw);
    if (Number.isNaN(before.getTime())) return c.json({ error: "before must be an ISO timestamp" }, 400);
  }

  // IP and user agent are only returned in the admin (owner) view
  const rows =
    level === "admin"
      ? await sql`
          SELECT id, item_id, actor_name, action, payload, ip, user_agent, log_level, created_at
          FROM logs
          WHERE project_id = ${project.id}
            AND log_level = 'admin'
            AND (${before}::timestamptz IS NULL OR created_at < ${before}::timestamptz)
          ORDER BY created_at DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT id, item_id, actor_name, action, payload, log_level, created_at
          FROM logs
          WHERE project_id = ${project.id}
            AND log_level = 'public'
            AND (${before}::timestamptz IS NULL OR created_at < ${before}::timestamptz)
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;

  return c.json({
    logs: rows,
    next_before: rows.length === limit ? rows[rows.length - 1].created_at : null,
  });
});

export default logs;
