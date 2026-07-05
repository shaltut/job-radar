# Job Radar — End-to-End Documentation

Personal job-search automation: discover tech roles across free (and optionally paid) job
boards, score them against your résumé, triage from a web UI, auto-tailor a CV + cover letter
for shortlisted roles, track the application lifecycle, and get a daily Telegram digest.

This doc covers the whole system — `engine/` (the discovery/scoring/tailoring pipeline) and
`app/` (the web UI) — as packaged in this self-host repo. See the root `README.md` for the
quickstart; this doc is the deeper reference.

---

## 1. Architecture at a glance

Two codebases over **one shared Postgres database** (`jobsearch`):

| Component | Path | Stack | Role |
|-----------|------|-------|------|
| **engine** | `engine/` | Node 22 ESM, deps: `pg` + `playwright`, `node:test` | discover · score · tailor · digest · apply-support, run on a schedule (Docker: supercronic; bare-metal: systemd) |
| **app** | `app/` | Next.js 16, React 19, Auth.js v5, Tailwind v4 | the web UI — triage jobs, tune discovery, download tailored materials |

**Database roles (least privilege):**
- `jobradar` — owns the schema; the engine connects as this (full DML, runs migrations).
- `jobsearch_app` — the web app connects as this; granted only `SELECT` on `jobs`,
  scoped `UPDATE` (status/status_changed_at), and scoped access to the discovery-config /
  run-queue tables (see §11). It can never run DDL or delete jobs.

**Data flow:**

```
        ┌────────────── engine (Node) ───────────────────────┐
sources → discover → dedupe → upsert(jobs) → score(LLM) → (tailor on shortlist) → digest
        └───────────────────────┬──────────────────────────────┘
                                 │ jobsearch DB (Postgres)
        ┌───────────────────────┴──────────────────────────────┐
        │  app: triage, filter, sort, bulk status;              │
        │  discovery settings: sources / countries / excludes   │
        └────────────────────────────────────────────────────────┘
```

The two sides are decoupled — they only share the DB. The UI never calls the engine
directly; it **queues requests** that the engine's poller executes (see §6).

---

## 2. The pipeline (lifecycle of a job)

1. **discover** — fetch from enabled sources, filter by the search profile, dedupe, upsert new
   rows as `status='new'`.
2. **score** — an LLM rates each unscored `new` job 0–100 against your résumé (`score` +
   `score_reason`). Discover auto-chains scoring (see §6).
3. **triage** — you review in the app, sorted by score; shortlist the good ones (status →
   `shortlisted`), dismiss junk (→ `dismissed`).
4. **tailor** — for `shortlisted` jobs, an LLM writes a role-tailored CV + cover letter,
   rendered to PDF (in-repo `engine/pdf/generate-pdf.mjs`, no external dependency), plus 7
   reusable "apply answers"; `materials_status='ready'`.
5. **apply** — download the CV/Cover/Kit from the app and apply (an optional Playwright-driven
   apply skill can drive no-login ATS forms; sites behind bot-walls or requiring login stay
   human-gated). Status → `applied`.
6. **lifecycle** — move through `interviewing` / `offer` / `rejected`; `status_changed_at`
   stamps every transition.
7. **digest** — a daily Telegram digest of new high-scoring jobs + follow-up reminders for
   stale `applied`/`interviewing` rows.

Job statuses: `new` → `notified` → `shortlisted` → `applied` → `interviewing` → `offer` /
`rejected` / `dismissed`.

---

## 3. Sources

The registry is built by `buildSources(env)` / `buildSourcesFromDb(env, client)` in
`engine/src/sources/index.js`.

| Family | Type | Default | Auth/gate | Notes |
|--------|------|---------|-----------|-------|
| remotive | free fetch | **on** | none | remote-only API |
| remoteok | free fetch | **on** | none | full public feed |
| jobicy | free fetch | **on** | none | geo usa\|canada\|europe, dev slice |
| arbeitnow | free fetch | **on** | none | EU / visa-sponsorship |
| weworkremotely | free fetch (RSS) | **on** | none | hand-rolled RSS parser |
| himalayas | free fetch | **on** | none | remote-worldwide JSON API |
| bayt / wuzzuf / naukrigulf / gulftalent | Apify | off | `APIFY_TOKEN` | Gulf/MENA boards, per-country |
| indeed | Apify | off | `APIFY_TOKEN` | wide-net, anti-bot-prone |
| wellfound | Apify | off | `APIFY_TOKEN` | startup jobs |
| linkedin | Apify | off | `APIFY_TOKEN` | public guest search |
| careerjet | free API | off | `CAREERJET_AFFID` | aggregator, per-country, free affiliate id |
| reddit (r/forhire etc.) | free API | off | `REDDIT_CLIENT_ID/SECRET` | needs an app id+secret, else skipped |

- **Free fetch sources** (`engine/src/sources/<name>.js`): export `fetch<Name>(profile, fetchImpl)`,
  map rows through `mapValid` (`engine/src/normalize.js`), and return `[]` on any non-ok/throw/bad
  response. Always on.
- **Apify sources**: built via `makeApifySource()` (`engine/src/sources/apify.js`), gated on
  `APIFY_TOKEN`. Some maps are defensive/unverified until run live — check output field
  mapping on first live run of a newly-enabled source.
- **Careerjet**: a free aggregator API but gated on a free affiliate id (`CAREERJET_AFFID`).

**Gating model:** when the discovery-config tables exist (they do after migrations), the **DB
toggle is the effective control** — `buildSourcesFromDb` emits the candidate paid set whenever
the token/affid is present, then `applySourceToggles` keeps only families toggled on. The
`JOBRADAR_ENABLE_*` env flags only gate the **fallback** path used when the DB/tables are
absent. The token/affid prerequisite is **never** bypassed: toggling a paid source on without
its key yields nothing (no accidental spend).

**Add a new source:**
- *Free API/RSS*: write `engine/src/sources/<name>.js` (mirror `jobicy.js`); add it to the base
  `list` in `buildSources`; add a migration `INSERT (name,market,enabled,enable_by_default)`;
  add tests.
- *Paid Apify / keyed API*: add a map + a gated block in `buildSources` with a `forceX` param,
  pass `forceX: hasDbConfig` in `buildSourcesFromDb`; migration seeds it **off**; tests.

---

## 4. Search profile (what gets kept)

`engine/config/profile.json` (copy from `profile.example.json`) drives the **post-fetch
filter** (`engine/src/filter.js` `matchesProfile`), matched against `title + tags +
description`:
- `includeKeywords` — keep if ≥1 matches.
- `requireKeywords` — if non-empty, keep only if ≥1 matches (seniority gate).
- `excludeKeywords` — drop if any matches.
- `remoteOnly` — if `true`, drop onsite roles.

Most sources only send the **first** include keyword as the server-side query; the full
include/require/exclude logic is applied locally after fetch.

---

## 5. UI-controlled discovery

Three small config tables in `jobsearch` let the web app drive discovery without editing
files. Auto-saved — every toggle / country / exclude change PUTs immediately.

| Table | Controls |
|-------|----------|
| `sources` | per-family on/off (data-driven — new sources appear automatically) |
| `discovery_countries` | per-country on/off for the Gulf-region sources |
| `discovery_excludes` | extra exclude keywords, set-unioned with `profile.json` excludes |

**Reader semantics** (`buildSourcesFromDb` + `loadDiscoveryConfig`,
`engine/src/discoveryStore.js`):
- **No tables / DB down →** falls back to the env-flag path. Discovery never breaks if the
  config is missing.
- **Empty present tables →** treated as "no override".
- **DB toggle wins over `JOBRADAR_ENABLE_*` flags, never over the token/affid.**

---

## 6. On-demand runs & the queue/poller

Because the (potentially containerized) UI can't invoke the engine directly, runs go through
a **queue**:

- **`discovery_runs`** table = request queue + history (`id, kind, status, source,
  requested_at, started_at, finished_at, fetched, matched, inserted, note, error`).
  `kind ∈ {discover, score, tailor}`, `status ∈ {requested, running, done, error}`.
- **Buttons** in the app → `POST /api/jobs/discovery/run {kind}` → `requestDiscoveryRun`
  inserts a `requested` row (deduped). The UI polls status.
- **Poller**: in Docker, the `* * * * *` line in `engine/docker/crontab` (supercronic); on
  bare-metal, the `job-radar-pipeline-trigger.timer` (see `engine/systemd/`). Runs, in order:
  `cli.js discover --if-requested`, `score --if-requested`, `tailor --if-requested`,
  `preview --if-requested`. Each **claims** pending rows of its kind (`claimRuns`), runs once,
  and records the outcome (`finishRuns`/`failRuns`).
- **Chain:** a successful `discover` auto-`enqueueRun(pool, 'score')` — the poller scores right
  after discovering, on both the button path and the schedule.

`engine/src/discoveryRuns.js` holds `claimRuns / finishRuns / failRuns / enqueueRun`.

---

## 7. Dedupe

`engine/src/dedupe.js` `dedupeHash(job)` → a stable hash stored in `jobs.dedupe_hash` (unique;
`ON CONFLICT (dedupe_hash) DO NOTHING` on insert). Core-title + company, with location included
only for non-remote roles. Applies to **future inserts** only.

---

## 8. Scoring & 9. Tailoring / materials

**Scoring** (`engine/src/scoreRun.js`, `engine/src/openai.js`): scores unscored `new` jobs
against your résumé (`config/resume.json`) → `score` + `score_reason` + a match breakdown
(`seniority_fit`/`domain_fit`/`remote_fit`, `matched_skills`/`missing_skills`).
`OPENAI_API_KEY` required.

**Tailoring** (`engine/src/tailorRun.js`, `engine/src/tailor.js`, `engine/src/tailorEngine.js`):
for `shortlisted` jobs without materials, produces a tailored CV + cover-letter (HTML),
rendered to PDF by `engine/pdf/generate-pdf.mjs` (Playwright/Chromium — fully in-repo, no
external tooling), plus a 7-field `apply_answers` JSONB (summary / why_role /
relevant_experience / salary / notice / work_auth / years). Sets `cv_pdf`, `cover_pdf`,
`apply_answers`, `materials_status='ready'`. Output dir `engine/output` is shared with `app`
via the `job-materials` Docker volume (read-only on the app side).

**Material downloads** stream the PDF with `Content-Disposition` filename
`[ApplicantName]-[YYYY-MM-DD]-[Company]-[CV|Cover].pdf`. `ApplicantName` comes from the
`APPLICANT_NAME` env var.

### Decoupling from career-ops

Earlier internal deployments of this engine shelled out to a separate, unvendored repo for
PDF rendering (`generate-pdf.mjs`) and the base CV (`cv.md`). This self-host package is fully
first-party instead: `engine/pdf/generate-pdf.mjs` and `engine/config/cv.example.md` (copy to
`cv.md`) ship in this repo, and `JOBRADAR_CV_PATH` / `JOBRADAR_OUTPUT_DIR` /
`JOBRADAR_PDF_SCRIPT` all default to in-repo relative paths (see `.env.example`). No external
Claude/Anthropic tooling is used anywhere in the tailoring path — it runs entirely on OpenAI.

---

## 10. The triage UI

- **Tabs:** Inbox (new+notified) · Shortlisted · Applied · Interviewing · Closed
  (offer/rejected/dismissed) · All — each with a live count.
- **Filters:** market, source, title/company search, Added/Posted date ranges, has-materials,
  show-dismissed.
- **Sort:** Added (default), Posted, Score, Company.
- **Columns:** status (dropdown), score (tiered pill), title, company, location, market,
  source, posted, added, materials (CV / Cover / Kit).
- **Bulk:** row checkboxes → bulk status change.

API: `GET /api/jobs` (list+counts), `PATCH /api/jobs` (bulk status), `PATCH /api/jobs/[id]`
(single status), `GET/PUT /api/jobs/discovery` (config), `GET/POST /api/jobs/discovery/run`
(queue), `POST /api/jobs/discovery/dismiss-matching`.

---

## 11. Database schema & migrations

Apply migrations as the `jobradar` (owner) role — the `migrate` service in
`docker-compose.yml` does this automatically on first boot, in this order (verified-safe,
see the root plan history): all of `engine/sql/001..032` first, then all of `app/sql/001..004`
— the app's migrations only reference tables/columns the early engine migrations create.
Every file is idempotent (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`), so re-running the
migrator against an already-migrated DB is a safe no-op.

`engine/sql/` and `app/sql/` are the source of truth — see each file for specifics.

---

## 12. Scheduling

**Option A — Docker Compose (recommended):** the `engine` container runs
[supercronic](https://github.com/aptible/supercronic) against `engine/docker/crontab`, a 1:1
translation of the timers below. No host cron/systemd needed.

**Option B — bare-metal + systemd:** `engine/systemd/*.service` + `*.timer` (carried over
verbatim) remain a fully valid alternative if you'd rather run the engine directly on a host
— e.g. for direct filesystem access to tailored PDFs, or to avoid an in-container cron.

| Job | Cadence | Purpose |
|-----|---------|---------|
| `discover` | hourly | scheduled discovery (auto-chains scoring) |
| `score` | 00:15 / 06:15 / 12:15 / 18:15 | scheduled scoring |
| `digest` | daily 08:00 (`JOBRADAR_TZ`) | Telegram digest + follow-ups |
| `tailor` | every 30 min | scheduled tailoring |
| poller (`--if-requested` chain) | every ~1 min | on-demand runs triggered from the UI |

To install the bare-metal units instead of using Docker for the engine:
```bash
sudo cp engine/systemd/job-radar-*.service engine/systemd/job-radar-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now job-radar-digest.timer job-radar-pipeline-trigger.timer
# discover/score/tailor timers are optional — enable the ones you want on a fixed schedule
```

---

## 13. Configuration & secrets

See root `.env.example` for the full, authoritative list of env vars (grouped by
database / auth / Telegram / OpenAI / tailoring / optional sources / apply-queue), each with
a placeholder value and a comment.

**Config files** (gitignored where personal — copy from the matching `*.example.*`):
- `engine/config/profile.json` — the search profile (include/require/exclude keywords).
- `engine/config/resume.json` — structured résumé used for scoring.
- `engine/config/apply-profile.json` — applicant facts for tailoring/answers (name, location,
  salary, notice, work-auth, years).
- `engine/config/cv.md` — base CV (Markdown) that the tailor rewrites per job.
- `engine/config/credentials.json` — apply-site logins, only needed if using the apply skill.

---

## 14. Operations runbook

```bash
# --- one-time setup ---
cp .env.example .env                 # fill in secrets, see .env.example comments
docker compose up -d --build
docker compose logs -f migrate       # confirm migrations applied cleanly
docker compose exec postgres psql -U jobradar -d jobsearch -c "SELECT id FROM tenants WHERE is_owner;"
#  → put that id into JOBRADAR_TENANT_ID in .env
docker compose up -d engine          # restart engine with the tenant id set

# --- run a stage manually ---
docker compose exec engine node src/cli.js discover
docker compose exec engine node src/cli.js score        # or: score --all
docker compose exec engine node src/cli.js tailor
docker compose exec engine node src/cli.js digest

# --- apply a migration by hand (rarely needed — the migrate service does this) ---
docker compose exec -T postgres psql -U jobradar -d jobsearch -v ON_ERROR_STOP=1 -f - < engine/sql/0NN_xxx.sql

# --- tests ---
cd engine && npm test                # node:test
cd app && pnpm install && pnpm test  # vitest (DB-mocked, no live DB needed)
```

---

## 15. Known limitations

- **Server-side search uses only the first include keyword** for several sources; the rest of
  the include/require/exclude logic applies client-side after fetch.
- **Dedupe is by title+company+location**, not URL — a repost with a materially different
  title or company name will appear as a new row.
- **Single page per global source** — pagination is not implemented for most free sources.
- Some paid-source field maps (naukrigulf/gulftalent/indeed/wellfound/careerjet) are
  defensive/unverified until confirmed on a first live run after enabling.
