import { describe, it, expect, vi, beforeEach } from "vitest"

// BYO-key (C3 Task 4): /api/apify/* routes are per-tenant now — each caller's own stored
// Apify token, with the owner falling back to process.env.APIFY_TOKEN when unset. No
// token at all → a 200 { needsKey: true } empty-state signal (never a 403). Mock
// requireTenant + getTenantKeys + the apify-api helpers to prove: (a) a caller with no
// key never reaches the network, (b) a non-owner never gets the owner's env token, and
// (c) a stored tenant key always wins over the env fallback.
const { requireTenant } = vi.hoisted(() => ({ requireTenant: vi.fn() }))
const { getTenantKeys } = vi.hoisted(() => ({ getTenantKeys: vi.fn() }))
const { getUsage, getRuns, abortRun, validateToken, maskToken } = vi.hoisted(() => ({
  getUsage: vi.fn(),
  getRuns: vi.fn(),
  abortRun: vi.fn(),
  validateToken: vi.fn(),
  maskToken: vi.fn(),
}))
vi.mock("@/lib/tenancy", () => ({ requireTenant }))
vi.mock("@/lib/secrets", () => ({ getTenantKeys }))
vi.mock("@/lib/apify-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getUsage, getRuns, abortRun, validateToken, maskToken,
}))

const OWNER = { userId: "u-owner", tenantId: "tenant-owner", isOwner: true }
const NON_OWNER = { userId: "u2", tenantId: "tenant-2", isOwner: false }

beforeEach(() => {
  requireTenant.mockReset()
  getTenantKeys.mockReset()
  getUsage.mockReset()
  getRuns.mockReset()
  abortRun.mockReset()
  validateToken.mockReset()
  maskToken.mockReset()
  process.env.APIFY_TOKEN = "env-shared-token"
})

describe("apify routes — exports", () => {
  it("usage route exports GET", async () => { expect(typeof (await import("@/app/api/apify/usage/route")).GET).toBe("function") })
  it("runs route exports GET", async () => { expect(typeof (await import("@/app/api/apify/runs/route")).GET).toBe("function") })
  it("abort route exports POST", async () => { expect(typeof (await import("@/app/api/apify/runs/[id]/abort/route")).POST).toBe("function") })
  it("validate route exports POST", async () => { expect(typeof (await import("@/app/api/apify/validate/route")).POST).toBe("function") })
})

describe("GET /api/apify/usage", () => {
  it("non-owner with no stored key → 200 needsKey, never calls getUsage or the owner's env token", async () => {
    requireTenant.mockResolvedValue(NON_OWNER)
    getTenantKeys.mockResolvedValue({ apify: null, openai: null })
    const { GET } = await import("@/app/api/apify/usage/route")
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: "no_apify_key", needsKey: true })
    expect(getUsage).not.toHaveBeenCalled()
  })

  it("non-owner with a stored key → uses the tenant's own token, not the env token", async () => {
    requireTenant.mockResolvedValue(NON_OWNER)
    getTenantKeys.mockResolvedValue({ apify: "tenant-2-token", openai: null })
    getUsage.mockResolvedValue({ monthlyUsd: 1, limitUsd: 10, pct: 10, computeUnits: 0, computeUnitsLimit: null })
    maskToken.mockReturnValue("masked")
    const { GET } = await import("@/app/api/apify/usage/route")
    const res = await GET()
    expect(res.status).toBe(200)
    expect(getUsage).toHaveBeenCalledWith({ token: "tenant-2-token" })
    expect(maskToken).toHaveBeenCalledWith("tenant-2-token")
  })

  it("owner with no stored key → falls back to process.env.APIFY_TOKEN", async () => {
    requireTenant.mockResolvedValue(OWNER)
    getTenantKeys.mockResolvedValue({ apify: null, openai: null })
    getUsage.mockResolvedValue({ monthlyUsd: 0, limitUsd: null, pct: null, computeUnits: 0, computeUnitsLimit: null })
    maskToken.mockReturnValue("masked")
    const { GET } = await import("@/app/api/apify/usage/route")
    const res = await GET()
    expect(res.status).toBe(200)
    expect(getUsage).toHaveBeenCalledWith({ token: "env-shared-token" })
  })

  it("owner with a stored key → the stored key wins over the env fallback", async () => {
    requireTenant.mockResolvedValue(OWNER)
    getTenantKeys.mockResolvedValue({ apify: "owner-own-token", openai: null })
    getUsage.mockResolvedValue({ monthlyUsd: 0, limitUsd: null, pct: null, computeUnits: 0, computeUnitsLimit: null })
    maskToken.mockReturnValue("masked")
    const { GET } = await import("@/app/api/apify/usage/route")
    const res = await GET()
    expect(getUsage).toHaveBeenCalledWith({ token: "owner-own-token" })
  })

  it("unresolvable tenant → 500, never calls getUsage", async () => {
    requireTenant.mockRejectedValue(new Error("unauthenticated"))
    const { GET } = await import("@/app/api/apify/usage/route")
    const res = await GET()
    expect(res.status).toBe(500)
    expect(getUsage).not.toHaveBeenCalled()
  })
})

describe("GET /api/apify/runs", () => {
  it("non-owner with no key → 200 needsKey, never calls getRuns", async () => {
    requireTenant.mockResolvedValue(NON_OWNER)
    getTenantKeys.mockResolvedValue({ apify: null, openai: null })
    const { GET } = await import("@/app/api/apify/runs/route")
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: "no_apify_key", needsKey: true })
    expect(getRuns).not.toHaveBeenCalled()
  })

  it("caller with a stored key → getRuns called with that token", async () => {
    requireTenant.mockResolvedValue(NON_OWNER)
    getTenantKeys.mockResolvedValue({ apify: "tenant-2-token", openai: null })
    getRuns.mockResolvedValue({ actors: [], recent: [] })
    const { GET } = await import("@/app/api/apify/runs/route")
    const res = await GET()
    expect(res.status).toBe(200)
    expect(getRuns).toHaveBeenCalledWith({ token: "tenant-2-token" })
  })
})

describe("POST /api/apify/runs/[id]/abort", () => {
  function paramsFor(id: string) { return { params: Promise.resolve({ id }) } }

  function fakeReq(): import("next/server").NextRequest {
    return new Request("http://localhost/api/apify/runs/r1/abort", { method: "POST" }) as unknown as import("next/server").NextRequest
  }

  it("non-owner with no key → 200 needsKey, never calls abortRun", async () => {
    requireTenant.mockResolvedValue(NON_OWNER)
    getTenantKeys.mockResolvedValue({ apify: null, openai: null })
    const { POST } = await import("@/app/api/apify/runs/[id]/abort/route")
    const res = await POST(fakeReq(), paramsFor("r1"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: "no_apify_key", needsKey: true })
    expect(abortRun).not.toHaveBeenCalled()
  })

  it("caller with a stored key → abortRun called with that token", async () => {
    requireTenant.mockResolvedValue(NON_OWNER)
    getTenantKeys.mockResolvedValue({ apify: "tenant-2-token", openai: null })
    abortRun.mockResolvedValue({ id: "r1", status: "ABORTING" })
    const { POST } = await import("@/app/api/apify/runs/[id]/abort/route")
    const res = await POST(fakeReq(), paramsFor("r1"))
    expect(res.status).toBe(200)
    expect(abortRun).toHaveBeenCalledWith("r1", { token: "tenant-2-token" })
  })
})

describe("POST /api/apify/validate", () => {
  it("non-owner with no key → 200 needsKey, never calls validateToken", async () => {
    requireTenant.mockResolvedValue(NON_OWNER)
    getTenantKeys.mockResolvedValue({ apify: null, openai: null })
    const { POST } = await import("@/app/api/apify/validate/route")
    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: "no_apify_key", needsKey: true })
    expect(validateToken).not.toHaveBeenCalled()
  })

  it("owner with no stored key → validateToken called with the env token", async () => {
    requireTenant.mockResolvedValue(OWNER)
    getTenantKeys.mockResolvedValue({ apify: null, openai: null })
    validateToken.mockResolvedValue({ ok: true, username: "owner", plan: "team" })
    const { POST } = await import("@/app/api/apify/validate/route")
    const res = await POST()
    expect(res.status).toBe(200)
    expect(validateToken).toHaveBeenCalledWith({ token: "env-shared-token" })
  })

  it("caller with a stored key → validateToken called with that token, not the env token", async () => {
    requireTenant.mockResolvedValue(NON_OWNER)
    getTenantKeys.mockResolvedValue({ apify: "tenant-2-token", openai: null })
    validateToken.mockResolvedValue({ ok: true, username: "tenant2", plan: "free" })
    const { POST } = await import("@/app/api/apify/validate/route")
    const res = await POST()
    expect(validateToken).toHaveBeenCalledWith({ token: "tenant-2-token" })
  })
})
