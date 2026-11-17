PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

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
