export const ALLOWED_STATUSES = ["new", "shortlisted", "applied", "interviewing", "offer", "rejected", "dismissed"] as const
export type AllowedStatus = (typeof ALLOWED_STATUSES)[number]
// Statuses a user can FILTER by — includes 'notified', which the engine sets (digest) but the user can't set manually.
export const FILTERABLE_STATUSES = ["new", "notified", "shortlisted", "applied", "interviewing", "offer", "rejected", "dismissed"] as const
export function isValidStatus(s: unknown): s is AllowedStatus {
  return typeof s === "string" && (ALLOWED_STATUSES as readonly string[]).includes(s)
}

/**
 * Coerce a raw bulk-update `ids` payload into a non-empty array of positive integers,
 * or null if invalid. Tolerates string ids: jobs.id is BIGSERIAL, so node-pg returns
 * it as a string and the client round-trips ids as strings (e.g. ["12","34"]). This
 * mirrors the single-row route's parseInt tolerance — the whole batch is rejected if
 * any id is non-numeric.
 */
export function normalizeJobIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const ids = raw.map((x) => (typeof x === "number" ? x : parseInt(String(x), 10)))
  if (!ids.every((x) => Number.isInteger(x) && x > 0)) return null
  return ids
}

// Canonical work-type values — engine-written `jobs.work_mode`. Single source of
// truth for filter validation (parseListParams) + the header MultiSelect options.
export const WORK_MODES = ["remote", "onsite", "hybrid"] as const
export type WorkMode = (typeof WORK_MODES)[number]

// Canonical AI-classified job category (16-taxonomy + "Other") — engine-written `jobs.category`
// (#122). Single source of truth for filter validation + the header MultiSelect options.
export const CATEGORIES = [
  "Technology & IT", "Healthcare", "Engineering", "Finance & Accounting", "Business & Management",
  "Sales & Marketing", "Human Resources", "Legal & Compliance", "Education", "Creative & Design",
  "Administration", "Logistics & Supply Chain", "Construction & Real Estate", "Hospitality & Tourism",
  "Manufacturing & Skilled Trades", "Government & Public Sector", "Other",
] as const
export type Category = (typeof CATEGORIES)[number]

// Canonical standardized eligibility / work-authorization requirement — engine-written
// `jobs.eligibility_std` (#121). Single source of truth for filter validation + options.
export const ELIGIBILITY_STD = [
  "us_citizen_only", "us_work_authorization", "eu_work_authorization", "uk_work_authorization",
  "gcc_residency", "security_clearance", "none", "other",
] as const
export type EligibilityStd = (typeof ELIGIBILITY_STD)[number]

// Friendly short labels for the eligibility badge + MultiSelect filter options.
export const ELIGIBILITY_STD_LABELS: Record<EligibilityStd, string> = {
  us_citizen_only: "US citizens",
  us_work_authorization: "US work auth",
  eu_work_authorization: "EU work auth",
  uk_work_authorization: "UK work auth",
  gcc_residency: "GCC residency",
  security_clearance: "Clearance",
  none: "—",
  other: "Other",
}

// Sortable columns — whitelist mapping the public sort key to a real column. Only
// these keys ever reach the ORDER BY, so user input can never inject SQL.
export type SortKey = "status" | "score" | "title" | "company" | "location" | "market" | "source" | "posted" | "added" | "materials"
const SORT_COLUMNS: Record<SortKey, string> = {
  status: "status", score: "score", title: "title", company: "company", location: "location",
  market: "market", source: "source", posted: "posted_at", added: "discovered_at", materials: "materials_status",
}
export const SORT_KEYS = Object.keys(SORT_COLUMNS) as SortKey[]
export type SortDir = "asc" | "desc"
export interface SortSpec { col: SortKey; dir: SortDir }
const DATE_WINDOWS = [7, 30, 90] as const

export interface ListParams {
  statuses: string[]      // empty ⇒ hide 'dismissed'
  markets: string[]
  sources: string[]
  titles: string[]
  companies: string[]
  locations: string[]
  workModes: string[]
  categories: string[]
  eligibilities: string[]
  scoreMin: number | null
  scoreMax: number | null
  addedWithin: number | null
  postedWithin: number | null
  hasMaterials: boolean
  q: string               // free-text search over title + matched_skills + tech_stack; "" ⇒ no filter
  sorts: SortSpec[]
  page: number
  limit: number
  offset: number
}

export function parseListParams(sp: URLSearchParams): ListParams {
  const multi = (key: string): string[] => sp.getAll(key).map((s) => s.trim().slice(0, 200)).filter(Boolean)
  const statuses = multi("statuses").filter((s) => (FILTERABLE_STATUSES as readonly string[]).includes(s))
  const markets = multi("markets").filter((m) => m === "global" || m === "mena")
  const sources = multi("sources")
  const titles = multi("titles")
  const companies = multi("companies")
  const locations = multi("locations")
  const workModes = multi("workModes").filter((w) => (WORK_MODES as readonly string[]).includes(w))
  const categories = multi("categories").filter((c) => (CATEGORIES as readonly string[]).includes(c))
  const eligibilities = multi("eligibilities").filter((e) => (ELIGIBILITY_STD as readonly string[]).includes(e))
  const score = (v: string | null): number | null => { const n = parseInt(v || "", 10); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null }
  const scoreMin = score(sp.get("scoreMin"))
  const scoreMax = score(sp.get("scoreMax"))
  const within = (v: string | null): number | null => { const n = parseInt(v || "", 10); return (DATE_WINDOWS as readonly number[]).includes(n) ? n : null }
  const addedWithin = within(sp.get("added"))
  const postedWithin = within(sp.get("posted"))
  const hasMaterials = sp.get("materials") === "ready"
  const q = (sp.get("q") || "").trim().slice(0, 200)
  const sorts: SortSpec[] = (sp.get("sort") || "").split(",").map((s) => s.trim()).filter(Boolean)
    .map((tok) => { const [col, dir] = tok.split(":"); return { col, dir } as { col: string; dir: string } })
    .filter((s): s is SortSpec => s.col in SORT_COLUMNS && (s.dir === "asc" || s.dir === "desc"))
  const page = Math.min(1_000_000, Math.max(1, parseInt(sp.get("page") || "1", 10) || 1))
  const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") || "50", 10) || 50))
  return { statuses, markets, sources, titles, companies, locations, workModes, categories, eligibilities, scoreMin, scoreMax, addedWithin, postedWithin, hasMaterials, q, sorts, page, limit, offset: (page - 1) * limit }
}

export interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>
}

/**
 * Build the stacked WHERE conditions, numbering params from startIdx.
 * `tenant_id = $1` is always the first condition (tenantId is always $1); the
 * caller seeds startIdx at 2 so every other placeholder shifts up by one.
 */
function filterConds(tenantId: string, p: ListParams, startIdx: number): { conds: string[]; values: unknown[] } {
  const conds: string[] = ["tenant_id = $1"]
  const values: unknown[] = [tenantId]
  let i = startIdx
  if (p.statuses.length) { conds.push(`status = ANY($${i++})`); values.push(p.statuses) }
  else { conds.push(`status <> 'dismissed'`) }
  if (p.markets.length) { conds.push(`market = ANY($${i++})`); values.push(p.markets) }
  if (p.sources.length) { conds.push(`source = ANY($${i++})`); values.push(p.sources) }
  if (p.titles.length) { conds.push(`title = ANY($${i++})`); values.push(p.titles) }
  if (p.companies.length) { conds.push(`company = ANY($${i++})`); values.push(p.companies) }
  if (p.locations.length) { conds.push(`location = ANY($${i++})`); values.push(p.locations) }
  if (p.workModes.length) { conds.push(`work_mode = ANY($${i++})`); values.push(p.workModes) }
  if (p.categories.length) { conds.push(`category = ANY($${i++})`); values.push(p.categories) }
  if (p.eligibilities.length) { conds.push(`eligibility_std = ANY($${i++})`); values.push(p.eligibilities) }
  if (p.scoreMin != null) { conds.push(`score >= $${i++}`); values.push(p.scoreMin) }
  if (p.scoreMax != null) { conds.push(`score <= $${i++}`); values.push(p.scoreMax) }
  if (p.addedWithin) { conds.push(`discovered_at >= now() - ($${i++} || ' days')::interval`); values.push(String(p.addedWithin)) }
  if (p.postedWithin) { conds.push(`posted_at >= now() - ($${i++} || ' days')::interval`); values.push(String(p.postedWithin)) }
  if (p.hasMaterials) { conds.push(`materials_status = 'ready'`) }
  if (p.q) {
    // Escape LIKE/ILIKE metacharacters (% _ \) in the raw term so a literal "%" or "_"
    // typed by the user matches literally instead of acting as a wildcard.
    const safe = p.q.replace(/[%_\\]/g, "\\$&")
    conds.push(`(title ILIKE $${i} ESCAPE '\\' OR EXISTS (SELECT 1 FROM unnest(matched_skills) x WHERE x ILIKE $${i} ESCAPE '\\') OR EXISTS (SELECT 1 FROM unnest(tech_stack) y WHERE y ILIKE $${i} ESCAPE '\\'))`)
    values.push(`%${safe}%`)
    i++
  }
  return { conds, values }
}

/** Build a whitelisted, injection-safe ORDER BY from the multi-sort stack. */
export function buildOrderBy(sorts: SortSpec[]): string {
  const valid = sorts.filter((s) => s.col in SORT_COLUMNS)
  if (valid.length === 0) return "discovered_at DESC, id DESC"
  return valid.map((s) => `${SORT_COLUMNS[s.col]} ${s.dir === "asc" ? "ASC" : "DESC"} NULLS LAST`).join(", ") + ", id DESC"
}

export async function listJobs(client: Queryable, tenantId: string, p: ListParams) {
  const lf = filterConds(tenantId, p, 2)
  const where = `WHERE ${lf.conds.join(" AND ")}`
  const totalRes = await client.query(`SELECT count(*)::int AS total FROM jobs ${where}`, lf.values)
  const total: number = totalRes.rows[0]?.total ?? 0
  const limIdx = lf.values.length + 1
  const offIdx = lf.values.length + 2
  const orderBy = buildOrderBy(p.sorts)        // whitelisted (no injection)
  const listSql = `
    SELECT id, title, company, location, remote, market, source, url, posted_at, discovered_at, status, score, score_reason, tags,
           seniority_fit, domain_fit, remote_fit, matched_skills, missing_skills,
           clean_title, tech_stack, work_mode, locations, eligibility, category, eligibility_std,
           cv_pdf, cover_pdf, materials_status, apply_answers, status_changed_at, salary_range, salary_source, salary_ask,
           salary_usd_min, salary_usd_max
    FROM jobs ${where}
    ORDER BY ${orderBy}
    LIMIT $${limIdx} OFFSET $${offIdx}`.trim()
  const listRes = await client.query(listSql, [...lf.values, p.limit, p.offset])
  return { jobs: listRes.rows, total, totalPages: Math.max(1, Math.ceil(total / p.limit)) }
}

/** Fetch one job by id, scoped to tenant (IDOR guard: a wrong-tenant id yields no row). */
export async function getJob(client: Queryable, tenantId: string, id: number) {
  const res = await client.query(
    `SELECT id, title, company, location, remote, market, source, url, posted_at, discovered_at, status, score, score_reason, tags,
            seniority_fit, domain_fit, remote_fit, matched_skills, missing_skills,
            clean_title, tech_stack, work_mode, locations, eligibility, category, eligibility_std,
            cv_pdf, cover_pdf, materials_status, apply_answers, status_changed_at, salary_range, salary_source, salary_ask,
            salary_usd_min, salary_usd_max, description
       FROM jobs WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  )
  return res.rows[0] ?? null
}

/** Update one job's status, scoped to tenant (IDOR guard: a wrong-tenant id updates nothing). */
export async function updateJobStatus(client: Queryable, tenantId: string, id: number, status: string) {
  const res = await client.query(
    "UPDATE jobs SET status = $1, status_changed_at = now() WHERE id = $2 AND tenant_id = $3 RETURNING id, status",
    [status, id, tenantId],
  )
  return res.rows[0] ?? null
}

/** Bulk status change for a set of job ids (one UPDATE), scoped to tenant. Returns the updated ids. */
export async function updateJobStatuses(client: Queryable, tenantId: string, ids: number[], status: string): Promise<number[]> {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const res = await client.query(
    "UPDATE jobs SET status = $1, status_changed_at = now() WHERE id = ANY($2) AND tenant_id = $3 RETURNING id",
    [status, ids, tenantId],
  )
  return res.rows.map((r) => Number(r.id))
}

export interface Facets { titles: string[]; companies: string[]; locations: string[]; markets: string[]; sources: string[] }

/** Distinct non-empty values per filterable column, over ALL jobs for the tenant (unfiltered otherwise). */
export async function distinctFacets(client: Queryable, tenantId: string): Promise<Facets> {
  const res = await client.query(`
    SELECT
      coalesce(array_agg(DISTINCT title    ORDER BY title)    FILTER (WHERE title    IS NOT NULL AND title    <> ''), '{}') AS titles,
      coalesce(array_agg(DISTINCT company  ORDER BY company)  FILTER (WHERE company  IS NOT NULL AND company  <> ''), '{}') AS companies,
      coalesce(array_agg(DISTINCT location ORDER BY location) FILTER (WHERE location IS NOT NULL AND location <> ''), '{}') AS locations,
      coalesce(array_agg(DISTINCT market   ORDER BY market)   FILTER (WHERE market   IS NOT NULL), '{}') AS markets,
      coalesce(array_agg(DISTINCT source   ORDER BY source)   FILTER (WHERE source   IS NOT NULL), '{}') AS sources
    FROM jobs WHERE tenant_id = $1`, [tenantId])
  const r = res.rows[0] ?? {}
  return {
    titles: r.titles ?? [], companies: r.companies ?? [], locations: r.locations ?? [],
    markets: r.markets ?? [], sources: r.sources ?? [],
  }
}

/** Fetch the company name for a single job id, scoped to tenant (IDOR guard). Null if missing/empty. */
export async function getJobCompany(client: Queryable, tenantId: string, id: number): Promise<string | null> {
  const res = await client.query("SELECT company FROM jobs WHERE id = $1 AND tenant_id = $2", [id, tenantId])
  const company = res.rows[0]?.company
  return typeof company === "string" && company.trim() ? company : null
}

export interface SkillGap { skill: string; count: number }

/** Most-demanded missing skills across the tenant's high-scoring inbox (score >= threshold). */
export async function getSkillsGap(
  client: Queryable,
  tenantId: string,
  { threshold = 70, limit = 30 }: { threshold?: number; limit?: number } = {},
): Promise<{ skills: SkillGap[]; jobCount: number }> {
  const gapSql = `
    SELECT skill, count(*)::int AS count
    FROM (SELECT unnest(missing_skills) AS skill FROM jobs
           WHERE tenant_id = $1 AND score >= $2 AND status IN ('new','notified','shortlisted') AND missing_skills IS NOT NULL) s
    WHERE skill <> ''
    GROUP BY skill ORDER BY count DESC, skill ASC LIMIT $3`.trim()
  const countSql = `SELECT count(*)::int AS n FROM jobs
    WHERE tenant_id = $1 AND score >= $2 AND status IN ('new','notified','shortlisted') AND missing_skills IS NOT NULL`.trim()
  const [gapRes, countRes] = await Promise.all([
    client.query(gapSql, [tenantId, threshold, limit]),
    client.query(countSql, [tenantId, threshold]),
  ])
  return { skills: gapRes.rows as SkillGap[], jobCount: countRes.rows[0]?.n ?? 0 }
}
