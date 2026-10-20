import { Hono } from "hono";
import sql from "../db";
import { authMiddleware } from "./auth";
import { readJson, cleanText, isUuid, optionalBool } from "../lib/validate";
import type { AppEnv } from "../types";

// Groups ("projects" in the UI) hold checklists. They belong to one person; nobody else can see them.
const groups = new Hono<AppEnv>();

const MAX_GROUPS_PER_USER = 200;

groups.use("*", authMiddleware);

// Everything here needs a signed-in user
groups.use("*", async (c, next) => {
  if (!c.get("user")) return c.json({ error: "not authenticated" }, 401);
  await next();
});

// GET /api/groups?archived=1 — groups with progress rolled up over their (non-archived) checklists
groups.get("/", async (c) => {
  const user = c.get("user")!;
  const archived = c.req.query("archived") === "1";

  const rows = await sql`
    SELECT
      g.id, g.name, g.description, g.position, g.archived_at, g.created_at, g.updated_at,
      r.checklist_count, r.item_count, r.completed_count, r.last_activity_at
    FROM project_groups g
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS checklist_count,
        COALESCE(SUM(s.item_count), 0)::int AS item_count,
        COALESCE(SUM(s.completed_count), 0)::int AS completed_count,
        MAX(p.last_activity_at) AS last_activity_at
      FROM projects p
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE ci.item_type <> 'section') AS item_count,
          COUNT(ic.id) FILTER (WHERE ci.item_type <> 'section') AS completed_count
        FROM checklist_items ci
        LEFT JOIN item_completions ic ON ic.item_id = ci.id
        WHERE ci.project_id = p.id
      ) s ON true
      WHERE p.group_id = g.id AND p.archived_at IS NULL
    ) r ON true
    WHERE g.owner_id = ${user.id}
      AND ${archived ? sql`g.archived_at IS NOT NULL` : sql`g.archived_at IS NULL`}
    ORDER BY g.position, lower(g.name), g.id
  `;
  return c.json(rows);
});

// POST /api/groups
groups.post("/", async (c) => {
  const user = c.get("user")!;
  const body = await readJson<{ name?: string; description?: string }>(c);
  const name = cleanText(body.name, 100, "name");
  const description = cleanText(body.description, 500, "description");
  if (!name) return c.json({ error: "name is required" }, 400);

  const [{ count, max_position }] = await sql<{ count: number; max_position: number }[]>`
    SELECT COUNT(*)::int AS count, COALESCE(MAX(position), -1)::int AS max_position
    FROM project_groups WHERE owner_id = ${user.id}
  `;
  if (count >= MAX_GROUPS_PER_USER) {
    return c.json({ error: `You can have at most ${MAX_GROUPS_PER_USER} projects.` }, 400);
  }

  const [group] = await sql`
    INSERT INTO project_groups (owner_id, name, description, position)
    VALUES (${user.id}, ${name}, ${description || null}, ${max_position + 1})
    RETURNING id, name, description, position, archived_at, created_at, updated_at
  `;
  return c.json({ ...group, checklist_count: 0, item_count: 0, completed_count: 0, last_activity_at: null }, 201);
});

// PATCH /api/groups/:id — name, description, archived, position
groups.patch("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id") ?? "";
  if (!isUuid(id)) return c.json({ error: "not found" }, 404);

  const body = await readJson<{ name?: string; description?: string | null; archived?: boolean; position?: number }>(c);

  const name = body.name !== undefined ? cleanText(body.name, 100, "name") : null;
  if (body.name !== undefined && !name) return c.json({ error: "name cannot be empty" }, 400);
  const setDescription = "description" in body;
  const description = setDescription ? cleanText(body.description, 500, "description") || null : null;
  const archived = optionalBool(body.archived, "archived");
  if (body.position !== undefined && !(Number.isSafeInteger(body.position) && body.position >= 0)) {
    return c.json({ error: "position must be a non-negative integer" }, 400);
  }
  if (name === null && !setDescription && archived === undefined && body.position === undefined) {
    return c.json({ error: "nothing to update" }, 400);
  }

  const [group] = await sql`
    UPDATE project_groups
    SET
      name        = COALESCE(${name}, name),
      description = CASE WHEN ${setDescription}::boolean THEN ${description} ELSE description END,
      archived_at = CASE WHEN ${archived !== undefined}::boolean
                      THEN (CASE WHEN ${archived === true}::boolean THEN COALESCE(archived_at, NOW()) ELSE NULL END)
                      ELSE archived_at END,
      position    = COALESCE(${body.position ?? null}::int, position)
    WHERE id = ${id} AND owner_id = ${user.id}
    RETURNING id, name, description, position, archived_at, created_at, updated_at
  `;
  if (!group) return c.json({ error: "not found" }, 404);
  return c.json(group);
});

// DELETE /api/groups/:id — the checklists inside are kept and become ungrouped
groups.delete("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id") ?? "";
  if (!isUuid(id)) return c.json({ error: "not found" }, 404);

  const result = await sql.begin(async (tx) => {
    const [owned] = await tx`SELECT id FROM project_groups WHERE id = ${id} AND owner_id = ${user.id} FOR UPDATE`;
    if (!owned) return null;
    const [{ n }] = await tx<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM projects WHERE group_id = ${id}`;
    await tx`DELETE FROM project_groups WHERE id = ${id}`; // ON DELETE SET NULL ungroups the checklists
    return { ungrouped: n };
  });
  if (!result) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true, ...result });
});

export default groups;
