CREATE TABLE IF NOT EXISTS source_previews (
  id           BIGSERIAL PRIMARY KEY,
  source       TEXT NOT NULL,
  lim          INTEGER NOT NULL DEFAULT 10,
  status       TEXT NOT NULL DEFAULT 'requested',
  result       JSONB,
  error        TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_source_previews_requested ON source_previews(requested_at) WHERE status='requested';
GRANT SELECT, INSERT ON source_previews TO jobsearch_app;
GRANT USAGE ON SEQUENCE source_previews_id_seq TO jobsearch_app;
