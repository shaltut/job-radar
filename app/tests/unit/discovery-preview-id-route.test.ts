import { describe, it, expect, vi, beforeEach } from "vitest"

// Owner-gated (C2 boundary, kept intentionally): previews run against the single-tenant
// engine. getPreview() is tenant-scoped like every other discovery-repo fn; this route
// always resolves the OWNER's own tenantId (requireOwner()) before calling it.
const { jobsDb } = vi.hoisted(() => ({ jobsDb: {} }))
const { ownerGuard, requireOwner } = vi.hoisted(() => ({ ownerGuard: vi.fn(), requireOwner: vi.fn() }))
const { getPreview } = vi.hoisted(() => ({ getPreview: vi.fn() }))
vi.mock("@/lib/tenancy", () => ({ ownerGuard, requireOwner }))
vi.mock("@/lib/jobs-db", () => ({ jobsDb }))
vi.mock("@/lib/discovery-repo", () => ({ getPreview }))

import { GET } from "@/app/api/jobs/discovery/previews/[id]/route"

const OWNER = { userId: "u-owner", tenantId: "1", isOwner: true }

function paramsFor(id: string) { return { params: Promise.resolve({ id }) } }
function fakeReq(): import("next/server").NextRequest {
  return {} as unknown as import("next/server").NextRequest
}

describe("GET /api/jobs/discovery/previews/[id] — owner-gated (C2 boundary)", () => {
  beforeEach(() => {
    ownerGuard.mockReset(); requireOwner.mockReset(); getPreview.mockReset()
    requireOwner.mockResolvedValue(OWNER)
  })

  it("returns 403 for a non-owner without touching getPreview", async () => {
    ownerGuard.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))
    const res = await GET(fakeReq(), paramsFor("9"))
    expect(res.status).toBe(403)
    expect(getPreview).not.toHaveBeenCalled()
  })

  it("passes the owner's own tenantId + id to getPreview (IDOR guard against another tenant's preview)", async () => {
    ownerGuard.mockResolvedValue(null)
    getPreview.mockResolvedValue({ id: 9, status: "done", result: { fetched: 3 }, error: null })
    const res = await GET(fakeReq(), paramsFor("9"))
    expect(res.status).toBe(200)
    expect(getPreview).toHaveBeenCalledWith(jobsDb, "1", 9)
  })

  it("404s when getPreview resolves null (e.g. a cross-tenant id)", async () => {
    ownerGuard.mockResolvedValue(null)
    getPreview.mockResolvedValue(null)
    const res = await GET(fakeReq(), paramsFor("9"))
    expect(res.status).toBe(404)
  })

  it("400s a non-positive-integer id, never calls getPreview", async () => {
    ownerGuard.mockResolvedValue(null)
    const res = await GET(fakeReq(), paramsFor("abc"))
    expect(res.status).toBe(400)
    expect(getPreview).not.toHaveBeenCalled()
  })
})
