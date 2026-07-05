import { describe, it, expect, vi, beforeEach } from "vitest"

const TENANT = "tenant-1"

const { requireTenant } = vi.hoisted(() => ({ requireTenant: vi.fn() }))
const { getTenantKeyStatus, setTenantKey, clearTenantKey } = vi.hoisted(() => ({
  getTenantKeyStatus: vi.fn(),
  setTenantKey: vi.fn(),
  clearTenantKey: vi.fn(),
}))
const { validateApifyToken, validateOpenAiKey } = vi.hoisted(() => ({
  validateApifyToken: vi.fn(),
  validateOpenAiKey: vi.fn(),
}))

vi.mock("@/lib/tenancy", () => ({ requireTenant }))
vi.mock("@/lib/secrets", () => ({ getTenantKeyStatus, setTenantKey, clearTenantKey }))
vi.mock("@/lib/key-validate", () => ({ validateApifyToken, validateOpenAiKey }))

import { GET, POST } from "@/app/api/settings/keys/route"

function req(body: unknown): Request {
  return new Request("http://localhost/api/settings/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  requireTenant.mockReset()
  getTenantKeyStatus.mockReset()
  setTenantKey.mockReset()
  clearTenantKey.mockReset()
  validateApifyToken.mockReset()
  validateOpenAiKey.mockReset()
  requireTenant.mockResolvedValue({ userId: "u1", tenantId: TENANT, isOwner: false })
})

describe("GET /api/settings/keys", () => {
  it("returns the masked status shape, with no raw key field", async () => {
    getTenantKeyStatus.mockResolvedValue({
      apify: { set: true, last4: "abcd" },
      openai: { set: false },
    })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ apify: { set: true, last4: "abcd" }, openai: { set: false } })
    expect(JSON.stringify(body)).not.toMatch(/sk-|apify_/)
    expect(getTenantKeyStatus).toHaveBeenCalledWith(TENANT)
  })

  it("returns 500 when the caller has no resolvable tenant", async () => {
    requireTenant.mockRejectedValue(new Error("unauthenticated"))
    const res = await GET()
    expect(res.status).toBe(500)
    expect(getTenantKeyStatus).not.toHaveBeenCalled()
  })
})

describe("POST /api/settings/keys", () => {
  it("valid key → validates then stores", async () => {
    validateApifyToken.mockResolvedValue(true)
    const res = await POST(req({ which: "apify", value: "apify_realtoken" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(validateApifyToken).toHaveBeenCalledWith("apify_realtoken")
    expect(setTenantKey).toHaveBeenCalledWith(TENANT, "apify", "apify_realtoken")
    expect(clearTenantKey).not.toHaveBeenCalled()
  })

  it("invalid key → 400 and does not store", async () => {
    validateOpenAiKey.mockResolvedValue(false)
    const res = await POST(req({ which: "openai", value: "sk-bad" }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "invalid key" })
    expect(setTenantKey).not.toHaveBeenCalled()
  })

  it("empty value → clears the key without validating (removal)", async () => {
    const res = await POST(req({ which: "apify", value: "" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(clearTenantKey).toHaveBeenCalledWith(TENANT, "apify")
    expect(validateApifyToken).not.toHaveBeenCalled()
    expect(setTenantKey).not.toHaveBeenCalled()
  })

  it("rejects an invalid `which`", async () => {
    const res = await POST(req({ which: "bogus", value: "x" }))
    expect(res.status).toBe(400)
    expect(setTenantKey).not.toHaveBeenCalled()
    expect(clearTenantKey).not.toHaveBeenCalled()
  })

  it("returns 500 when the caller has no resolvable tenant", async () => {
    requireTenant.mockRejectedValue(new Error("unauthenticated"))
    const res = await POST(req({ which: "apify", value: "x" }))
    expect(res.status).toBe(500)
    expect(setTenantKey).not.toHaveBeenCalled()
  })

  it("returns 500 when the store throws", async () => {
    validateApifyToken.mockResolvedValue(true)
    setTenantKey.mockRejectedValue(new Error("db down"))
    const res = await POST(req({ which: "apify", value: "apify_realtoken" }))
    expect(res.status).toBe(500)
  })
})
