import { describe, it, expect, vi, beforeEach } from "vitest"

const TENANT = "tenant-1"

const { getFunnel, getSourceEffectiveness, getDailyVolume, getScoreDistribution, getTimeInStage } = vi.hoisted(() => ({
  getFunnel: vi.fn(), getSourceEffectiveness: vi.fn(), getDailyVolume: vi.fn(), getScoreDistribution: vi.fn(), getTimeInStage: vi.fn(),
}))
const { requireTenant } = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock("@/lib/jobs-db", () => ({ jobsDb: {} }))
vi.mock("@/lib/insights-repo", () => ({ getFunnel, getSourceEffectiveness, getDailyVolume, getScoreDistribution, getTimeInStage }))
vi.mock("@/lib/tenancy", () => ({ requireTenant }))

import { GET } from "@/app/api/jobs/insights/route"

beforeEach(() => {
  for (const f of [getFunnel, getSourceEffectiveness, getDailyVolume, getScoreDistribution, getTimeInStage]) f.mockReset()
  requireTenant.mockReset()
  requireTenant.mockResolvedValue({ userId: "u1", tenantId: TENANT, isOwner: false })
})

describe("GET /api/jobs/insights", () => {
  it("returns the composite analytics shape, scoped by the caller's tenant", async () => {
    getFunnel.mockResolvedValue({ inbox: 1, total: 1 })
    getSourceEffectiveness.mockResolvedValue([{ source: "remotive", total: 1, shortlisted_plus: 0, applied_plus: 0 }])
    getDailyVolume.mockResolvedValue([{ day: "2026-06-10", count: 1 }])
    getScoreDistribution.mockResolvedValue({ excellent: 0, strong: 1, fair: 0, weak: 0, unscored: 0 })
    getTimeInStage.mockResolvedValue({ summary: [], stalest: [] })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      funnel: { inbox: 1, total: 1 },
      sources: [{ source: "remotive", total: 1, shortlisted_plus: 0, applied_plus: 0 }],
      volume: [{ day: "2026-06-10", count: 1 }],
      scores: { excellent: 0, strong: 1, fair: 0, weak: 0, unscored: 0 },
      timeInStage: { summary: [], stalest: [] },
    })
    expect(getFunnel).toHaveBeenCalledWith(expect.anything(), TENANT)
    expect(getSourceEffectiveness).toHaveBeenCalledWith(expect.anything(), TENANT)
    expect(getDailyVolume).toHaveBeenCalledWith(expect.anything(), TENANT)
    expect(getScoreDistribution).toHaveBeenCalledWith(expect.anything(), TENANT)
    expect(getTimeInStage).toHaveBeenCalledWith(expect.anything(), TENANT)
  })
  it("returns 500 when an aggregate throws", async () => {
    getFunnel.mockRejectedValue(new Error("boom"))
    getSourceEffectiveness.mockResolvedValue([]); getDailyVolume.mockResolvedValue([])
    getScoreDistribution.mockResolvedValue({}); getTimeInStage.mockResolvedValue({ summary: [], stalest: [] })
    const res = await GET()
    expect(res.status).toBe(500)
  })
  it("returns 500 when the caller has no resolvable tenant", async () => {
    requireTenant.mockRejectedValue(new Error("unauthenticated"))
    const res = await GET()
    expect(res.status).toBe(500)
    expect(getFunnel).not.toHaveBeenCalled()
  })
})
