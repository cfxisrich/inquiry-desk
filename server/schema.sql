PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;

CREATE TABLE IF NOT EXISTS inquiries (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT NOT NULL REFERENCES inquiries(id),
  version INTEGER NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  UNIQUE (inquiry_id, version)
) STRICT;

CREATE TABLE IF NOT EXISTS followups (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT NOT NULL REFERENCES inquiries(id),
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;

CREATE INDEX IF NOT EXISTS followups_inquiry ON followups(inquiry_id);

UPDATE inquiries SET data = json_set(data, '$.revision', 1)
WHERE json_type(data, '$.revision') IS NULL;
UPDATE inquiries SET data = json_set(data, '$.missingFields', json('[]'))
WHERE json_type(data, '$.missingFields') IS NULL;
