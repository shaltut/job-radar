import { describe, it, expect, vi, beforeEach } from "vitest"

// Owner-gated (C2 boundary, kept intentionally): previews run against the single-tenant
// engine. createPreview() is tenant-scoped like every other discovery-repo fn; this
// route always resolves the OWNER's own tenantId (requireOwner()) before calling it.
const { jobsDb } = vi.hoisted(() => ({ jobsDb: {} }))
const { ownerGuard, requireOwner } = vi.hoisted(() => ({ ownerGuard: vi.fn(), requireOwner: vi.fn() }))
const { createPreview } = vi.hoisted(() => ({ createPreview: vi.fn() }))
vi.mock("@/lib/tenancy", () => ({ ownerGuard, requireOwner }))
vi.mock("@/lib/jobs-db", () => ({ jobsDb }))
vi.mock("@/lib/discovery-repo", () => ({ createPreview }))

import { POST } from "@/app/api/jobs/discovery/sources/[name]/preview/route"

const OWNER = { userId: "u-owner", tenantId: "1", isOwner: true }

function paramsFor(name: string) { return { params: Promise.resolve({ name }) } }
function fakeReq(): import("next/server").NextRequest {
  return {} as unknown as import("next/server").NextRequest
}

describe("POST /api/jobs/discovery/sources/[name]/preview — owner-gated (C2 boundary)", () => {
  beforeEach(() => {
    ownerGuard.mockReset(); requireOwner.mockReset(); createPreview.mockReset()
    requireOwner.mockResolvedValue(OWNER)
  })

  it("returns 403 for a non-owner without touching createPreview", async () => {
    ownerGuard.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))
    const res = await POST(fakeReq(), paramsFor("bayt"))
    expect(res.status).toBe(403)
    expect(createPreview).not.toHaveBeenCalled()
  })

  it("passes the owner's own tenantId + source name to createPreview", async () => {
    ownerGuard.mockResolvedValue(null)
    createPreview.mockResolvedValue(42)
    const res = await POST(fakeReq(), paramsFor("bayt"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 42 })
    expect(createPreview).toHaveBeenCalledWith(jobsDb, "1", "bayt")
  })

  it("400s an unknown source (createPreview throws 'unknown source: ...')", async () => {
    ownerGuard.mockResolvedValue(null)
    createPreview.mockRejectedValue(new Error("unknown source: not-a-source"))
    const res = await POST(fakeReq(), paramsFor("not-a-source"))
    expect(res.status).toBe(400)
  })
})
