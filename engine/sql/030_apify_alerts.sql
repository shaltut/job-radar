-- Dedup state for the monthly Apify spend alert (one row per YYYY-MM that has alerted).
CREATE TABLE IF NOT EXISTS apify_alerts (
  month      TEXT PRIMARY KEY,           -- 'YYYY-MM'
  pct        INTEGER NOT NULL,
  alerted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
