# Job Radar

Self-hostable job-search automation: discover roles from multiple job boards, score them
against your résumé with an LLM, triage from a web UI, auto-tailor a CV + cover letter for
shortlisted roles, track the application lifecycle, and get a daily Telegram digest.

This is a **monorepo**:

```
app/       Next.js 16 web UI — triage, discovery settings, tailored-material downloads
engine/    Node 22 discovery/scoring/tailoring pipeline + Telegram bot
docker/    Postgres role bootstrap + the ordered migration runner
docs/      Deeper ops documentation (docs/JOB-RADAR.md)
```

See `docs/JOB-RADAR.md` for the full architecture, pipeline, and operations reference.

---

## Prerequisites

- **Docker + Docker Compose v2** — `docker compose version` (this is the "one command to run
  it" path).
- For dev-mode without Docker: **Node 22** (see `.nvmrc`), **pnpm** for `app/`
  (`corepack enable` or `npm i -g pnpm@10.33.0`), **npm** for `engine/` (ships with Node). The
  two packages deliberately use different package managers — this mirrors a working pattern
  and is not a defect to unify.

---

## Quickstart (Docker)

```bash
git clone <this-repo-url> && cd job-radar
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, JOBS_DB_PASSWORD, AUTH_SECRET, SECRETS_KEY,
# TELEGRAM_BOT_TOKEN/CHAT_ID, OPENAI_API_KEY, APPLICANT_NAME — see .env.example's inline
# comments for how to generate each secret (openssl rand -base64 32, etc).

docker compose up -d --build
docker compose logs -f migrate     # confirm migrations applied cleanly, then Ctrl-C

# Find the owner tenant id and set it:
docker compose exec postgres psql -U jobradar -d jobsearch -c "SELECT id FROM tenants WHERE is_owner;"
#  → put that number into JOBRADAR_TENANT_ID in .env, then:
docker compose up -d engine        # restart engine with the tenant id set
```

Then create your account: temporarily set `REGISTRATION_ENABLED=true` in `.env`,
`docker compose up -d --force-recreate jobs-app`, visit `http://localhost:3000/signup` once,
then flip it back to `false` and recreate `jobs-app` again (admin-only registration by
design).

`docker compose ps` should show `postgres` and `jobs-app` healthy, `migrate` exited (0), and
`engine` running.

---

## Dev mode (no Docker)

```bash
# Postgres + schema only, via Docker:
docker compose up -d postgres migrate

# Web app:
cd app && pnpm install && pnpm dev          # point JOBS_DB_HOST=localhost in your local .env

# Engine (one-off manual run):
cd engine && npm install && npx playwright install chromium
node --env-file=../.env src/cli.js discover

# Or run the engine persistently via systemd instead of Docker — see
# docs/JOB-RADAR.md §12 ("Option B").
```

---

## Troubleshooting

- **First-boot DB errors / role or password mismatch:** `docker/postgres/init-roles.sh` reads
  `JOBS_DB_PASSWORD` from `.env` at container-init time to create the `jobsearch_app` role —
  if you change that value *after* the Postgres volume has already been initialized once, the
  role's password won't update automatically. Either `docker compose exec postgres psql -U
  jobradar -d jobsearch -c "ALTER ROLE jobsearch_app WITH PASSWORD '...'"` or wipe the `pgdata`
  volume for a clean re-init (loses data).
- **Engine fails fast with `JOBRADAR_TENANT_ID unset`:** this is by design, not a bug — set it
  per the Quickstart above once the owner tenant exists.
- **No jobs showing up:** the free sources (RemoteOK, Remotive, Jobicy, Arbeitnow,
  WeWorkRemotely, Himalayas) need no keys and are on by default — run `docker compose exec
  engine node src/cli.js discover` manually and check the logs. Paid sources need both a key
  *and* a toggle on in the discovery settings page (see `docs/JOB-RADAR.md` §3).

---

## Further reading

- `docs/JOB-RADAR.md` — full architecture, pipeline stages, source registry, scheduling,
  migrations, and an operations runbook.
- `app/design-system/job-radar/MASTER.md` — the UI's design system (colors, components,
  patterns) for anyone extending the web app's screens.
