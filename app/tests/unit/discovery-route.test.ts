import { describe, it, expect, vi, beforeEach } from "vitest"

const TENANT = "3"

// C2: GET/PUT are per-tenant (config CRUD, no engine involvement) — mock requireTenant()
// to prove the caller's tenantId threads into every discovery-repo call, and that an
// unresolvable tenant (unauthenticated) never reaches the config.
const { jobsDb } = vi.hoisted(() => ({ jobsDb: {} }))
const { requireTenant } = vi.hoisted(() => ({ requireTenant: vi.fn() }))
const { getDiscoveryConfig, getSourceConfig, applyDiscoveryDiff } = vi.hoisted(() => ({
  getDiscoveryConfig: vi.fn(), getSourceConfig: vi.fn(), applyDiscoveryDiff: vi.fn(),
}))
vi.mock("@/lib/tenancy", () => ({ requireTenant }))
vi.mock("@/lib/jobs-db", () => ({ jobsDb }))
vi.mock("@/lib/discovery-repo", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDiscoveryConfig, getSourceConfig, applyDiscoveryDiff,
}))

import { parseDiff, GET, PUT } from "@/app/api/jobs/discovery/route"

describe("GET/PUT /api/jobs/discovery — per-tenant (C2)", () => {
  beforeEach(() => {
    requireTenant.mockReset(); getDiscoveryConfig.mockReset(); getSourceConfig.mockReset(); applyDiscoveryDiff.mockReset()
    requireTenant.mockResolvedValue({ userId: "u1", tenantId: TENANT, isOwner: false })
    getSourceConfig.mockResolvedValue({})
  })

  it("GET returns the caller's config (non-owner allowed)", async () => {
    getDiscoveryConfig.mockResolvedValue({ sources: [], excludes: [] })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(getDiscoveryConfig).toHaveBeenCalledWith(jobsDb, TENANT)
  })

  it("returns 500 (not the config) when the caller has no resolvable tenant", async () => {
    requireTenant.mockRejectedValue(new Error("unauthenticated"))
    const res = await GET()
    expect(res.status).toBe(500)
    expect(getDiscoveryConfig).not.toHaveBeenCalled()
  })

  it("GET fetches each source's config scoped to the caller's tenant", async () => {
    getDiscoveryConfig.mockResolvedValue({ sources: [{ name: "bayt" }], excludes: [] })
    getSourceConfig.mockResolvedValue({ search: "rust" })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(getSourceConfig).toHaveBeenCalledWith(jobsDb, TENANT, "bayt")
    const body = await res.json()
    expect(body.sourceConfigs).toEqual({ bayt: { search: "rust" } })
  })

  it("PUT applies the diff scoped to the caller's tenant", async () => {
    applyDiscoveryDiff.mockResolvedValue({ sources: [], excludes: [] })
    const req = { json: async () => ({ addExcludes: ["junior"] }) } as any
    const res = await PUT(req)
    expect(res.status).toBe(200)
    expect(applyDiscoveryDiff).toHaveBeenCalledWith(jobsDb, TENANT, { addExcludes: ["junior"] })
  })

  it("PUT returns 500 (not applying the diff) when the caller has no resolvable tenant", async () => {
    requireTenant.mockRejectedValue(new Error("unauthenticated"))
    const req = { json: async () => ({}) } as any
    const res = await PUT(req)
    expect(res.status).toBe(500)
    expect(applyDiscoveryDiff).not.toHaveBeenCalled()
  })
})

// parseDiff is the untrusted-input boundary for PUT /api/jobs/discovery.
// These tests pin the validate-at-the-boundary contract the route relies on:
// a malformed body must yield null (→ 400) and never a half-typed DiscoveryDiff.

describe("parseDiff", () => {
  it("accepts a well-formed full diff", () => {
    const diff = parseDiff({
      sources: [{ name: "bayt", enabled: true }],
      addExcludes: ["ios developer"],
      removeExcludes: ["junior"],
    })
    expect(diff).toEqual({
      sources: [{ name: "bayt", enabled: true }],
      addExcludes: ["ios developer"],
      removeExcludes: ["junior"],
    })
  })

  it("accepts an empty diff (no-op) and partial diffs", () => {
    expect(parseDiff({})).toEqual({})
    expect(parseDiff({ sources: [{ name: "jobicy", enabled: false }] })).toEqual({
      sources: [{ name: "jobicy", enabled: false }],
    })
  })

  it("rejects a non-object body", () => {
    expect(parseDiff(null)).toBeNull()
    expect(parseDiff("nope")).toBeNull()
    expect(parseDiff(42)).toBeNull()
    expect(parseDiff([])).not.toBeNull() // [] is an object; treated as empty diff
  })

  it("rejects a non-array sources field", () => {
    expect(parseDiff({ sources: "bayt" })).toBeNull()
  })

  it("rejects a source entry with a non-string name", () => {
    expect(parseDiff({ sources: [{ name: 123, enabled: true }] })).toBeNull()
  })

  it("rejects a source entry with a non-boolean enabled (no silent coercion)", () => {
    expect(parseDiff({ sources: [{ name: "bayt", enabled: "yes" }] })).toBeNull()
  })

  it("rejects a null/non-object entry inside sources", () => {
    expect(parseDiff({ sources: [null] })).toBeNull()
    expect(parseDiff({ sources: ["bayt"] })).toBeNull()
  })

  it("rejects exclude lists containing non-strings", () => {
    expect(parseDiff({ addExcludes: ["ok", 7] })).toBeNull()
    expect(parseDiff({ removeExcludes: [{}] })).toBeNull()
    expect(parseDiff({ addExcludes: "junior" })).toBeNull()
  })

  it("accepts a well-formed intervals array", () => {
    const diff = parseDiff({ intervals: [{ name: "remotive", hours: 12 }] })
    expect(diff).toEqual({ intervals: [{ name: "remotive", hours: 12 }] })
  })

  it("accepts an empty intervals array", () => {
    expect(parseDiff({ intervals: [] })).toEqual({ intervals: [] })
  })

  it("rejects intervals that is not an array", () => {
    expect(parseDiff({ intervals: "12h" })).toBeNull()
  })

  it("rejects an interval entry with a non-string name", () => {
    expect(parseDiff({ intervals: [{ name: 42, hours: 12 }] })).toBeNull()
  })

  it("rejects an interval entry with a non-number hours", () => {
    expect(parseDiff({ intervals: [{ name: "remotive", hours: "12" }] })).toBeNull()
  })

  it("rejects a null entry inside intervals", () => {
    expect(parseDiff({ intervals: [null] })).toBeNull()
  })
})
