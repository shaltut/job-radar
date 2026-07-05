CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,          -- stored lowercased by the app
  password_hash TEXT NOT NULL,
  name          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON users TO jobsearch_app;
GRANT USAGE, SELECT ON SEQUENCE users_id_seq TO jobsearch_app;
