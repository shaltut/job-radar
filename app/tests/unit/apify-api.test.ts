import { describe, it, expect, vi } from "vitest"
import { maskToken, aggregateActorUsage, usagePct, getRuns, getUsage, abortRun, validateToken } from "@/lib/apify-api"

describe("getRuns actor-name resolution", () => {
  it("resolves actId → readable title (table + recent), falls back to id", async () => {
    const fakeFetch = (async (url: string) => {
      if (url.includes("/actor-runs")) return { ok: true, json: async () => ({ data: { items: [
        { id: "r1", actId: "ACT1", status: "SUCCEEDED", startedAt: "2026-06-21T10:00:00Z", finishedAt: "2026-06-21T10:01:00Z", usageTotalUsd: 0.1 },
        { id: "r2", actId: "ACTX", status: "SUCCEEDED", startedAt: "2026-06-21T09:00:00Z", finishedAt: "2026-06-21T09:01:00Z", usageTotalUsd: 0.2 },
      ] } }) }
      if (url.includes("/acts/ACT1")) return { ok: true, json: async () => ({ data: { title: "Upwork Job Scraper", username: "neatrat", name: "upwork-job-scraper" } }) }
      return { ok: false, status: 404 } // ACTX lookup fails → falls back to the id
    }) as unknown as typeof fetch
    const r = await getRuns({ token: "tenant-a-token", fetchImpl: fakeFetch, nowMs: 7_000_001 })
    expect("error" in r).toBe(false)
    if (!("error" in r)) {
      expect(r.recent.find((x) => x.actId === "ACT1")!.actor).toBe("Upwork Job Scraper")
      expect(r.recent.find((x) => x.actId === "ACTX")!.actor).toBe("ACTX") // fallback
      expect(r.actors.find((a) => a.actId === "ACT1")!.actor).toBe("Upwork Job Scraper")
    }
  })
})

// BYO-key (C3 Task 4): the helpers take an explicit caller token (threaded into the
// `?token=` query string) instead of reading process.env.APIFY_TOKEN — proves per-tenant
// isolation and that a missing token never reaches the network with a blank credential.
describe("per-tenant token threading", () => {
  it("getUsage threads the passed token into the request URL", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("token=tenant-a-token")
      return { ok: true, json: async () => ({ data: { current: { monthlyUsageUsd: 1 }, limits: { maxMonthlyUsageUsd: 10 } } }) }
    }) as unknown as typeof fetch
    const r = await getUsage({ token: "tenant-a-token", fetchImpl, nowMs: 1 })
    expect(fetchImpl).toHaveBeenCalled()
    expect("error" in r).toBe(false)
  })

  it("getUsage with no token → empty-ish result, no live call", async () => {
    const fetchImpl = vi.fn()
    const r = await getUsage({ token: "", fetchImpl: fetchImpl as unknown as typeof fetch, nowMs: 2 })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(r).toEqual({ error: "no token" })
  })

  it("getRuns with no token → empty-ish result, no live call", async () => {
    const fetchImpl = vi.fn()
    const r = await getRuns({ token: "", fetchImpl: fetchImpl as unknown as typeof fetch, nowMs: 3 })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(r).toEqual({ error: "no token" })
  })

  it("abortRun threads the passed token and no-ops on empty token", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("token=tenant-b-token")
      return { ok: true, json: async () => ({ data: { id: "r1", status: "ABORTING" } }) }
    }) as unknown as typeof fetch
    const ok = await abortRun("r1", { token: "tenant-b-token", fetchImpl })
    expect(fetchImpl).toHaveBeenCalled()
    expect(ok).toEqual({ id: "r1", status: "ABORTING" })

    const noopFetch = vi.fn()
    const empty = await abortRun("r1", { token: "", fetchImpl: noopFetch as unknown as typeof fetch })
    expect(noopFetch).not.toHaveBeenCalled()
    expect(empty).toEqual({ error: "no token" })
  })

  it("validateToken threads the passed token and no-ops on empty token", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("token=tenant-c-token")
      return { ok: true, json: async () => ({ data: { username: "bob", plan: { tier: "free" } } }) }
    }) as unknown as typeof fetch
    const ok = await validateToken({ token: "tenant-c-token", fetchImpl })
    expect(ok).toEqual({ ok: true, username: "bob", plan: "free" })

    const noopFetch = vi.fn()
    const empty = await validateToken({ token: "", fetchImpl: noopFetch as unknown as typeof fetch })
    expect(noopFetch).not.toHaveBeenCalled()
    expect(empty).toEqual({ ok: false })
  })

  it("two tenants' tokens never share a cache entry (no cross-tenant data leak)", async () => {
    let calls = 0
    const fetchImpl = vi.fn(async (url: string) => {
      calls++
      const usd = url.includes("tenant-a") ? 5 : 50
      return { ok: true, json: async () => ({ data: { current: { monthlyUsageUsd: usd }, limits: { maxMonthlyUsageUsd: 100 } } }) }
    }) as unknown as typeof fetch
    const a = await getUsage({ token: "tenant-a", fetchImpl, nowMs: 100 })
    const b = await getUsage({ token: "tenant-b", fetchImpl, nowMs: 100 })
    expect(calls).toBe(2) // not served from a cache entry keyed only by path
    if (!("error" in a) && !("error" in b)) {
      expect(a.monthlyUsd).toBe(5)
      expect(b.monthlyUsd).toBe(50)
    }
  })
})

describe("maskToken", () => {
  it("shows last 4", () => expect(maskToken("apify_api_abcd1234")).toBe("apify_api_••••1234"))
  it("short/empty → bullets", () => { expect(maskToken("")).toBe("••••"); expect(maskToken(undefined)).toBe("••••") })
})
describe("usagePct", () => {
  it("computes percentage", () => expect(usagePct(7.92, 29)).toBe(27))
  it("null/zero limit → null", () => { expect(usagePct(5, null)).toBe(null); expect(usagePct(5, 0)).toBe(null) })
})
describe("aggregateActorUsage", () => {
  const runs = [
    { id: "a", actId: "X", actor: "X", status: "SUCCEEDED", startedAt: "2026-06-21T10:00:00Z", finishedAt: "2026-06-21T10:02:00Z", usageTotalUsd: 0.1 },
    { id: "b", actId: "X", actor: "X", status: "FAILED", startedAt: "2026-06-21T11:00:00Z", finishedAt: "2026-06-21T11:01:00Z", usageTotalUsd: 0.05 },
    { id: "c", actId: "Y", actor: "Y", status: "SUCCEEDED", startedAt: "2026-06-20T09:00:00Z", finishedAt: "2026-06-20T09:03:00Z", usageTotalUsd: 0.2 },
  ]
  it("groups by actId with counts, totals, latest", () => {
    const out = aggregateActorUsage(runs as any)
    const x = out.find((a) => a.actId === "X")!
    expect(x.runs).toBe(2); expect(x.ok).toBe(1); expect(x.failed).toBe(1)
    expect(x.totalUsd).toBeCloseTo(0.15); expect(x.lastRunAt).toBe("2026-06-21T11:00:00Z")
    expect(out).toHaveLength(2)
  })
  it("sorts by totalUsd desc", () => { expect(aggregateActorUsage(runs as any)[0].actId).toBe("Y") })
})
