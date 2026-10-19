-- Brings the schema in line with what the code uses.
-- Idempotent: safe on databases where these objects were created by hand.

-- Section vs. task items
ALTER TABLE checklist_items
  ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'task';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checklist_items_item_type_check'
  ) THEN
    ALTER TABLE checklist_items
      ADD CONSTRAINT checklist_items_item_type_check
      CHECK (item_type IN ('task', 'section'));
  END IF;
END $$;

-- Per-item comments (registered users only)
CREATE TABLE IF NOT EXISTS item_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     UUID NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_item ON item_comments(item_id, created_at);

-- Project chat
CREATE TABLE IF NOT EXISTS project_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_project ON project_messages(project_id, created_at);
