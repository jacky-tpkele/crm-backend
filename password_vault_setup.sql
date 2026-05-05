-- Password vault tables
CREATE TABLE IF NOT EXISTS password_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username           TEXT NOT NULL,
  name               TEXT NOT NULL,
  platform           TEXT,
  account            TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_items_user_created ON password_items(username, created_at DESC);

CREATE TABLE IF NOT EXISTS vault_security (
  username         TEXT PRIMARY KEY,
  second_pass_hash TEXT NOT NULL,
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
