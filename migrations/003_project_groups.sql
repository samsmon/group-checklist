-- Groups ("projects" in the UI) that hold checklists, plus archive/pin/activity columns on checklists.
-- In the database and API a checklist is still a row of `projects`; `project_groups` is the new grouping.
-- Idempotent and additive.

CREATE TABLE IF NOT EXISTS project_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  position    INT NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_groups_owner ON project_groups(owner_id, position);

DROP TRIGGER IF EXISTS trg_groups_updated_at ON project_groups;
CREATE TRIGGER trg_groups_updated_at
  BEFORE UPDATE ON project_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE projects ADD COLUMN IF NOT EXISTS group_id         UUID REFERENCES project_groups(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at      TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS pinned_at        TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

-- Fill last_activity_at from the audit log once, so the dashboard no longer aggregates the whole log table
UPDATE projects p
SET last_activity_at = l.last_at
FROM (SELECT project_id, MAX(created_at) AS last_at FROM logs GROUP BY project_id) l
WHERE l.project_id = p.id AND p.last_activity_at IS NULL;

-- Touching last_activity_at on every action must not count as "the checklist was edited"
DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  WHEN (OLD.last_activity_at IS NOT DISTINCT FROM NEW.last_activity_at)
  EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_projects_owner_activity ON projects(owner_id, last_activity_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_projects_group ON projects(group_id) WHERE group_id IS NOT NULL;
