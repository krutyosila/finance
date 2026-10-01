CREATE TABLE labels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  normalized_name TEXT NOT NULL,
  description TEXT CHECK(description IS NULL OR length(description) <= 500),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX labels_active_name_unique ON labels(normalized_name) WHERE archived=0;
ALTER TABLE transactions ADD COLUMN label_id TEXT REFERENCES labels(id);
CREATE INDEX transactions_label ON transactions(label_id);
