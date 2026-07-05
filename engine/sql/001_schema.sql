CREATE TABLE IF NOT EXISTS sources (
  id         SERIAL PRIMARY KEY,
  name       TEXT UNIQUE NOT NULL,
  market     TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id            BIGSERIAL PRIMARY KEY,
  dedupe_hash   TEXT UNIQUE NOT NULL,
  source        TEXT NOT NULL,
  external_id   TEXT,
  title         TEXT NOT NULL,
  company       TEXT,
  location      TEXT,
  remote        BOOLEAN,
  url           TEXT NOT NULL,
  description   TEXT,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  market        TEXT NOT NULL,
  posted_at     TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT NOT NULL DEFAULT 'new',
  score         INT,
  raw           JSONB
);

CREATE INDEX IF NOT EXISTS idx_jobs_status        ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_discovered_at ON jobs(discovered_at);
