import { describe, it, expect } from "vitest"
import {
  getDiscoveryConfig,
  setSourceEnabled,
  setSourceInterval,
  addExclude,
  removeExclude,
  normalizeTerm,
  isKnownSource,
  applyDiscoveryDiff,
  dismissMatchingExcluded,
  latestDiscoveryRun,
  requestDiscoveryRun,
  getSourceConfig,
  setSourceConfig,
  createPreview,
  getPreview,
  ALLOWED_INTERVALS,
  type DiscoveryConfig,
} from "@/lib/discovery-repo"

const TENANT = "3"

/** Fake Queryable that records calls and answers the two discovery SELECTs (LEFT JOIN shape). */
function fakeClient() {
  const calls: { text: string; values?: unknown[] }[] = []
  return {
    calls,
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values })
      if (/FROM sources/i.test(text) && /SELECT/i.test(text)) {
        return {
          rows: [
            { name: "remotive", market: "global", enabled: true, enable_by_default: true, config: { search: "rust" }, run_interval_hours: 24 },
            { name: "jobicy", market: "global", enabled: true, enable_by_default: true, config: {}, run_interval_hours: 12 },
            { name: "bayt", market: "mena", enabled: false, enable_by_default: false, config: null, run_interval_hours: 48 },
          ],
        }
      }
      if (/FROM discovery_excludes/i.test(text) && /SELECT/i.test(text)) {
        return { rows: [{ term: "junior" }, { term: "intern" }] }
      }
      if (/INSERT INTO source_previews/i.test(text)) {
        return { rows: [{ id: 42 }] }
      }
      return { rows: [] }
    },
  }
}

const SAMPLE_CONFIG: DiscoveryConfig = {
  sources: [
    { name: "remotive", market: "global", enabled: true, enable_by_default: true, run_interval_hours: 24 },
    { name: "bayt", market: "mena", enabled: false, enable_by_default: false, run_interval_hours: 48 },
  ],
  sourceConfigs: {},
  excludes: ["junior", "intern"],
}

describe("normalizeTerm", () => {
  it("lowercases, trims, and collapses internal whitespace", () => {
    expect(normalizeTerm("  iOS  Developer ")).toBe("ios developer")
    expect(normalizeTerm("Content\tWriter")).toBe("content writer")
    expect(normalizeTerm("Junior")).toBe("junior")
  })
  it("returns empty string for whitespace-only input (caller rejects)", () => {
    expect(normalizeTerm("   ")).toBe("")
    expect(normalizeTerm("")).toBe("")
    expect(normalizeTerm("\t\n ")).toBe("")
  })
  it("rejects over-length terms by returning empty string", () => {
    expect(normalizeTerm("x".repeat(80))).toBe("x".repeat(80))
    expect(normalizeTerm("x".repeat(81))).toBe("")
  })
})

describe("isKnownSource", () => {
  it("checks membership against the loaded config (data-driven, no enum) — no tenantId needed", () => {
    expect(isKnownSource(SAMPLE_CONFIG, "remotive")).toBe(true)
    expect(isKnownSource(SAMPLE_CONFIG, "bayt")).toBe(true)
    expect(isKnownSource(SAMPLE_CONFIG, "linkedin")).toBe(false)
    expect(isKnownSource(SAMPLE_CONFIG, "")).toBe(false)
  })
})

describe("getDiscoveryConfig", () => {
  it("scopes both queries by tenantId", async () => {
    const c = fakeClient()
    await getDiscoveryConfig(c, TENANT)
    const sourcesCall = c.calls.find((x) => /FROM sources/i.test(x.text))!
    expect(sourcesCall.text).toMatch(/LEFT JOIN tenant_source_config tsc ON tsc\.source_name = s\.name AND tsc\.tenant_id = \$1/)
    expect(sourcesCall.values).toEqual([TENANT])
    const excludesCall = c.calls.find((x) => /FROM discovery_excludes/i.test(x.text))!
    expect(excludesCall.text).toMatch(/WHERE tenant_id = \$1/)
    expect(excludesCall.values).toEqual([TENANT])
  })

  it("issues the two SELECTs and shapes {sources, excludes}", async () => {
    const c = fakeClient()
    const cfg = await getDiscoveryConfig(c, TENANT)
    expect(cfg.sources).toEqual([
      { name: "remotive", market: "global", enabled: true, enable_by_default: true, run_interval_hours: 24 },
      { name: "jobicy", market: "global", enabled: true, enable_by_default: true, run_interval_hours: 12 },
      { name: "bayt", market: "mena", enabled: false, enable_by_default: false, run_interval_hours: 48 },
    ])
    expect(cfg.excludes).toEqual(["junior", "intern"])
    expect(c.calls.filter((x) => /SELECT/i.test(x.text)).length).toBe(2)
  })

  it("returns run_interval_hours as a number and includes it in the SELECT", async () => {
    const c = fakeClient()
    const cfg = await getDiscoveryConfig(c, TENANT)
    expect(typeof cfg.sources[0].run_interval_hours).toBe("number")
    expect(cfg.sources[0].run_interval_hours).toBe(24)
    // The sources SELECT must include the run_interval_hours column
    expect(c.calls.some((x) => /FROM sources/i.test(x.text) && /run_interval_hours/i.test(x.text))).toBe(true)
  })

  it("returns per-source saved config as sourceConfigs (null → {})", async () => {
    const c = fakeClient()
    const cfg = await getDiscoveryConfig(c, TENANT)
    expect(cfg.sourceConfigs).toEqual({
      remotive: { search: "rust" },
      jobicy: {},
      bayt: {},
    })
    // the sources SELECT must include the (tenant_source_config) config column
    expect(c.calls.some((x) => /FROM sources/i.test(x.text) && /config/i.test(x.text))).toBe(true)
  })
})

describe("setSourceEnabled", () => {
  it("UPSERTs into tenant_source_config keyed on (tenant_id, source_name)", async () => {
    const c = fakeClient()
    await setSourceEnabled(c, TENANT, "bayt", true)
    const call = c.calls.find((x) => /INSERT INTO tenant_source_config/i.test(x.text))!
    expect(call.text).toMatch(/ON CONFLICT \(tenant_id, source_name\) DO UPDATE SET enabled = EXCLUDED\.enabled/)
    expect(call.values).toEqual([TENANT, "bayt", true])
  })
})

describe("setSourceInterval", () => {
  it("UPSERTs run_interval_hours into tenant_source_config keyed on (tenant_id, source_name)", async () => {
    const c = fakeClient()
    await setSourceInterval(c, TENANT, "remotive", 12)
    const call = c.calls.find((x) => /INSERT INTO tenant_source_config/i.test(x.text) && /run_interval_hours/i.test(x.text))!
    expect(call.text).toMatch(/ON CONFLICT \(tenant_id, source_name\) DO UPDATE SET run_interval_hours = EXCLUDED\.run_interval_hours/)
    expect(call.values).toEqual([TENANT, "remotive", 12])
  })
})

describe("ALLOWED_INTERVALS", () => {
  it("exports the canonical allowed set [6,12,24,48,72]", () => {
    expect(ALLOWED_INTERVALS).toEqual([6, 12, 24, 48, 72])
  })
})

describe("addExclude", () => {
  it("scopes the INSERT + conflict target by tenant", async () => {
    const c = fakeClient()
    await addExclude(c, TENANT, "  iOS  Developer ")
    const call = c.calls.find((x) => /INSERT INTO discovery_excludes/i.test(x.text))!
    expect(call.text).toMatch(/INSERT INTO discovery_excludes \(tenant_id, term\) VALUES \(\$1, \$2\)/)
    expect(call.text).toMatch(/ON CONFLICT \(tenant_id, term\) DO NOTHING/i)
    expect(call.values).toEqual([TENANT, "ios developer"])
  })
  it("throws on an empty / whitespace-only term and issues no query", async () => {
    const c = fakeClient()
    await expect(addExclude(c, TENANT, "   ")).rejects.toThrow()
    expect(c.calls.length).toBe(0)
  })
})

describe("removeExclude", () => {
  it("DELETEs by normalized term, scoped by tenant", async () => {
    const c = fakeClient()
    await removeExclude(c, TENANT, " Junior ")
    const call = c.calls.find((x) => /DELETE FROM discovery_excludes/i.test(x.text))!
    expect(call.text).toMatch(/DELETE FROM discovery_excludes WHERE tenant_id = \$1 AND term = \$2/)
    expect(call.values).toEqual([TENANT, "junior"])
  })
})

describe("applyDiscoveryDiff", () => {
  it("applies known source toggles and exclude add/remove, returns fresh config, scoped by tenant", async () => {
    const c = fakeClient()
    const cfg = await applyDiscoveryDiff(c, TENANT, {
      sources: [{ name: "bayt", enabled: true }],
      addExcludes: ["  Recruiter "],
      removeExcludes: ["junior"],
    })
    // a fresh getDiscoveryConfig is returned (server truth)
    expect(cfg.sources.length).toBe(3)
    expect(
      c.calls.some(
        (x) => /INSERT INTO tenant_source_config/i.test(x.text) && (x.values as unknown[])?.[0] === TENANT && (x.values as unknown[])?.[1] === "bayt",
      ),
    ).toBe(true)
    expect(
      c.calls.some(
        (x) => /INSERT INTO discovery_excludes/i.test(x.text) && (x.values as unknown[])?.[0] === TENANT && (x.values as unknown[])?.[1] === "recruiter",
      ),
    ).toBe(true)
    expect(
      c.calls.some(
        (x) => /DELETE FROM discovery_excludes/i.test(x.text) && (x.values as unknown[])?.[0] === TENANT && (x.values as unknown[])?.[1] === "junior",
      ),
    ).toBe(true)
  })

  it("requires a known source before writing — unknown source is rejected, no write issued", async () => {
    const c = fakeClient()
    await expect(
      applyDiscoveryDiff(c, TENANT, { sources: [{ name: "definitely-not-a-source", enabled: true }] })
    ).rejects.toThrow()
    expect(c.calls.some((x) => /INSERT INTO tenant_source_config/i.test(x.text))).toBe(false)
  })

  it("rejects an empty/over-length exclude term, no INSERT issued", async () => {
    const c = fakeClient()
    await expect(applyDiscoveryDiff(c, TENANT, { addExcludes: ["   "] })).rejects.toThrow()
    expect(c.calls.some((x) => /INSERT INTO discovery_excludes/i.test(x.text))).toBe(false)
  })

  it("no-op diff still returns the current config", async () => {
    const c = fakeClient()
    const cfg = await applyDiscoveryDiff(c, TENANT, {})
    expect(cfg.sources.length).toBe(3)
    expect(cfg.excludes).toEqual(["junior", "intern"])
  })

  it("applies a valid interval via setSourceInterval (UPSERT run_interval_hours)", async () => {
    const c = fakeClient()
    await applyDiscoveryDiff(c, TENANT, { intervals: [{ name: "remotive", hours: 12 }] })
    const updateCall = c.calls.find((x) => /INSERT INTO tenant_source_config/i.test(x.text) && /run_interval_hours/i.test(x.text))!
    expect(updateCall).toBeDefined()
    expect(updateCall.values).toEqual([TENANT, "remotive", 12])
  })

  it("rejects an out-of-set hours value — no write issued", async () => {
    const c = fakeClient()
    await expect(
      applyDiscoveryDiff(c, TENANT, { intervals: [{ name: "remotive", hours: 99 }] })
    ).rejects.toThrow(/invalid interval hours/)
    expect(c.calls.some((x) => /INSERT INTO tenant_source_config/i.test(x.text) && /run_interval_hours/i.test(x.text))).toBe(false)
  })

  it("rejects an unknown source in intervals — no write issued", async () => {
    const c = fakeClient()
    await expect(
      applyDiscoveryDiff(c, TENANT, { intervals: [{ name: "not-a-source", hours: 24 }] })
    ).rejects.toThrow(/unknown source/)
    expect(c.calls.some((x) => /INSERT INTO tenant_source_config/i.test(x.text) && /run_interval_hours/i.test(x.text))).toBe(false)
  })
})

describe("discovery runs (on-demand)", () => {
  function runClient(latest: Record<string, unknown> | null) {
    const calls: { text: string; values?: unknown[] }[] = []
    return {
      calls,
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values })
        if (/SELECT .* FROM discovery_runs/i.test(text)) return { rows: latest ? [latest] : [] }
        return { rows: [] }
      },
    }
  }

  it("latestDiscoveryRun scopes by tenant + filters by kind (defaults to discover) and returns row/null", async () => {
    expect(await latestDiscoveryRun(runClient(null), TENANT)).toBeNull()
    const row = { id: 3, kind: "score", status: "done", source: "ui", requested_at: "t", started_at: "t", finished_at: "t", fetched: null, matched: null, inserted: 41, note: "scored 41", error: null }
    const c = runClient(row)
    expect(await latestDiscoveryRun(c, TENANT, "score")).toEqual(row)
    const sel = c.calls.find((x) => /SELECT .* FROM discovery_runs/i.test(x.text))!
    expect(sel.text).toMatch(/WHERE tenant_id = \$1 AND kind = \$2/)
    expect(sel.values).toEqual([TENANT, "score"])
  })

  it("requestDiscoveryRun queues a kind for this tenant via dedup-guarded INSERT then returns latest", async () => {
    const row = { id: 4, kind: "tailor", status: "requested", source: "ui", requested_at: "t", started_at: null, finished_at: null, fetched: null, matched: null, inserted: null, note: null, error: null }
    const c = runClient(row)
    const out = await requestDiscoveryRun(c, TENANT, "tailor")
    const insert = c.calls.find((x) => /INSERT INTO discovery_runs/i.test(x.text))!
    expect(insert.text).toMatch(/INSERT INTO discovery_runs \(tenant_id, source, kind\)/)
    expect(insert.text).toMatch(/WHERE tenant_id = \$1 AND kind = \$2 AND status IN \('requested','running'\)/)
    expect(insert.values).toEqual([TENANT, "tailor"])
    expect(out).toEqual(row)
  })

  it("dismissMatchingExcluded scopes the excludes read AND the jobs UPDATE by tenant (security fix)", async () => {
    // Two SELECTs from discovery_excludes first (rows), then the UPDATE.
    const calls: { text: string; values?: unknown[] }[] = []
    const c = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values })
        // First call: SELECT term FROM discovery_excludes
        if (/SELECT term FROM discovery_excludes/i.test(text)) {
          return { rows: [{ term: "junior" }, { term: "intern" }] }
        }
        // Second call: UPDATE jobs
        return { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] }
      },
    }
    const n = await dismissMatchingExcluded(c, TENANT)
    expect(n).toBe(3)
    const sel = calls.find((x) => /SELECT term FROM discovery_excludes/i.test(x.text))!
    expect(sel.text).toMatch(/WHERE tenant_id = \$1/)
    expect(sel.values).toEqual([TENANT])
    const updateCall = calls.find((x) => /UPDATE jobs/i.test(x.text))!
    expect(updateCall.text).toMatch(/UPDATE jobs SET status = 'dismissed'/)
    expect(updateCall.text).toMatch(/status IN \('new','notified'\)/)
    // Uses parameterized ~* ANY($1::text[]) — not a subquery into discovery_excludes
    expect(updateCall.text).toMatch(/title ~\* ANY\(\$1::text\[\]\)/)
    expect(updateCall.text).toMatch(/AND tenant_id = \$2/)
    expect(updateCall.values![1]).toBe(TENANT)
    // Patterns passed as array param
    const patterns = updateCall.values![0] as string[]
    expect(Array.isArray(patterns)).toBe(true)
    expect(patterns).toContain("\\yjunior\\y")
    expect(patterns).toContain("\\yintern\\y")
  })

  it("dismissMatchingExcluded preserves unicode letters (ä/é/…) in the pattern", async () => {
    const calls: { text: string; values?: unknown[] }[] = []
    const c = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values })
        if (/SELECT term FROM discovery_excludes/i.test(text)) {
          // German umlaut term stored as-is (normalizeTerm lowercases but keeps ä)
          return { rows: [{ term: "leiter liquiditätssteuerung" }] }
        }
        // Simulate the UPDATE matching a mixed-case title
        return { rows: [{ id: 42 }] }
      },
    }
    const n = await dismissMatchingExcluded(c, TENANT)
    expect(n).toBe(1)
    const updateCall = calls.find((x) => /UPDATE jobs/i.test(x.text))!
    const patterns = updateCall.values![0] as string[]
    // The ä must survive — no ASCII stripping
    expect(patterns[0]).toBe("\\yleiter liquiditätssteuerung\\y")
    // Confirm ~* ANY is used (case-insensitive word-boundary match)
    expect(updateCall.text).toMatch(/~\* ANY\(\$1::text\[\]\)/)
  })

  it("dismissMatchingExcluded escapes regex metacharacters without stripping unicode letters", async () => {
    const calls: { text: string; values?: unknown[] }[] = []
    const c = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values })
        if (/SELECT term FROM discovery_excludes/i.test(text)) {
          // Term with regex metacharacters (+, /) — plus a term with a dot
          return { rows: [{ term: "c++/c#" }, { term: "asp.net" }] }
        }
        return { rows: [] }
      },
    }
    await dismissMatchingExcluded(c, TENANT)
    const updateCall = calls.find((x) => /UPDATE jobs/i.test(x.text))!
    const patterns = updateCall.values![0] as string[]
    // c++/c# → plusses and slash and hash are escaped
    expect(patterns[0]).toContain("\\+")
    // asp.net → dot is escaped to \.
    expect(patterns[1]).toContain("\\.")
    // c++/c#: starts with word char 'c' → \y prepended; ends with '#' (non-word) → no \y appended
    expect(patterns[0]).toMatch(/^\\y/)
    expect(patterns[0]).not.toMatch(/\\y$/)
    // asp.net: starts with 'a' (word char) → \y prepended; ends with 't' (word char) → \y appended
    expect(patterns[1]).toMatch(/^\\y.*\\y$/)
  })

  it("dismissMatchingExcluded uses partial boundaries for terms starting/ending with non-word chars (c#, c++, .net)", async () => {
    const calls: { text: string; values?: unknown[] }[] = []
    const c = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values })
        if (/SELECT term FROM discovery_excludes/i.test(text)) {
          return { rows: [{ term: "c#" }, { term: "c++" }, { term: ".net" }] }
        }
        return { rows: [] }
      },
    }
    await dismissMatchingExcluded(c, TENANT)
    const updateCall = calls.find((x) => /UPDATE jobs/i.test(x.text))!
    const patterns = updateCall.values![0] as string[]
    // c#: starts with word char 'c' → \y prepended; ends with '#' (non-word, not a regex metchar → not escaped) → no \y appended
    expect(patterns[0]).toBe("\\yc#")
    // c++: starts with word char 'c' → \y prepended; '+' is a regex metachar → escaped to \+; ends with '+' (non-word) → no \y appended
    expect(patterns[1]).toBe("\\yc\\+\\+")
    // .net: '.' is a regex metachar → escaped to \.; starts with '.' (non-word) → no \y prepended; ends with 't' (word char) → \y appended
    expect(patterns[2]).toBe("\\.net\\y")
  })

  it("dismissMatchingExcluded returns 0 without running UPDATE when no exclude terms exist", async () => {
    const calls: { text: string; values?: unknown[] }[] = []
    const c = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values })
        if (/SELECT term FROM discovery_excludes/i.test(text)) {
          return { rows: [] } // no excludes
        }
        return { rows: [] }
      },
    }
    const n = await dismissMatchingExcluded(c, TENANT)
    expect(n).toBe(0)
    // Only the SELECT should have been called — no UPDATE
    expect(calls.some((x) => /UPDATE jobs/i.test(x.text))).toBe(false)
  })

  it("isRunKind validates the three kinds", async () => {
    const { isRunKind } = await import("@/lib/discovery-repo")
    expect(isRunKind("discover")).toBe(true)
    expect(isRunKind("score")).toBe(true)
    expect(isRunKind("tailor")).toBe(true)
    expect(isRunKind("bogus")).toBe(false)
    expect(isRunKind(5)).toBe(false)
  })
})

describe("getSourceConfig", () => {
  it("reads config scoped to (tenant_id, source_name)", async () => {
    const calls: { text: string; values?: unknown[] }[] = []
    const c = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values })
        return { rows: [{ config: { search: "rust" } }] }
      },
    }
    const cfg = await getSourceConfig(c, TENANT, "remotive")
    expect(cfg).toEqual({ search: "rust" })
    const call = calls.find((x) => /SELECT config FROM tenant_source_config/i.test(x.text))!
    expect(call.text).toMatch(/WHERE tenant_id = \$1 AND source_name = \$2/)
    expect(call.values).toEqual([TENANT, "remotive"])
  })

  it("returns {} when no row is found for this tenant", async () => {
    const c = { query: async () => ({ rows: [] }) }
    expect(await getSourceConfig(c, TENANT, "remotive")).toEqual({})
  })

  it("returns {} when the stored config is not a plain object", async () => {
    const c = { query: async () => ({ rows: [{ config: null }] }) }
    expect(await getSourceConfig(c, TENANT, "remotive")).toEqual({})
  })
})

describe("setSourceConfig", () => {
  it("UPSERTs config into tenant_source_config keyed on (tenant_id, source_name)", async () => {
    const calls: { text: string; values?: unknown[] }[] = []
    const c = { query: async (text: string, values?: unknown[]) => { calls.push({ text, values }); return { rows: [] } } }
    const saved = await setSourceConfig(c, TENANT, "remotive", { search: "rust" })
    expect(saved).toEqual({ search: "rust" })
    const call = calls.find((x) => /INSERT INTO tenant_source_config/i.test(x.text))!
    expect(call.text).toMatch(/ON CONFLICT \(tenant_id, source_name\) DO UPDATE SET config = EXCLUDED\.config/)
    expect(call.values).toEqual([TENANT, "remotive", { search: "rust" }])
  })

  it("rejects a non-object config, no write issued", async () => {
    const c = { query: async () => ({ rows: [] }) }
    await expect(setSourceConfig(c, TENANT, "remotive", "nope")).rejects.toThrow(/plain object/)
  })

  it("rejects a non-object `advanced`, no write issued", async () => {
    const c = { query: async () => ({ rows: [] }) }
    await expect(setSourceConfig(c, TENANT, "remotive", { advanced: "nope" })).rejects.toThrow(/advanced/)
  })
})

describe("createPreview", () => {
  it("validates the source against this tenant's config, then inserts scoped by tenant", async () => {
    const c = fakeClient()
    const id = await createPreview(c, TENANT, "remotive", 5)
    expect(typeof id).toBe("number")
    const insert = c.calls.find((x) => /INSERT INTO source_previews/i.test(x.text))!
    expect(insert.text).toMatch(/INSERT INTO source_previews \(tenant_id, source, lim\)/)
    expect(insert.values).toEqual([TENANT, "remotive", 5])
  })

  it("rejects an unknown source, no INSERT issued", async () => {
    const c = fakeClient()
    await expect(createPreview(c, TENANT, "not-a-source")).rejects.toThrow(/unknown source/)
    expect(c.calls.some((x) => /INSERT INTO source_previews/i.test(x.text))).toBe(false)
  })
})

describe("getPreview", () => {
  it("scopes by tenant (IDOR guard: wrong tenant → null)", async () => {
    const c = { query: async () => ({ rows: [] }) }
    expect(await getPreview(c, TENANT, 9)).toBeNull()
  })

  it("passes [id, tenantId] as values (matches getJob's param-order convention)", async () => {
    const calls: { text: string; values?: unknown[] }[] = []
    const c = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values })
        return { rows: [{ id: 9, source: "remotive", status: "done", result: { fetched: 5 }, error: null }] }
      },
    }
    const row = await getPreview(c, TENANT, 9)
    expect(row?.id).toBe(9)
    const call = calls[0]
    expect(call.text).toMatch(/WHERE id = \$1 AND tenant_id = \$2/)
    expect(call.values).toEqual([9, TENANT])
  })
})
