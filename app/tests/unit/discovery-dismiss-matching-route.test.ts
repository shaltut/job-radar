import { describe, it, expect, vi, beforeEach } from "vitest"

const { jobsDb } = vi.hoisted(() => ({ jobsDb: {} }))
const { requireTenant } = vi.hoisted(() => ({ requireTenant: vi.fn() }))
const { dismissMatchingExcluded } = vi.hoisted(() => ({ dismissMatchingExcluded: vi.fn() }))
vi.mock("@/lib/tenancy", () => ({ requireTenant }))
vi.mock("@/lib/jobs-db", () => ({ jobsDb }))
vi.mock("@/lib/discovery-repo", () => ({ dismissMatchingExcluded }))

import { POST } from "@/app/api/jobs/discovery/dismiss-matching/route"

describe("POST /api/jobs/discovery/dismiss-matching — per-tenant (C2)", () => {
  beforeEach(() => {
    requireTenant.mockReset(); dismissMatchingExcluded.mockReset()
    requireTenant.mockResolvedValue({ userId: "u1", tenantId: "7", isOwner: false })
  })

  it("passes the caller's tenantId to dismissMatchingExcluded (no cross-tenant dismiss)", async () => {
    dismissMatchingExcluded.mockResolvedValue(2)
    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ dismissed: 2 })
    expect(dismissMatchingExcluded).toHaveBeenCalledWith(jobsDb, "7")
  })

  it("returns 500 (not dismissing) when the caller has no resolvable tenant", async () => {
    requireTenant.mockRejectedValue(new Error("unauthenticated"))
    const res = await POST()
    expect(res.status).toBe(500)
    expect(dismissMatchingExcluded).not.toHaveBeenCalled()
  })

  it("returns 500 when dismissMatchingExcluded throws", async () => {
    dismissMatchingExcluded.mockRejectedValue(new Error("db down"))
    const res = await POST()
    expect(res.status).toBe(500)
  })
})
