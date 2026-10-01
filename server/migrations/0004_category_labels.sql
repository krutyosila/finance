-- Keep imported legacy category names intact; new label input still limits names to 80 characters.
-- Foreign keys stay enabled and are checked after the replacement, before this transaction commits.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE labels_next (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  normalized_name TEXT NOT NULL,
  description TEXT CHECK(description IS NULL OR length(description) <= 500),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO labels_next SELECT * FROM labels;
DROP TABLE labels;
ALTER TABLE labels_next RENAME TO labels;
CREATE UNIQUE INDEX labels_active_name_unique ON labels(normalized_name) WHERE archived=0;
