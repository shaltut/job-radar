import { describe, it, expect } from "vitest"
import { parseListParams, buildOrderBy, isValidStatus, listJobs, updateJobStatus, updateJobStatuses, getSkillsGap, normalizeJobIds, distinctFacets, getJob, getJobCompany, WORK_MODES, CATEGORIES, ELIGIBILITY_STD } from "@/lib/jobs-repo"

// Tenant id used throughout — every jobs-repo fn now REQUIRES one (tenant-scoping + IDOR guards).
const TENANT = "3"

function fakeClient() {
  const calls: { text: string; values?: unknown[] }[] = []
  return {
    calls,
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values })
      if (/count\(\*\)/i.test(text)) return { rows: [{ total: 1 }] }
      if (/UPDATE jobs/i.test(text)) return { rows: (values as unknown[])[1] === 999 ? [] : [{ id: (values as unknown[])[1], status: (values as unknown[])[0] }] }
      if (/SELECT id, title/i.test(text)) return { rows: [{ id: 1, title: "Senior Backend Engineer" }] }
      return { rows: [] }
    },
  }
}

/** A client that always returns no rows — used to prove IDOR-guarded fns return null/empty. */
function emptyClient() {
  const calls: { text: string; values?: unknown[] }[] = []
  return { calls, query: async (text: string, values?: unknown[]) => { calls.push({ text, values }); return { rows: [] } } }
}

// ── NEW: parseListParams (q free-text search) ────────────────────────────────

describe("parseListParams (q free-text search)", () => {
  it("trims and reads q", () => {
    expect(parseListParams(new URLSearchParams("q=" + encodeURIComponent("  react  "))).q).toBe("react")
  })
  it("caps q at 200 chars", () => {
    const long = "x".repeat(500)
    const p = parseListParams(new URLSearchParams("q=" + long))
    expect(p.q.length).toBe(200)
  })
  it("empty/missing q → empty string (no filter)", () => {
    expect(parseListParams(new URLSearchParams("")).q).toBe("")
    expect(parseListParams(new URLSearchParams("q=   ")).q).toBe("")
  })
})

// ── NEW: parseListParams (grid) ──────────────────────────────────────────────

describe("parseListParams (grid)", () => {
  it("parses repeated array filters, validating against allow-lists", () => {
    const sp = new URLSearchParams()
    sp.append("statuses", "new"); sp.append("statuses", "bogus"); sp.append("statuses", "shortlisted")
    sp.append("markets", "global"); sp.append("markets", "xx")
    sp.append("sources", "remoteok"); sp.append("sources", "bayt")
    const p = parseListParams(sp)
    expect(p.statuses).toEqual(["new", "shortlisted"])  // 'bogus' dropped
    expect(p.markets).toEqual(["global"])               // 'xx' dropped
    expect(p.sources).toEqual(["remoteok", "bayt"])
  })
  it("keeps the engine-set 'notified' status as a filter value (filterable, not user-settable)", () => {
    const sp = new URLSearchParams()
    sp.append("statuses", "notified"); sp.append("statuses", "new")
    expect(parseListParams(sp).statuses).toEqual(["notified", "new"])
    expect(isValidStatus("notified")).toBe(false) // still not manually settable via the API
  })
  it("parses score range filters", () => {
    const p = parseListParams(new URLSearchParams("scoreMin=70&scoreMax=200"))
    expect(p.scoreMin).toBe(70)
    expect(p.scoreMax).toBe(100)   // clamped to 100
  })
  it("parses a multi-sort spec, dropping unknown cols/dirs", () => {
    const p = parseListParams(new URLSearchParams("sort=score:desc,company:asc,bogus:desc,title:sideways"))
    expect(p.sorts).toEqual([{ col: "score", dir: "desc" }, { col: "company", dir: "asc" }])
  })
  it("defaults: empty arrays, null ranges, empty sorts", () => {
    const p = parseListParams(new URLSearchParams(""))
    expect(p.statuses).toEqual([]); expect(p.sorts).toEqual([]); expect(p.scoreMin).toBeNull()
    expect(p.workModes).toEqual([])
  })
})

// ── NEW: parseListParams (workModes) ──────────────────────────────────────────

describe("parseListParams (workModes)", () => {
  it("keeps valid work modes, drops invalid ones", () => {
    const sp = new URLSearchParams()
    sp.append("workModes", "remote"); sp.append("workModes", "bogus"); sp.append("workModes", "hybrid")
    expect(parseListParams(sp).workModes).toEqual(["remote", "hybrid"])
  })
  it("accepts all three canonical values", () => {
    const sp = new URLSearchParams()
    for (const m of WORK_MODES) sp.append("workModes", m)
    expect(parseListParams(sp).workModes).toEqual(["remote", "onsite", "hybrid"])
  })
  it("missing/empty → empty array", () => {
    expect(parseListParams(new URLSearchParams("")).workModes).toEqual([])
  })
})

// ── NEW: parseListParams (categories, eligibilities) — #122 + #121 ───────────

describe("parseListParams (categories)", () => {
  it("keeps valid categories, drops invalid ones", () => {
    const sp = new URLSearchParams()
    sp.append("categories", "Technology & IT"); sp.append("categories", "Bogus"); sp.append("categories", "Healthcare")
    expect(parseListParams(sp).categories).toEqual(["Technology & IT", "Healthcare"])
  })
  it("accepts all 17 canonical categories", () => {
    const sp = new URLSearchParams()
    for (const c of CATEGORIES) sp.append("categories", c)
    expect(parseListParams(sp).categories).toEqual([...CATEGORIES])
  })
  it("missing/empty → empty array", () => {
    expect(parseListParams(new URLSearchParams("")).categories).toEqual([])
  })
})

describe("parseListParams (eligibilities)", () => {
  it("keeps valid eligibility_std values, drops invalid ones", () => {
    const sp = new URLSearchParams()
    sp.append("eligibilities", "us_citizen_only"); sp.append("eligibilities", "bogus"); sp.append("eligibilities", "none")
    expect(parseListParams(sp).eligibilities).toEqual(["us_citizen_only", "none"])
  })
  it("accepts all 8 canonical eligibility_std values", () => {
    const sp = new URLSearchParams()
    for (const e of ELIGIBILITY_STD) sp.append("eligibilities", e)
    expect(parseListParams(sp).eligibilities).toEqual([...ELIGIBILITY_STD])
  })
  it("missing/empty → empty array", () => {
    expect(parseListParams(new URLSearchParams("")).eligibilities).toEqual([])
  })
})

// ── NEW: parseListParams (facet arrays via repeated params) ──────────────────

describe("parseListParams (facet arrays via repeated params)", () => {
  it("reads repeated params and preserves comma-containing values intact", () => {
    const sp = new URLSearchParams()
    sp.append("locations", "Riyadh, Saudi Arabia")   // value CONTAINS a comma
    sp.append("locations", "Dubai")
    sp.append("titles", "Senior Backend Engineer")
    sp.append("companies", "Acme, Inc.")
    const p = parseListParams(sp)
    expect(p.locations).toEqual(["Riyadh, Saudi Arabia", "Dubai"])  // NOT split on the comma
    expect(p.titles).toEqual(["Senior Backend Engineer"])
    expect(p.companies).toEqual(["Acme, Inc."])
  })
  it("statuses/markets still validated; empties dropped", () => {
    const sp = new URLSearchParams()
    sp.append("statuses", "new"); sp.append("statuses", "bogus")
    sp.append("markets", "global"); sp.append("markets", "xx")
    sp.append("titles", "  ")
    const p = parseListParams(sp)
    expect(p.statuses).toEqual(["new"]); expect(p.markets).toEqual(["global"]); expect(p.titles).toEqual([])
  })
})

// ── NEW: buildOrderBy ────────────────────────────────────────────────────────

describe("buildOrderBy", () => {
  it("maps whitelisted cols in priority order, always ends id DESC", () => {
    expect(buildOrderBy([{ col: "score", dir: "desc" }, { col: "company", dir: "asc" }]))
      .toBe("score DESC NULLS LAST, company ASC NULLS LAST, id DESC")
  })
  it("maps posted/added to real columns", () => {
    expect(buildOrderBy([{ col: "posted", dir: "asc" }])).toBe("posted_at ASC NULLS LAST, id DESC")
    expect(buildOrderBy([{ col: "added", dir: "desc" }])).toBe("discovered_at DESC NULLS LAST, id DESC")
  })
  it("empty → default discovered_at DESC, id DESC", () => {
    expect(buildOrderBy([])).toBe("discovered_at DESC, id DESC")
  })
})

// ── KEPT: isValidStatus ───────────────────────────────────────────────────────

describe("isValidStatus", () => {
  it("accepts the lifecycle statuses and rejects others", () => {
    for (const s of ["new", "shortlisted", "applied", "interviewing", "offer", "rejected", "dismissed"]) expect(isValidStatus(s)).toBe(true)
    expect(isValidStatus("notified")).toBe(false)
    expect(isValidStatus("garbage")).toBe(false)
    expect(isValidStatus(5)).toBe(false)
  })
})

// ── KEPT: normalizeJobIds ─────────────────────────────────────────────────────

describe("normalizeJobIds", () => {
  it("coerces string ids to integers (jobs.id is BIGSERIAL → node-pg returns strings)", () => {
    expect(normalizeJobIds(["12", "34"])).toEqual([12, 34])
  })
  it("accepts numeric ids unchanged", () => {
    expect(normalizeJobIds([12, 34])).toEqual([12, 34])
  })
  it("accepts mixed string/number ids", () => {
    expect(normalizeJobIds([12, "34"])).toEqual([12, 34])
  })
  it("rejects an empty array", () => {
    expect(normalizeJobIds([])).toBeNull()
  })
  it("rejects a non-array", () => {
    expect(normalizeJobIds(null)).toBeNull()
    expect(normalizeJobIds("12")).toBeNull()
    expect(normalizeJobIds(undefined)).toBeNull()
  })
  it("rejects the whole batch if any id is non-numeric", () => {
    expect(normalizeJobIds(["12", "abc"])).toBeNull()
  })
  it("rejects non-positive ids", () => {
    expect(normalizeJobIds([0])).toBeNull()
    expect(normalizeJobIds(["-1"])).toBeNull()
  })
})

// ── listJobs (grid) ───────────────────────────────────────────────────────────

describe("listJobs (grid)", () => {
  it("empty status filter hides dismissed; applies stacked filters + multi-sort", async () => {
    const c = fakeClient()
    const sp = new URLSearchParams("markets=global&sources=remoteok&sort=score:desc,company:asc&limit=50")
    sp.append("titles", "backend")
    const p = parseListParams(sp)
    const out = await listJobs(c, TENANT, p)
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).toMatch(/status <> 'dismissed'/)
    expect(listCall.text).toMatch(/market = ANY/)
    expect(listCall.text).toMatch(/source = ANY/)
    expect(listCall.text).toMatch(/title = ANY/)
    expect(listCall.text).not.toMatch(/ILIKE/)
    expect(listCall.text).toMatch(/ORDER BY score DESC NULLS LAST, company ASC NULLS LAST, id DESC/)
    expect(typeof out.total).toBe("number")
    expect(out).not.toHaveProperty("counts")
  })
  it("explicit statuses use status = ANY (no dismissed exclusion)", async () => {
    const c = fakeClient()
    const sp = new URLSearchParams()
    sp.append("statuses", "applied"); sp.append("statuses", "dismissed")
    await listJobs(c, TENANT, parseListParams(sp))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).toMatch(/status = ANY\(\$2\)/)
    expect(listCall.text).not.toMatch(/status <> 'dismissed'/)
  })
  it("list select still includes summary + materials columns", async () => {
    const c = fakeClient()
    await listJobs(c, TENANT, parseListParams(new URLSearchParams("")))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).toMatch(/clean_title/); expect(listCall.text).toMatch(/materials_status/); expect(listCall.text).toMatch(/apply_answers/)
  })
  it("list select includes salary columns", async () => {
    const c = fakeClient()
    await listJobs(c, TENANT, parseListParams(new URLSearchParams("")))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).toMatch(/salary_range/); expect(listCall.text).toMatch(/salary_source/); expect(listCall.text).toMatch(/salary_ask/)
  })
  it("list select includes the new USD salary columns", async () => {
    const c = fakeClient()
    await listJobs(c, TENANT, parseListParams(new URLSearchParams("")))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).toMatch(/salary_usd_min/); expect(listCall.text).toMatch(/salary_usd_max/)
  })
  it("issues a SELECT count(*) query before the list query", async () => {
    const c = fakeClient()
    await listJobs(c, TENANT, parseListParams(new URLSearchParams("")))
    const countCall = c.calls.find((x) => /SELECT count\(\*\)/i.test(x.text))!
    expect(countCall).toBeDefined()
    // count query must come before the list query
    const countIdx = c.calls.indexOf(countCall)
    const listIdx = c.calls.findIndex((x) => /SELECT id, title/.test(x.text))
    expect(countIdx).toBeLessThan(listIdx)
  })
  it("total comes from the count query (numeric)", async () => {
    const c = fakeClient()
    const out = await listJobs(c, TENANT, parseListParams(new URLSearchParams("")))
    expect(out.total).toBe(1)  // fakeClient returns { total: 1 } for count(*)
    expect(typeof out.total).toBe("number")
  })
  it("added/posted/materials filters appear in list, with params", async () => {
    const c = fakeClient()
    await listJobs(c, TENANT, parseListParams(new URLSearchParams("added=30&posted=7&materials=ready")))
    const list = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(list.text).toMatch(/discovered_at >= now\(\) - \(\$\d+ \|\| ' days'\)::interval/)
    expect(list.text).toMatch(/posted_at >= now\(\) - \(\$\d+ \|\| ' days'\)::interval/)
    expect(list.text).toMatch(/materials_status = 'ready'/)
    expect(list.values).toContain("30")
    expect(list.values).toContain("7")
  })
})

// ── NEW: listJobs / distinctFacets tenant scoping (Task 3) ───────────────────

describe("listJobs tenant scoping", () => {
  it("filters tenant_id first ($1), before any other stacked condition", async () => {
    const c = fakeClient()
    await listJobs(c, TENANT, parseListParams(new URLSearchParams("")))
    const sel = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(sel.text).toMatch(/WHERE tenant_id = \$1/)
    expect(sel.values?.[0]).toBe(TENANT)
  })
  it("stacks with other filters: tenant_id = $1 first, then status/market etc. shifted up by one", async () => {
    const c = fakeClient()
    const sp = new URLSearchParams()
    sp.append("markets", "global"); sp.append("statuses", "applied")
    await listJobs(c, TENANT, parseListParams(sp))
    const sel = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(sel.text).toMatch(/WHERE tenant_id = \$1 AND status = ANY\(\$2\) AND market = ANY\(\$3\)/)
    expect(sel.values).toEqual([TENANT, ["applied"], ["global"], 50, 0])
  })
})

// ── NEW: q free-text search WHERE clause ──────────────────────────────────────

describe("listJobs (q free-text search)", () => {
  it("q set: adds a grouped OR condition over title/matched_skills/tech_stack, parameterized once", async () => {
    const c = fakeClient()
    const sp = new URLSearchParams()
    sp.append("markets", "global")
    sp.set("q", "react")
    await listJobs(c, TENANT, parseListParams(sp))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).toMatch(/title ILIKE \$\d+ ESCAPE '\\'/)
    expect(listCall.text).toMatch(/EXISTS \(SELECT 1 FROM unnest\(matched_skills\) x WHERE x ILIKE \$\d+ ESCAPE '\\'\)/)
    expect(listCall.text).toMatch(/EXISTS \(SELECT 1 FROM unnest\(tech_stack\) y WHERE y ILIKE \$\d+ ESCAPE '\\'\)/)
    // parameterized, never string-interpolated: the raw search term must not appear inlined in the SQL text
    expect(listCall.text).not.toMatch(/react/)
    expect(listCall.values).toContain("%react%")
    // still stacks with the other filter (market = ANY)
    expect(listCall.text).toMatch(/market = ANY/)
  })
  it("q empty: no ILIKE/unnest clause added (no-op)", async () => {
    const c = fakeClient()
    await listJobs(c, TENANT, parseListParams(new URLSearchParams("")))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).not.toMatch(/ILIKE/)
    expect(listCall.text).not.toMatch(/unnest\(matched_skills\)/)
    expect(listCall.text).not.toMatch(/unnest\(tech_stack\)/)
  })
  it("q with a normal term: still works, and each ILIKE clause declares ESCAPE '\\'", async () => {
    const c = fakeClient()
    const sp = new URLSearchParams()
    sp.set("q", "react")
    await listJobs(c, TENANT, parseListParams(sp))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.values).toContain("%react%")
    // all three ILIKE clauses (title, matched_skills, tech_stack) declare the escape char
    const escapeCount = (listCall.text.match(/ILIKE \$\d+ ESCAPE '\\'/g) || []).length
    expect(escapeCount).toBe(3)
  })
  it("q containing % or _ is escaped before binding, so it matches literally instead of as a wildcard", async () => {
    const c = fakeClient()
    const sp = new URLSearchParams()
    sp.set("q", "c++_dev%")
    await listJobs(c, TENANT, parseListParams(sp))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    // literal % and _ are backslash-escaped inside the bound value
    expect(listCall.values).toContain("%c++\\_dev\\%%")
    // the raw (unescaped) term must never appear inlined in the SQL text
    expect(listCall.text).not.toMatch(/c\+\+_dev%/)
  })
  it("q containing a literal backslash is itself escaped", async () => {
    const c = fakeClient()
    const sp = new URLSearchParams()
    sp.set("q", "a\\b")
    await listJobs(c, TENANT, parseListParams(sp))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.values).toContain("%a\\\\b%")
  })
})

// ── filterConds (facet = ANY) ─────────────────────────────────────────────────

describe("filterConds (facet = ANY)", () => {
  it("titles/companies/locations use = ANY (exact, not ILIKE)", async () => {
    const c = fakeClient()
    const sp = new URLSearchParams()
    sp.append("titles", "Senior Backend Engineer"); sp.append("companies", "Acme"); sp.append("locations", "Dubai")
    await listJobs(c, TENANT, parseListParams(sp))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).toMatch(/title = ANY/)
    expect(listCall.text).toMatch(/company = ANY/)
    expect(listCall.text).toMatch(/location = ANY/)
    expect(listCall.text).not.toMatch(/ILIKE/)
  })
})

// ── filterConds (workModes = ANY) ─────────────────────────────────────────────

describe("filterConds (workModes)", () => {
  it("emits work_mode = ANY($n) when workModes is set", async () => {
    const c = fakeClient()
    const sp = new URLSearchParams()
    sp.append("workModes", "remote"); sp.append("workModes", "hybrid")
    await listJobs(c, TENANT, parseListParams(sp))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).toMatch(/work_mode = ANY\(\$\d+\)/)
    expect(listCall.values).toContainEqual(["remote", "hybrid"])
  })
  it("no work_mode clause when workModes is empty", async () => {
    const c = fakeClient()
    await listJobs(c, TENANT, parseListParams(new URLSearchParams("")))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).not.toMatch(/work_mode = ANY/)
  })
  it("list select includes work_mode", async () => {
    const c = fakeClient()
    await listJobs(c, TENANT, parseListParams(new URLSearchParams("")))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).toMatch(/work_mode/)
  })
})

// ── filterConds (category / eligibility_std = ANY) — #122 + #121 ─────────────

describe("filterConds (categories)", () => {
  it("emits category = ANY($n) when categories is set", async () => {
    const c = fakeClient()
    const sp = new URLSearchParams()
    sp.append("categories", "Technology & IT"); sp.append("categories", "Healthcare")
    await listJobs(c, TENANT, parseListParams(sp))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).toMatch(/category = ANY\(\$\d+\)/)
    expect(listCall.values).toContainEqual(["Technology & IT", "Healthcare"])
  })
  it("no category clause when categories is empty", async () => {
    const c = fakeClient()
    await listJobs(c, TENANT, parseListParams(new URLSearchParams("")))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).not.toMatch(/category = ANY/)
  })
  it("list select includes category", async () => {
    const c = fakeClient()
    await listJobs(c, TENANT, parseListParams(new URLSearchParams("")))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).toMatch(/\bcategory\b/)
  })
})

describe("filterConds (eligibilities)", () => {
  it("emits eligibility_std = ANY($n) when eligibilities is set", async () => {
    const c = fakeClient()
    const sp = new URLSearchParams()
    sp.append("eligibilities", "us_citizen_only"); sp.append("eligibilities", "none")
    await listJobs(c, TENANT, parseListParams(sp))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).toMatch(/eligibility_std = ANY\(\$\d+\)/)
    expect(listCall.values).toContainEqual(["us_citizen_only", "none"])
  })
  it("no eligibility_std clause when eligibilities is empty", async () => {
    const c = fakeClient()
    await listJobs(c, TENANT, parseListParams(new URLSearchParams("")))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).not.toMatch(/eligibility_std = ANY/)
  })
  it("list select includes eligibility_std", async () => {
    const c = fakeClient()
    await listJobs(c, TENANT, parseListParams(new URLSearchParams("")))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).toMatch(/eligibility_std/)
  })
  it("both filters stack together with tenant_id still first", async () => {
    const c = fakeClient()
    const sp = new URLSearchParams()
    sp.append("categories", "Healthcare"); sp.append("eligibilities", "gcc_residency")
    await listJobs(c, TENANT, parseListParams(sp))
    const listCall = c.calls.find((x) => /SELECT id, title/.test(x.text))!
    expect(listCall.text).toMatch(/WHERE tenant_id = \$1 AND status <> 'dismissed' AND category = ANY\(\$2\) AND eligibility_std = ANY\(\$3\)/)
    expect(listCall.values?.[0]).toBe(TENANT)
  })
})

// ── distinctFacets ────────────────────────────────────────────────────────────

describe("distinctFacets", () => {
  it("runs an array_agg(DISTINCT) query scoped by tenant_id, and maps the row", async () => {
    const c = {
      calls: [] as { text: string; values?: unknown[] }[],
      query: async (text: string, values?: unknown[]) => {
        ;(c.calls as { text: string; values?: unknown[] }[]).push({ text, values })
        return { rows: [{ titles: ["A"], companies: ["B"], locations: ["C"], markets: ["global"], sources: ["remoteok"] }] }
      },
    }
    const f = await distinctFacets(c, TENANT)
    expect(c.calls[0].text).toMatch(/array_agg\(DISTINCT title/)
    expect(c.calls[0].text).toMatch(/WHERE tenant_id = \$1/)
    expect(c.calls[0].values).toEqual([TENANT])
    expect(f).toEqual({ titles: ["A"], companies: ["B"], locations: ["C"], markets: ["global"], sources: ["remoteok"] })
  })
  it("defaults missing arrays to []", async () => {
    const c = { query: async () => ({ rows: [{}] }) }
    expect(await distinctFacets(c, TENANT)).toEqual({ titles: [], companies: [], locations: [], markets: [], sources: [] })
  })
})

// ── updateJobStatus ───────────────────────────────────────────────────────────

describe("updateJobStatus", () => {
  it("sets status + status_changed_at, scoped by tenant_id, returns the updated row or null", async () => {
    const c = fakeClient()
    const row = await updateJobStatus(c, TENANT, 1, "interviewing")
    expect(row).toEqual({ id: 1, status: "interviewing" })
    const call = c.calls.find((x) => /UPDATE jobs SET status/.test(x.text))!
    expect(call.text).toMatch(/status_changed_at = now\(\)/)
    expect(call.text).toMatch(/WHERE id = \$2 AND tenant_id = \$3/)
    expect(call.values).toEqual(["interviewing", 1, TENANT])
    expect(await updateJobStatus(c, TENANT, 999, "applied")).toBeNull()
  })
  it("IDOR guard: a wrong-tenant id updates nothing (no row) even if the id exists for another tenant", async () => {
    const c = emptyClient()
    const row = await updateJobStatus(c, TENANT, 5, "applied")
    expect(row).toBeNull()
    expect(c.calls[0].text).toMatch(/WHERE id = \$2 AND tenant_id = \$3/)
    expect(c.calls[0].values).toEqual(["applied", 5, TENANT])
  })
})

// ── updateJobStatuses (bulk) ──────────────────────────────────────────────────

describe("updateJobStatuses (bulk)", () => {
  function bulkClient(ids: number[]) {
    const calls: { text: string; values?: unknown[] }[] = []
    return { calls, query: async (text: string, values?: unknown[]) => { calls.push({ text, values }); return { rows: ids.map((id) => ({ id })) } } }
  }
  it("no-op on empty ids (no query)", async () => {
    const c = bulkClient([])
    expect(await updateJobStatuses(c, TENANT, [], "shortlisted")).toEqual([])
    expect(c.calls.length).toBe(0)
  })
  it("issues one parameterized UPDATE ... WHERE id = ANY AND tenant_id, returns numeric ids", async () => {
    const c = bulkClient([7, 8, 9])
    const out = await updateJobStatuses(c, TENANT, [7, 8, 9], "shortlisted")
    expect(out).toEqual([7, 8, 9])
    const call = c.calls[0]
    expect(call.text).toMatch(/UPDATE jobs SET status = \$1, status_changed_at = now\(\) WHERE id = ANY\(\$2\) AND tenant_id = \$3/)
    expect(call.values).toEqual(["shortlisted", [7, 8, 9], TENANT])
  })
  it("IDOR guard: ids belonging to another tenant are excluded (fake returns none)", async () => {
    const c = emptyClient()
    const out = await updateJobStatuses(c, TENANT, [5], "shortlisted")
    expect(out).toEqual([])
    expect(c.calls[0].text).toMatch(/AND tenant_id = \$3/)
    expect(c.calls[0].values).toEqual(["shortlisted", [5], TENANT])
  })
})

// ── getJob ────────────────────────────────────────────────────────────────────

describe("getJob", () => {
  it("selects one job by id including description, scoped by tenant_id", async () => {
    const calls: { text: string; values?: unknown[] }[] = []
    const c = { query: async (text: string, values?: unknown[]) => { calls.push({ text, values }); return { rows: [{ id: 7, description: "full text" }] } } }
    const row = await getJob(c, TENANT, 7)
    expect(calls[0].text).toMatch(/WHERE id = \$1 AND tenant_id = \$2/)
    expect(calls[0].text).toMatch(/description/)
    expect(calls[0].values).toEqual([7, TENANT])
    expect(row).toEqual({ id: 7, description: "full text" })
  })
  it("returns null when not found", async () => {
    const c = { query: async () => ({ rows: [] }) }
    expect(await getJob(c, TENANT, 999)).toBeNull()
  })
  it("IDOR guard: a wrong-tenant id yields no row", async () => {
    const c = emptyClient()
    const r = await getJob(c, TENANT, 5)
    expect(r).toBeNull()
    expect(c.calls[0].text).toMatch(/WHERE id = \$1 AND tenant_id = \$2/)
    expect(c.calls[0].values).toEqual([5, TENANT])
  })
  it("selects the new USD salary columns", async () => {
    const calls: { text: string; values?: unknown[] }[] = []
    const c = { query: async (text: string, values?: unknown[]) => { calls.push({ text, values }); return { rows: [{ id: 7 }] } } }
    await getJob(c, TENANT, 7)
    expect(calls[0].text).toMatch(/salary_usd_min/); expect(calls[0].text).toMatch(/salary_usd_max/)
  })
  it("selects category and eligibility_std (#122 + #121)", async () => {
    const calls: { text: string; values?: unknown[] }[] = []
    const c = { query: async (text: string, values?: unknown[]) => { calls.push({ text, values }); return { rows: [{ id: 7 }] } } }
    await getJob(c, TENANT, 7)
    expect(calls[0].text).toMatch(/\bcategory\b/); expect(calls[0].text).toMatch(/eligibility_std/)
  })
})

// ── getJobCompany ─────────────────────────────────────────────────────────────

describe("getJobCompany", () => {
  it("selects company scoped by tenant_id", async () => {
    const calls: { text: string; values?: unknown[] }[] = []
    const c = { query: async (text: string, values?: unknown[]) => { calls.push({ text, values }); return { rows: [{ company: "Acme" }] } } }
    const company = await getJobCompany(c, TENANT, 7)
    expect(company).toBe("Acme")
    expect(calls[0].text).toMatch(/WHERE id = \$1 AND tenant_id = \$2/)
    expect(calls[0].values).toEqual([7, TENANT])
  })
  it("IDOR guard: a wrong-tenant id yields null", async () => {
    const c = emptyClient()
    expect(await getJobCompany(c, TENANT, 5)).toBeNull()
    expect(c.calls[0].values).toEqual([5, TENANT])
  })
})

// ── getSkillsGap ──────────────────────────────────────────────────────────────

function gapClient() {
  const calls: { text: string; values?: unknown[] }[] = []
  return {
    calls,
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values })
      if (/unnest\(missing_skills\)/i.test(text)) return { rows: [{ skill: "Kubernetes", count: 4 }, { skill: "Go", count: 2 }] }
      if (/count\(\*\)::int AS n/i.test(text)) return { rows: [{ n: 9 }] }
      return { rows: [] }
    },
  }
}

describe("getSkillsGap", () => {
  it("aggregates missing_skills over the tenant's high-score inbox and returns jobCount", async () => {
    const c = gapClient()
    const out = await getSkillsGap(c, TENANT, { threshold: 70 })
    expect(out.skills).toEqual([{ skill: "Kubernetes", count: 4 }, { skill: "Go", count: 2 }])
    expect(out.jobCount).toBe(9)
    const gap = c.calls.find((q) => /unnest\(missing_skills\)/i.test(q.text))!
    expect(gap.text).toMatch(/WHERE tenant_id = \$1 AND score >= \$2 AND status IN \('new','notified','shortlisted'\) AND missing_skills IS NOT NULL/)
    expect(gap.text).toMatch(/GROUP BY skill ORDER BY count DESC, skill ASC LIMIT \$3/)
    expect(gap.values).toEqual([TENANT, 70, 30])
    const count = c.calls.find((q) => /count\(\*\)::int AS n/i.test(q.text))!
    expect(count.text).toMatch(/WHERE tenant_id = \$1 AND score >= \$2/)
    expect(count.values).toEqual([TENANT, 70])
  })
  it("defaults threshold 70 and limit 30", async () => {
    const c = gapClient()
    await getSkillsGap(c, TENANT)
    const gap = c.calls.find((q) => /unnest\(missing_skills\)/i.test(q.text))!
    expect(gap.values).toEqual([TENANT, 70, 30])
  })
})
