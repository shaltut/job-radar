import { describe, it, expect } from "vitest"
import { getFunnel, getSourceEffectiveness, getDailyVolume, getScoreDistribution, getTimeInStage } from "@/lib/insights-repo"

const TENANT = "tenant-1"

function client(routes: (text: string) => any[]) {
  const calls: { text: string; values?: unknown[] }[] = []
  return { calls, query: async (text: string, values?: unknown[]) => { calls.push({ text, values }); return { rows: routes(text) } } }
}

describe("getFunnel", () => {
  it("counts jobs per current stage in one query", async () => {
    const c = client(() => [{ inbox: 5, shortlisted: 2, applied: 3, interviewing: 1, offer: 0, rejected: 1, dismissed: 4, total: 16 }])
    const f = await getFunnel(c, TENANT)
    expect(f.inbox).toBe(5); expect(f.total).toBe(16)
    expect(c.calls[0].text).toMatch(/FILTER \(WHERE status IN \('new','notified'\)\)/)
    expect(c.calls[0].text).toMatch(/FILTER \(WHERE status = 'interviewing'\)/)
  })
  it("scopes by tenant_id = $1 bound to tenantId", async () => {
    const c = client(() => [{}])
    await getFunnel(c, TENANT)
    expect(c.calls[0].text).toMatch(/WHERE tenant_id = \$1/)
    expect(c.calls[0].values).toEqual([TENANT])
  })
})

describe("getSourceEffectiveness", () => {
  it("aggregates per source, ordered by total desc", async () => {
    const c = client(() => [{ source: "remotive", total: 10, shortlisted_plus: 3, applied_plus: 1 }])
    const rows = await getSourceEffectiveness(c, TENANT)
    expect(rows[0].source).toBe("remotive")
    expect(c.calls[0].text).toMatch(/GROUP BY source/)
    expect(c.calls[0].text).toMatch(/ORDER BY total DESC, source ASC/)
    expect(c.calls[0].text).toMatch(/FILTER \(WHERE status IN \('applied','interviewing','offer','rejected'\)\)/)
  })
  it("scopes by tenant_id = $1 bound to tenantId", async () => {
    const c = client(() => [])
    await getSourceEffectiveness(c, TENANT)
    expect(c.calls[0].text).toMatch(/WHERE tenant_id = \$1/)
    expect(c.calls[0].values).toEqual([TENANT])
  })
})

describe("getDailyVolume", () => {
  it("buckets by day over the window with the days param", async () => {
    const c = client(() => [{ day: "2026-06-10", count: 4 }])
    const rows = await getDailyVolume(c, TENANT, { days: 30 })
    expect(rows[0]).toEqual({ day: "2026-06-10", count: 4 })
    expect(c.calls[0].text).toMatch(/date_trunc\('day', discovered_at\)/)
    expect(c.calls[0].values).toEqual([TENANT, "30"])
  })
  it("defaults to 30 days", async () => {
    const c = client(() => [])
    await getDailyVolume(c, TENANT)
    expect(c.calls[0].values).toEqual([TENANT, "30"])
  })
  it("scopes by tenant_id = $1 bound to tenantId, before the days param", async () => {
    const c = client(() => [])
    await getDailyVolume(c, TENANT, { days: 7 })
    expect(c.calls[0].text).toMatch(/WHERE tenant_id = \$1 AND discovered_at/)
    expect(c.calls[0].values).toEqual([TENANT, "7"])
  })
})

describe("getScoreDistribution", () => {
  it("tiers by 85/70/55 + unscored", async () => {
    const c = client(() => [{ excellent: 2, strong: 5, fair: 3, weak: 1, unscored: 4 }])
    const d = await getScoreDistribution(c, TENANT)
    expect(d.excellent).toBe(2); expect(d.unscored).toBe(4)
    expect(c.calls[0].text).toMatch(/score >= 85/)
    expect(c.calls[0].text).toMatch(/score IS NULL\)::int\s+AS unscored/)
  })
  it("scopes by tenant_id = $1 bound to tenantId", async () => {
    const c = client(() => [{}])
    await getScoreDistribution(c, TENANT)
    expect(c.calls[0].text).toMatch(/WHERE tenant_id = \$1/)
    expect(c.calls[0].values).toEqual([TENANT])
  })
})

describe("getTimeInStage", () => {
  it("returns summary + stalest via two queries", async () => {
    const c = client((t) => /ORDER BY status_changed_at ASC/.test(t)
      ? [{ id: 7, title: "T", company: "C", status: "applied", days: 9 }]
      : [{ status: "applied", n: 3, avg_days: 5, max_days: 9 }])
    const r = await getTimeInStage(c, TENANT)
    expect(r.summary[0]).toEqual({ status: "applied", n: 3, avg_days: 5, max_days: 9 })
    expect(r.stalest[0].id).toBe(7)
    expect(c.calls.length).toBe(2)
    expect(c.calls.find((q) => /LIMIT 5/.test(q.text))).toBeTruthy()
  })
  it("scopes both queries by tenant_id = $1 bound to tenantId", async () => {
    const c = client(() => [])
    await getTimeInStage(c, TENANT)
    expect(c.calls.length).toBe(2)
    for (const call of c.calls) {
      expect(call.text).toMatch(/WHERE tenant_id = \$1 AND status IN \('applied','interviewing'\)/)
      expect(call.values).toEqual([TENANT])
    }
  })
})
