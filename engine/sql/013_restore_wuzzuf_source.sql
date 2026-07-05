-- 013_restore_wuzzuf_source.sql
-- Restore Wuzzuf as a selectable source. It was retired in 007 (DELETE), but it's a real
-- MENA board and is wanted back as an option. Paid Apify actor → seeds OFF (P3).
-- Append-only; idempotent; apply as `jobradar`.

INSERT INTO sources (name, market, enabled, enable_by_default) VALUES
  ('wuzzuf','mena', false, false)
ON CONFLICT (name) DO NOTHING;
