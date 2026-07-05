import { describe, it, expect, vi, beforeEach } from "vitest"

// Owner-gated (C2 boundary, kept intentionally): the discovery engine that executes
// discover/score/tailor runs is single-tenant until Phase 4, so this route stays
// behind ownerGuard() — but requireOwner() is also called to resolve the OWNER's own
// tenantId, which threads into the tenant-scoped discovery-repo calls.
const { jobsDb } = vi.hoisted(() => ({ jobsDb: {} }))
const { ownerGuard, requireOwner } = vi.hoisted(() => ({ ownerGuard: vi.fn(), requireOwner: vi.fn() }))
const { latestDiscoveryRun, requestDiscoveryRun } = vi.hoisted(() => ({
  latestDiscoveryRun: vi.fn(), requestDiscoveryRun: vi.fn(),
}))
vi.mock("@/lib/tenancy", () => ({ ownerGuard, requireOwner }))
vi.mock("@/lib/jobs-db", () => ({ jobsDb }))
vi.mock("@/lib/discovery-repo", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  latestDiscoveryRun, requestDiscoveryRun,
}))

import { GET, POST } from "@/app/api/jobs/discovery/run/route"

const OWNER = { userId: "u-owner", tenantId: "1", isOwner: true }

function reqWith(url: string, body?: unknown) {
  return {
    nextUrl: new URL(url),
    json: async () => body ?? {},
  } as unknown as import("next/server").NextRequest
}

describe("GET/POST /api/jobs/discovery/run — owner-gated (C2 boundary)", () => {
  beforeEach(() => {
    ownerGuard.mockReset(); requireOwner.mockReset(); latestDiscoveryRun.mockReset(); requestDiscoveryRun.mockReset()
    requireOwner.mockResolvedValue(OWNER)
  })

  it("GET returns 403 for a non-owner without touching discovery_runs", async () => {
    ownerGuard.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))
    const res = await GET(reqWith("http://localhost/api/jobs/discovery/run"))
    expect(res.status).toBe(403)
    expect(latestDiscoveryRun).not.toHaveBeenCalled()
  })

  it("GET passes the owner's own tenantId + parsed kind to latestDiscoveryRun", async () => {
    ownerGuard.mockResolvedValue(null)
    latestDiscoveryRun.mockResolvedValue({ id: 1, kind: "score", status: "done" })
    const res = await GET(reqWith("http://localhost/api/jobs/discovery/run?kind=score"))
    expect(res.status).toBe(200)
    expect(latestDiscoveryRun).toHaveBeenCalledWith(jobsDb, "1", "score")
  })

  it("POST returns 403 for a non-owner without queuing a run", async () => {
    ownerGuard.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))
    const res = await POST(reqWith("http://localhost/api/jobs/discovery/run", { kind: "discover" }))
    expect(res.status).toBe(403)
    expect(requestDiscoveryRun).not.toHaveBeenCalled()
  })

  it("POST passes the owner's own tenantId + parsed kind to requestDiscoveryRun", async () => {
    ownerGuard.mockResolvedValue(null)
    requestDiscoveryRun.mockResolvedValue({ id: 2, kind: "tailor", status: "requested" })
    const res = await POST(reqWith("http://localhost/api/jobs/discovery/run", { kind: "tailor" }))
    expect(res.status).toBe(200)
    expect(requestDiscoveryRun).toHaveBeenCalledWith(jobsDb, "1", "tailor")
  })
})
