-- Run once in the Supabase SQL editor. Application tables are private.
CREATE SCHEMA IF NOT EXISTS chuanheng;
REVOKE ALL ON SCHEMA chuanheng FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS chuanheng.site_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 1)
);
CREATE TABLE IF NOT EXISTS chuanheng.activities (
  id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 1),
  sort_order BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE IF NOT EXISTS chuanheng.projects (
  id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 1),
  sort_order BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE IF NOT EXISTS chuanheng.users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  is_president INTEGER NOT NULL DEFAULT 0 CHECK (is_president IN (0,1) AND (is_president = 0 OR role = 'admin')),
  permissions TEXT NOT NULL DEFAULT '[]', password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0,1))
);
CREATE TABLE IF NOT EXISTS chuanheng.sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES chuanheng.users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON chuanheng.sessions(expires_at);
CREATE TABLE IF NOT EXISTS chuanheng.registrations (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES chuanheng.users(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL REFERENCES chuanheng.activities(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, UNIQUE (user_id, activity_id)
);
CREATE TABLE IF NOT EXISTS chuanheng.site_status (
  id INTEGER PRIMARY KEY CHECK (id = 1), paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
);
CREATE TABLE IF NOT EXISTS chuanheng.rate_limits (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL, until_at BIGINT NOT NULL
);
INSERT INTO chuanheng.site_status (id, paused, revision) VALUES (1,0,1) ON CONFLICT DO NOTHING;

-- No browser access; the trusted Vercel backend connects through the pooler.
ALTER TABLE chuanheng.site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE chuanheng.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE chuanheng.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE chuanheng.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE chuanheng.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chuanheng.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chuanheng.site_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE chuanheng.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA chuanheng FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA chuanheng FROM PUBLIC, anon, authenticated;

-- Keep this bucket private. Downloads go through the website's maintenance gate.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('chuanheng-uploads', 'chuanheng-uploads', false, 3145728,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
