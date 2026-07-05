import { describe, it, expect, vi, beforeEach } from "vitest"

const { jobsDb } = vi.hoisted(() => ({ jobsDb: {} }))
const { requireTenant } = vi.hoisted(() => ({ requireTenant: vi.fn() }))
const { getDiscoveryConfig, setSourceConfig, isKnownSource } = vi.hoisted(() => ({
  getDiscoveryConfig: vi.fn(), setSourceConfig: vi.fn(), isKnownSource: vi.fn(),
}))
vi.mock("@/lib/tenancy", () => ({ requireTenant }))
vi.mock("@/lib/jobs-db", () => ({ jobsDb }))
vi.mock("@/lib/discovery-repo", () => ({ getDiscoveryConfig, setSourceConfig, isKnownSource }))

import { PATCH } from "@/app/api/jobs/discovery/sources/[name]/config/route"

function paramsFor(name: string) { return { params: Promise.resolve({ name }) } }
function reqWith(body: unknown): import("next/server").NextRequest {
  return {
    json: async () => body,
  } as unknown as import("next/server").NextRequest
}

describe("PATCH /api/jobs/discovery/sources/[name]/config — per-tenant (C2)", () => {
  beforeEach(() => {
    requireTenant.mockReset(); getDiscoveryConfig.mockReset(); setSourceConfig.mockReset(); isKnownSource.mockReset()
    requireTenant.mockResolvedValue({ userId: "u1", tenantId: "7", isOwner: false })
    getDiscoveryConfig.mockResolvedValue({ sources: [{ name: "bayt" }], excludes: [], sourceConfigs: {} })
    isKnownSource.mockReturnValue(true)
  })

  it("saves the config into the caller's own tenant row", async () => {
    setSourceConfig.mockResolvedValue({ search: "rust" })
    const res = await PATCH(reqWith({ search: "rust" }), paramsFor("bayt"))
    expect(res.status).toBe(200)
    expect(getDiscoveryConfig).toHaveBeenCalledWith(jobsDb, "7")
    expect(setSourceConfig).toHaveBeenCalledWith(jobsDb, "7", "bayt", { search: "rust" })
  })

  it("returns 500 (not saving) when the caller has no resolvable tenant", async () => {
    requireTenant.mockRejectedValue(new Error("unauthenticated"))
    const res = await PATCH(reqWith({ search: "rust" }), paramsFor("bayt"))
    expect(res.status).toBe(500)
    expect(setSourceConfig).not.toHaveBeenCalled()
  })

  it("rejects a non-object body with 400, never reaches the repo", async () => {
    const res = await PATCH(reqWith("nope"), paramsFor("bayt"))
    expect(res.status).toBe(400)
    expect(setSourceConfig).not.toHaveBeenCalled()
  })

  it("rejects an unknown source with 400 (checked against this tenant's config)", async () => {
    isKnownSource.mockReturnValue(false)
    const res = await PATCH(reqWith({}), paramsFor("not-a-source"))
    expect(res.status).toBe(400)
    expect(setSourceConfig).not.toHaveBeenCalled()
  })
})
