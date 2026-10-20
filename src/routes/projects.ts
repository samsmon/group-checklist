import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import sql from "../db";
import { authMiddleware } from "./auth";
import { writeLog } from "../middleware/logger";
import { broadcastToRoom, closeRoom, CLOSE_PRIVATE, CLOSE_GONE } from "../ws";
import { getProject, canAccess, isOwner } from "../lib/access";
import itemsRouter from "./items";
import logsRouter from "./logs";
import messagesRouter from "./messages";
import { readJson, cleanText, isUuid, optionalBool, parseLimit, parseOffset, escapeLike } from "../lib/validate";
import type { AppEnv } from "../types";

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 10);

const projects = new Hono<AppEnv>();

projects.use("*", authMiddleware);

projects.route("/:slug/items", itemsRouter);
projects.route("/:slug/logs", logsRouter);
projects.route("/:slug/messages", messagesRouter);

// A checklist's group must belong to the same person; returns false when it does not
async function ownsGroup(groupId: string, userId: string): Promise<boolean> {
  const [row] = await sql`SELECT 1 AS ok FROM project_groups WHERE id = ${groupId} AND owner_id = ${userId}`;
  return !!row;
}

const SORTS = ["activity", "name", "created"] as const;

// GET /api/projects — the signed-in user's checklists.
// Query: q (name contains), group (group id | "none"), archived (1 = archived only),
//        sort (activity | name | created), limit (default 100, max 200), offset.
// The total number of matches is returned in the X-Total-Count header; pinned checklists come first.
projects.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "not authenticated" }, 401);

  const q = cleanText(c.req.query("q"), 100, "q");
  const archived = c.req.query("archived") === "1";
  const group = c.req.query("group");
  if (group && group !== "none" && !isUuid(group)) {
    return c.json({ error: "group must be a group id or none" }, 400);
  }
  const sort = c.req.query("sort") ?? "activity";
  if (!(SORTS as readonly string[]).includes(sort)) {
    return c.json({ error: `sort must be one of ${SORTS.join(", ")}` }, 400);
  }
  const limit = parseLimit(c.req.query("limit"), 100, 200);
  const offset = parseOffset(c.req.query("offset"));

  const where = sql`
    p.owner_id = ${user.id}
    AND ${archived ? sql`p.archived_at IS NOT NULL` : sql`p.archived_at IS NULL`}
    ${group === "none" ? sql`AND p.group_id IS NULL` : group ? sql`AND p.group_id = ${group}` : sql``}
    ${q ? sql`AND p.name ILIKE ${"%" + escapeLike(q) + "%"}` : sql``}
  `;
  const order =
    sort === "name" ? sql`lower(p.name) ASC`
    : sort === "created" ? sql`p.created_at DESC`
    : sql`COALESCE(p.last_activity_at, p.created_at) DESC`;

  const [{ total }] = await sql<{ total: number }[]>`SELECT COUNT(*)::int AS total FROM projects p WHERE ${where}`;
  const rows = await sql`
    SELECT
      p.id, p.name, p.slug, p.visibility, p.created_at, p.updated_at,
      p.group_id, p.archived_at, p.pinned_at, p.last_activity_at,
      s.item_count, s.completed_count
    FROM projects p
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE ci.item_type <> 'section')::int AS item_count,
        COUNT(ic.id) FILTER (WHERE ci.item_type <> 'section')::int AS completed_count
      FROM checklist_items ci
      LEFT JOIN item_completions ic ON ic.item_id = ci.id
      WHERE ci.project_id = p.id
    ) s ON true
    WHERE ${where}
    ORDER BY (p.pinned_at IS NULL), p.pinned_at DESC, ${order}, p.id
    LIMIT ${limit} OFFSET ${offset}
  `;
  c.header("X-Total-Count", String(total));
  return c.json(rows);
});

// POST /api/projects
projects.post("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "not authenticated" }, 401);

  const body = await readJson<{ name?: string; visibility?: "public" | "private"; group_id?: string | null }>(c);
  const { visibility = "private" } = body;
  const name = cleanText(body.name, 100, "name");

  if (!name) return c.json({ error: "name is required" }, 400);
  if (!["public", "private"].includes(visibility)) {
    return c.json({ error: "visibility must be public or private" }, 400);
  }
  const groupId = body.group_id ?? null;
  if (groupId !== null) {
    if (!isUuid(groupId)) return c.json({ error: "group_id must be a group id or null" }, 400);
    if (!(await ownsGroup(groupId, user.id))) return c.json({ error: "group not found" }, 404);
  }

  const slug = nanoid();

  const [project] = await sql`
    INSERT INTO projects (owner_id, name, slug, visibility, group_id, last_activity_at)
    VALUES (${user.id}, ${name.trim()}, ${slug}, ${visibility}, ${groupId}, NOW())
    RETURNING id, name, slug, visibility, created_at, updated_at, group_id, archived_at, pinned_at, last_activity_at
  `;

  await writeLog({
    project_id: project.id,
    actor_name: user.username,
    action: "project.created",
    payload: { name: project.name, visibility: project.visibility },
    ip: c.get("ip"),
    user_agent: c.get("userAgent"),
    log_level: "admin",
  });

  return c.json(project, 201);
});

// GET /api/projects/:slug
projects.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user?.id)) return c.json({ error: "access denied" }, 403);

  const items = await sql`
    SELECT
      ci.id, ci.title, ci.description, ci.display_order, ci.item_type, ci.created_at, ci.updated_at,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object('id', ip.id, 'name', ip.name, 'assigned_by', ip.assigned_by))
        FILTER (WHERE ip.id IS NOT NULL), '[]'
      ) AS pics,
      CASE WHEN ic.id IS NOT NULL THEN
        jsonb_build_object(
          'id', ic.id,
          'done_by_name', ic.done_by_name,
          'notes', ic.notes,
          'completed_at', ic.completed_at
        )
      END AS completion
    FROM checklist_items ci
    LEFT JOIN item_pics ip ON ip.item_id = ci.id
    LEFT JOIN item_completions ic ON ic.item_id = ci.id
    WHERE ci.project_id = ${project.id}
    GROUP BY ci.id, ic.id
    ORDER BY ci.display_order ASC, ci.created_at ASC
  `;

  // Viewers get the public fields only; grouping, archive and pin state belong to the owner
  const owner = isOwner(project, user?.id);
  return c.json({
    id: project.id,
    name: project.name,
    slug: project.slug,
    visibility: project.visibility,
    created_at: project.created_at,
    updated_at: project.updated_at,
    is_owner: owner,
    ...(owner ? { group_id: project.group_id, archived_at: project.archived_at, pinned_at: project.pinned_at } : {}),
    items,
  });
});

// PATCH /api/projects/:slug
projects.patch("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");
  if (!user) return c.json({ error: "not authenticated" }, 401);

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!isOwner(project, user.id)) return c.json({ error: "owner only" }, 403);

  const body = await readJson<{
    name?: string;
    visibility?: "public" | "private";
    group_id?: string | null;
    archived?: boolean;
    pinned?: boolean;
  }>(c);
  const updates: Record<string, unknown> = {};
  const old: Record<string, unknown> = {};

  const newName = cleanText(body.name, 100, "name");
  if (newName) { old.name = project.name; updates.name = newName; }
  if (body.visibility) {
    if (!["public", "private"].includes(body.visibility)) {
      return c.json({ error: "visibility must be public or private" }, 400);
    }
    old.visibility = project.visibility;
    updates.visibility = body.visibility;
  }

  // Owner-only organisation fields. group_id: null removes the checklist from its group.
  const archived = optionalBool(body.archived, "archived");
  const pinned = optionalBool(body.pinned, "pinned");
  let setGroup = false;
  let groupId: string | null = null;
  if ("group_id" in body) {
    setGroup = true;
    groupId = body.group_id ?? null;
    if (groupId !== null) {
      if (!isUuid(groupId)) return c.json({ error: "group_id must be a group id or null" }, 400);
      if (!(await ownsGroup(groupId, user.id))) return c.json({ error: "group not found" }, 404);
    }
    old.group_id = project.group_id;
    updates.group_id = groupId;
  }
  if (archived !== undefined) { old.archived = !!project.archived_at; updates.archived = archived; }
  if (pinned !== undefined) { old.pinned = !!project.pinned_at; updates.pinned = pinned; }

  if (Object.keys(updates).length === 0) return c.json({ error: "nothing to update" }, 400);

  const [updated] = await sql`
    UPDATE projects
    SET
      name        = COALESCE(${(updates.name as string) ?? null}, name),
      visibility  = COALESCE(${(updates.visibility as "public" | "private") ?? null}, visibility),
      group_id    = CASE WHEN ${setGroup}::boolean THEN ${groupId}::uuid ELSE group_id END,
      archived_at = CASE WHEN ${archived !== undefined}::boolean
                      THEN (CASE WHEN ${archived === true}::boolean THEN COALESCE(archived_at, NOW()) ELSE NULL END)
                      ELSE archived_at END,
      pinned_at   = CASE WHEN ${pinned !== undefined}::boolean
                      THEN (CASE WHEN ${pinned === true}::boolean THEN COALESCE(pinned_at, NOW()) ELSE NULL END)
                      ELSE pinned_at END
    WHERE id = ${project.id}
    RETURNING id, name, slug, visibility, created_at, updated_at, group_id, archived_at, pinned_at
  `;

  await writeLog({
    project_id: project.id,
    actor_name: user.username,
    action: "project.updated",
    payload: { old, new: updates },
    ip: c.get("ip"),
    user_agent: c.get("userAgent"),
    log_level: "admin",
  });

  // Viewers only need to hear about the public fields
  if ("name" in updates || "visibility" in updates) {
    broadcastToRoom(slug, {
      event: "project.updated",
      data: {
        id: updated.id, name: updated.name, slug: updated.slug, visibility: updated.visibility,
        created_at: updated.created_at, updated_at: updated.updated_at,
      },
    });
  }
  // Sockets are authorised only when they connect: drop everyone but the owner once it is private
  if (updates.visibility === "private") closeRoom(slug, project.owner_id, CLOSE_PRIVATE, "project is now private");
  return c.json(updated);
});

// DELETE /api/projects/:slug
projects.delete("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");
  if (!user) return c.json({ error: "not authenticated" }, 401);

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!isOwner(project, user.id)) return c.json({ error: "owner only" }, 403);

  await sql`DELETE FROM projects WHERE id = ${project.id}`;

  broadcastToRoom(slug, { event: "project.deleted", data: { slug } });
  closeRoom(slug, null, CLOSE_GONE, "project deleted");
  return c.json({ ok: true });
});

export default projects;
