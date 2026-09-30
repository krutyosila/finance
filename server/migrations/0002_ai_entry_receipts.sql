CREATE TABLE ai_entry_receipts (
  request_id TEXT PRIMARY KEY NOT NULL,
  input_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
