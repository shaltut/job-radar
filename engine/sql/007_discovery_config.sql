-- 007_discovery_config.sql
-- UI-controlled discovery config: source toggles, GCC country toggles, exclude keywords.
--
-- FILE ONLY — NOT APPLIED in this build. Apply with the privileged DB owner/admin
-- role (the finance role `jobsearch_app` never runs DDL). Idempotent: all CREATE
-- IF NOT EXISTS, all seeds ON CONFLICT DO NOTHING (re-running only inserts new
-- registry rows; existing user toggles are never clobbered).
--
-- Safety properties this satisfies:
--   P1  Empty config (seeded, no UI writes) reproduces today's behavior.
--   P3  Paid (Apify) sources seed OFF; only run when toggled ON *and* APIFY_TOKEN present.
--   P4  Least-privilege GRANTs to jobsearch_app (no GRANT ALL, no new privs on jobs).
--   P5  No enum/CHECK on source name → adding a registry source needs no schema change.

-- ============================================================================
-- 5.1  Source toggles — reuse + extend the existing `sources` table
-- ============================================================================
-- 001_schema.sql already created sources(id, name UNIQUE, market, enabled DEFAULT
-- true, created_at). Extend it for registry-seeded, data-driven toggling.

ALTER TABLE sources ADD COLUMN IF NOT EXISTS enable_by_default BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT now();

-- 001 created `enabled` with DEFAULT true, which is wrong for a registry-seeded
-- toggle store (a paid source must seed OFF). The seed below sets `enabled`
-- explicitly per row, so the column default only matters for hand-inserted rows;
-- we keep `true` as the harmless re-default for manual inserts.
ALTER TABLE sources ALTER COLUMN enabled DROP DEFAULT;
ALTER TABLE sources ALTER COLUMN enabled SET DEFAULT true;

-- ============================================================================
-- 5.2  Country toggles — discovery_countries
-- ============================================================================
-- On/off bit per GCC country, keyed by the same key as MENA_COUNTRIES[].key.
-- No loc/baytSlug here — those stay in code (the source of truth for HOW to query).
CREATE TABLE IF NOT EXISTS discovery_countries (
  key        TEXT PRIMARY KEY,            -- 'uae','ksa','qatar','kuwait','bahrain','oman'
  enabled    BOOLEAN NOT NULL,            -- no default → seed must be explicit
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 5.3  Exclude keywords — discovery_excludes
-- ============================================================================
-- One row per normalized (lowercased, whitespace-collapsed) term. PRIMARY KEY on
-- term makes add idempotent and remove trivial; merges as a set-union with
-- profile.excludeKeywords (the filter lowercases via norm(), so dupes collapse).
CREATE TABLE IF NOT EXISTS discovery_excludes (
  term       TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 5.4  Seed (idempotent, data-driven) — run by job-radar tooling, NEVER by finance
-- ============================================================================

-- Sources: one row per registry FAMILY, enabled = enable_by_default.
-- Generated from the registry by src/discoveryStore.js → seedSourcesSql(); kept as
-- literal SQL here so the migration is self-contained and reviewable. Paid families
-- (bayt, naukrigulf, gulftalent, linkedin) seed OFF (P3). Jobicy + Arbeitnow are new
-- and auto-seed ON — they appear in the UI with no schema change (P5).
INSERT INTO sources (name, market, enabled, enable_by_default) VALUES
  ('remotive','global', true, true),
  ('remoteok','global', true, true),
  ('jobicy','global', true, true),
  ('arbeitnow','global', true, true),
  ('bayt','mena', false, false),
  ('naukrigulf','mena', false, false),
  ('gulftalent','mena', false, false),
  ('linkedin','global', false, false)
ON CONFLICT (name) DO NOTHING;

-- Wuzzuf retired 2026-06-18 (Egypt-centric, weak GCC fit; replaced by NaukriGulf +
-- GulfTalent). Drop the legacy toggle row so it no longer shows in the UI. Safe:
-- jobs.source is plain TEXT (no FK), so this never cascades; no-op if absent.
DELETE FROM sources WHERE name = 'wuzzuf';

-- Countries: all 6 GCC ON (today's behavior — P1).
INSERT INTO discovery_countries (key, enabled) VALUES
  ('uae',true),('ksa',true),('qatar',true),('kuwait',true),('bahrain',true),('oman',true)
ON CONFLICT (key) DO NOTHING;

-- Excludes: seed from config/profile.json's LIVE excludeKeywords (per spec §5.3),
-- already normalized (lowercased, single-spaced).
INSERT INTO discovery_excludes (term) VALUES
  ('junior'),('jr'),('entry level'),('intern'),('internship'),('graduate'),('trainee'),
  ('apprentice'),('social media'),('marketing'),('sales'),('recruiter'),('seo'),
  ('content writer'),('copywriter'),('graphic designer'),('community manager'),('accountant')
ON CONFLICT (term) DO NOTHING;

-- ============================================================================
-- 8  Least-privilege GRANTs (P4) — run as the DB owner/admin, not jobsearch_app
-- ============================================================================
-- Source/country toggles: read + flip the boolean only. No INSERT/DELETE — the
-- finance role cannot create source rows (seeding is job-radar's job) nor drop them.
GRANT SELECT, UPDATE (enabled, updated_at) ON sources             TO jobsearch_app;
GRANT SELECT, UPDATE (enabled, updated_at) ON discovery_countries TO jobsearch_app;

-- Exclude keywords: read + add + remove. UPDATE not needed (terms are immutable PKs).
GRANT SELECT, INSERT, DELETE ON discovery_excludes TO jobsearch_app;

-- Notes:
--  * No GRANT ALL. No sequence grants: discovery_countries/discovery_excludes have
--    natural text PKs (no SERIAL), and the finance role never INSERTs into `sources`
--    (so it never needs sources_id_seq). If that ever changes, add explicitly:
--      GRANT USAGE ON SEQUENCE sources_id_seq TO jobsearch_app;  -- NOT granted now.
--  * Column-level UPDATE limits the finance role to flipping `enabled` (+ updated_at);
--    it cannot rename a source, change its market, or its enable_by_default.
