/**
 * discovery-repo — pure query builders + validators for the UI-controlled
 * discovery settings (sources / exclude keywords), scoped per tenant (C2).
 *
 * Mirrors `jobs-repo.ts`: reuses the `Queryable` interface, all SQL is
 * parameterized, and every function takes a required `tenantId` as the
 * first-after-`client` arg (same convention as `jobs-repo.ts`'s
 * `listJobs`/`getJob`/etc from C1) — fail-closed, a caller can never run an
 * unscoped query by omitting it.
 *
 * `sources` remains the GLOBAL catalog (name/market/enable_by_default — informational
 * only). Per-tenant enablement/interval/filter-config lives in `tenant_source_config`,
 * keyed on (tenant_id, source_name). Reads LEFT JOIN the catalog against the caller's
 * tenant row, COALESCE-defaulting to "off" when no row exists yet — this one mechanism
 * handles both "tenant hasn't touched this source" and "brand-new global source"
 * identically (opt-in). Writes are UPSERTs into `tenant_source_config`; the safety
 * net against junk rows is `tenant_source_config.source_name`'s FK to `sources(name)`
 * (replacing the old "UPDATE-only against a seeded row" property from the
 * single-tenant/global-`sources`-column era).
 *
 * IMPORTANT (data-driven, P5): the set of toggleable sources is whatever the
 * job-radar seed put in `sources`. There is NO enum of source names here, so a
 * newly added source (e.g. jobicy, arbeitnow) shows up automatically.
 */

import type { Queryable } from "@/lib/jobs-repo"

export type { Queryable }

export interface DiscoverySource {
  name: string
  market: string
  enabled: boolean
  enable_by_default: boolean
  run_interval_hours: number
}

/** The only values the UI may set for run_interval_hours. */
export const ALLOWED_INTERVALS = [6, 12, 24, 48, 72] as const
export type AllowedInterval = (typeof ALLOWED_INTERVALS)[number]

export interface DiscoveryConfig {
  sources: DiscoverySource[]
  /** Per-source saved filter values (tenant_source_config.config JSONB), keyed by source name. */
  sourceConfigs: Record<string, Record<string, unknown>>
  excludes: string[]
}

const MAX_TERM_LEN = 80

/**
 * Normalize an exclude term: trim, collapse internal whitespace, lowercase.
 * Returns "" for empty / whitespace-only / over-length input so callers can
 * reject it uniformly. The job-radar filter lowercases too, so a normalized
 * union with profile.excludeKeywords collapses dupes cleanly.
 */
export function normalizeTerm(s: string): string {
  if (typeof s !== "string") return ""
  const norm = s.trim().replace(/\s+/g, " ").toLowerCase()
  if (norm.length === 0) return ""
  if (norm.length > MAX_TERM_LEN) return ""
  return norm
}

/**
 * True when `name` is a source the seed already created (membership against the
 * loaded config). Data-driven — no hardcoded source list. Source *names* are
 * global (the catalog is shared), so this needs no tenantId.
 */
export function isKnownSource(cfg: DiscoveryConfig, name: string): boolean {
  return cfg.sources.some((s) => s.name === name)
}

/**
 * Read the full discovery config for `tenantId`: the global sources catalog
 * LEFT JOINed against this tenant's `tenant_source_config` row (COALESCE
 * defaults: enabled=false, config={}, run_interval_hours=24 when no row exists
 * yet), plus this tenant's own exclude terms.
 */
export async function getDiscoveryConfig(c: Queryable, tenantId: string): Promise<DiscoveryConfig> {
  const [s, e] = await Promise.all([
    c.query(
      `SELECT s.name, s.market, COALESCE(tsc.enabled, false) AS enabled, s.enable_by_default,
              COALESCE(tsc.config, '{}'::jsonb) AS config, COALESCE(tsc.run_interval_hours, 24) AS run_interval_hours
         FROM sources s
         LEFT JOIN tenant_source_config tsc ON tsc.source_name = s.name AND tsc.tenant_id = $1
        ORDER BY s.market, s.name`,
      [tenantId],
    ),
    c.query("SELECT term FROM discovery_excludes WHERE tenant_id = $1 ORDER BY term", [tenantId]),
  ])
  return {
    sources: s.rows.map((r) => ({
      name: r.name as string,
      market: r.market as string,
      enabled: Boolean(r.enabled),
      enable_by_default: Boolean(r.enable_by_default),
      run_interval_hours: Number(r.run_interval_hours) || 24,
    })),
    sourceConfigs: Object.fromEntries(
      s.rows.map((r) => [r.name as string, (r.config ?? {}) as Record<string, unknown>])
    ),
    excludes: e.rows.map((r) => r.term as string),
  }
}

/**
 * Flip a source toggle for `tenantId`. UPSERT into `tenant_source_config` keyed on
 * (tenant_id, source_name) — safe against junk rows via that column's FK to
 * `sources(name)`. Caller must validate the name with `isKnownSource` first.
 */
export async function setSourceEnabled(c: Queryable, tenantId: string, name: string, enabled: boolean): Promise<void> {
  await c.query(
    `INSERT INTO tenant_source_config (tenant_id, source_name, enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, source_name) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
    [tenantId, name, enabled],
  )
}

/**
 * Set the run_interval_hours for a source for `tenantId`. Same UPSERT shape as
 * `setSourceEnabled`. Caller must validate the name with `isKnownSource` and
 * `hours` against `ALLOWED_INTERVALS` first.
 */
export async function setSourceInterval(c: Queryable, tenantId: string, name: string, hours: number): Promise<void> {
  await c.query(
    `INSERT INTO tenant_source_config (tenant_id, source_name, run_interval_hours)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, source_name) DO UPDATE SET run_interval_hours = EXCLUDED.run_interval_hours, updated_at = now()`,
    [tenantId, name, hours],
  )
}

/** Add an exclude keyword for `tenantId` (normalized, idempotent). Throws on invalid input. */
export async function addExclude(c: Queryable, tenantId: string, term: string): Promise<void> {
  const t = normalizeTerm(term)
  if (!t) throw new Error("invalid exclude term")
  await c.query(
    "INSERT INTO discovery_excludes (tenant_id, term) VALUES ($1, $2) ON CONFLICT (tenant_id, term) DO NOTHING",
    [tenantId, t],
  )
}

/** Remove an exclude keyword for `tenantId` by normalized term. Throws on invalid input. */
export async function removeExclude(c: Queryable, tenantId: string, term: string): Promise<void> {
  const t = normalizeTerm(term)
  if (!t) throw new Error("invalid exclude term")
  await c.query("DELETE FROM discovery_excludes WHERE tenant_id = $1 AND term = $2", [tenantId, t])
}

export interface DiscoveryDiff {
  sources?: { name: string; enabled: boolean }[]
  addExcludes?: string[]
  removeExcludes?: string[]
  intervals?: { name: string; hours: number }[]
}

/**
 * Apply a partial diff (the PUT body) for `tenantId` and return the fresh config
 * (server truth).
 *
 * Validation is strict-reject: an unknown source or a malformed exclude term
 * throws BEFORE any write, so the route returns 400 and nothing is applied.
 * Source membership is checked against the *current* config (data-driven), which
 * is read once up front. Excludes are normalized + length-capped here.
 */
export async function applyDiscoveryDiff(c: Queryable, tenantId: string, diff: DiscoveryDiff): Promise<DiscoveryConfig> {
  const current = await getDiscoveryConfig(c, tenantId)

  // ---- validate everything first (no partial writes) ----
  for (const s of diff.sources ?? []) {
    if (typeof s?.name !== "string" || typeof s?.enabled !== "boolean" || !isKnownSource(current, s.name)) {
      throw new Error(`unknown source: ${s?.name}`)
    }
  }
  const addTerms = (diff.addExcludes ?? []).map((t) => normalizeTerm(t))
  if (addTerms.some((t) => !t)) throw new Error("invalid exclude term (add)")
  const removeTerms = (diff.removeExcludes ?? []).map((t) => normalizeTerm(t))
  if (removeTerms.some((t) => !t)) throw new Error("invalid exclude term (remove)")
  for (const iv of diff.intervals ?? []) {
    if (typeof iv?.name !== "string" || !isKnownSource(current, iv.name)) {
      throw new Error(`unknown source: ${iv?.name}`)
    }
    if (!(ALLOWED_INTERVALS as readonly number[]).includes(iv.hours)) {
      throw new Error(`invalid interval hours: ${iv.hours} (must be one of ${ALLOWED_INTERVALS.join(", ")})`)
    }
  }

  // ---- apply ----
  for (const s of diff.sources ?? []) await setSourceEnabled(c, tenantId, s.name, s.enabled)
  for (const t of addTerms) await addExclude(c, tenantId, t)
  for (const t of removeTerms) await removeExclude(c, tenantId, t)
  for (const iv of diff.intervals ?? []) await setSourceInterval(c, tenantId, iv.name, iv.hours)

  return getDiscoveryConfig(c, tenantId)
}

// ---- On-demand discovery runs (queue + status for the "Run discovery" button) ----

export type RunKind = "discover" | "score" | "tailor"
export const RUN_KINDS: RunKind[] = ["discover", "score", "tailor"]
export function isRunKind(v: unknown): v is RunKind {
  return typeof v === "string" && (RUN_KINDS as string[]).includes(v)
}

export interface DiscoveryRun {
  id: number
  kind: string                    // discover | score | tailor
  status: string                  // requested | running | done | error
  source: string                  // ui | timer
  requested_at: string
  started_at: string | null
  finished_at: string | null
  fetched: number | null
  matched: number | null
  inserted: number | null
  note: string | null
  error: string | null
}

const RUN_COLS =
  "id, kind, status, source, requested_at, started_at, finished_at, fetched, matched, inserted, note, error"

/** The most recent run of `kind` (any status) for `tenantId`, or null if none yet. */
export async function latestDiscoveryRun(c: Queryable, tenantId: string, kind: RunKind = "discover"): Promise<DiscoveryRun | null> {
  const res = await c.query(
    `SELECT ${RUN_COLS} FROM discovery_runs WHERE tenant_id = $1 AND kind = $2 ORDER BY id DESC LIMIT 1`,
    [tenantId, kind],
  )
  return (res.rows[0] as DiscoveryRun) ?? null
}

/**
 * Retroactively dismiss `tenantId`'s inbox jobs (status new/notified) whose title
 * matches any of THIS tenant's current exclude keywords. Excludes normally only
 * filter at discovery time; this applies them to jobs already in the queue.
 * Returns how many were dismissed. Only touches new/notified — never undoes a job
 * the user has already triaged.
 *
 * Tenant-scoped on BOTH sides (C2 security fix): the excludes read is
 * `WHERE tenant_id = $1` and the `UPDATE jobs` carries `AND tenant_id = $2` — pre-C2
 * this ran a fully unscoped UPDATE across ALL tenants' jobs.
 *
 * Unicode-safe: regex metacharacters are escaped in JS (preserving letters like ä/é),
 * then passed as a parameterized `text[]` to `~* ANY(...)`. Word boundaries use \y
 * so "intern" does not hit "international".
 */
export async function dismissMatchingExcluded(c: Queryable, tenantId: string): Promise<number> {
  const { rows } = await c.query("SELECT term FROM discovery_excludes WHERE tenant_id = $1", [tenantId])
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escape regex metachars; keep letters (incl. ä/é/…)
  const patterns = rows
    .map((r) => String(r.term).trim())
    .filter((t) => t.length > 0)
    .map((t) => (/^\w/.test(t) ? "\\y" : "") + escapeRe(t) + (/\w$/.test(t) ? "\\y" : "")) // whole-word boundaries, conditional: only added when the term starts/ends with a word char (so c#, c++, .net work correctly)
  if (patterns.length === 0) return 0
  const res = await c.query(
    `UPDATE jobs SET status = 'dismissed', status_changed_at = now()
       WHERE status IN ('new','notified') AND title ~* ANY($1::text[]) AND tenant_id = $2
       RETURNING id`,
    [patterns, tenantId],
  )
  return res.rows.length
}

// ---- Per-source filter config (tenant_source_config.config JSONB) ----

/**
 * True when `v` is a plain object (not null, not array).
 * Used to validate the config body before writing.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/**
 * Read the per-source filter config for `name`, scoped to `tenantId`.
 * Returns {} when the tenant has no row for this source, or it holds a
 * non-object value.
 */
export async function getSourceConfig(c: Queryable, tenantId: string, name: string): Promise<Record<string, unknown>> {
  const res = await c.query(
    "SELECT config FROM tenant_source_config WHERE tenant_id = $1 AND source_name = $2",
    [tenantId, name],
  )
  const row = res.rows[0] as { config?: unknown } | undefined
  if (!row) return {}
  return isPlainObject(row.config) ? (row.config as Record<string, unknown>) : {}
}

/**
 * Persist a per-source filter config for `name`, scoped to `tenantId`. UPSERT
 * into `tenant_source_config` (safe against junk rows via the source_name FK to
 * `sources(name)`). Validates that `config` is a plain object and, when
 * `advanced` is present, that it is also a plain object (not array/null/primitive).
 * Throws a descriptive error on bad input so the caller can map it to HTTP 400.
 */
export async function setSourceConfig(
  c: Queryable,
  tenantId: string,
  name: string,
  config: unknown,
): Promise<Record<string, unknown>> {
  if (!isPlainObject(config)) {
    throw new Error("config must be a plain object")
  }
  if ("advanced" in config && !isPlainObject(config.advanced)) {
    throw new Error("config.advanced must be a plain object when present")
  }
  await c.query(
    `INSERT INTO tenant_source_config (tenant_id, source_name, config)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, source_name) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`,
    [tenantId, name, config],
  )
  return config as Record<string, unknown>
}

/**
 * Queue a UI run of `kind` for `tenantId` unless one of that kind is already
 * requested/running for this tenant (dedup), then return the latest run so the
 * caller can render status. The host poller picks it up.
 *
 * NOTE (C2 boundary): this route stays owner-gated at the API layer (the engine
 * that executes discover/score/tailor runs is single-tenant until Phase 4), but
 * the repo function itself is tenant-scoped like every other fn here — the route
 * simply always resolves the OWNER's tenantId before calling it.
 */
export async function requestDiscoveryRun(c: Queryable, tenantId: string, kind: RunKind = "discover"): Promise<DiscoveryRun | null> {
  await c.query(
    `INSERT INTO discovery_runs (tenant_id, source, kind)
     SELECT $1, 'ui', $2
     WHERE NOT EXISTS (SELECT 1 FROM discovery_runs WHERE tenant_id = $1 AND kind = $2 AND status IN ('requested','running'))`,
    [tenantId, kind],
  )
  return latestDiscoveryRun(c, tenantId, kind)
}

// ---- Per-source preview queue (source_previews table) ----

export interface SourcePreview {
  id: number
  source: string
  status: string   // requested | running | done | error
  result: unknown  // { fetched, kept, jobs:[...] } when done, else null
  error: string | null
}

/**
 * Insert a preview request for `source` (capped at `lim` records) for `tenantId`
 * and return its row id. Validates `source` against the live DB config — rejects
 * unknown sources with a descriptive error so the caller can return 400.
 */
export async function createPreview(c: Queryable, tenantId: string, source: string, lim = 10): Promise<number> {
  const cfg = await getDiscoveryConfig(c, tenantId)
  if (!isKnownSource(cfg, source)) {
    throw new Error(`unknown source: ${source}`)
  }
  const res = await c.query(
    "INSERT INTO source_previews (tenant_id, source, lim) VALUES ($1, $2, $3) RETURNING id",
    [tenantId, source, lim],
  )
  return (res.rows[0] as { id: number }).id
}

/**
 * Fetch a single preview row by id, scoped to `tenantId` (IDOR guard: a
 * wrong-tenant id yields null — matches `getJob`'s param-order convention,
 * values `[id, tenantId]`).
 */
export async function getPreview(c: Queryable, tenantId: string, id: number): Promise<SourcePreview | null> {
  const res = await c.query(
    "SELECT id, source, status, result, error FROM source_previews WHERE id = $1 AND tenant_id = $2",
    [id, tenantId],
  )
  return (res.rows[0] as SourcePreview) ?? null
}
