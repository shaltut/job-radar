import { describe, it, expect, vi, beforeEach } from "vitest"

// #129: every /api/admin/users* route is owner-only (they list/create/disable users
// across all tenants). Mock ownerGuard() + users-repo + bcryptjs to prove a non-owner
// never reaches the repo layer, and that the happy paths call the right repo fns.
const { ownerGuard } = vi.hoisted(() => ({ ownerGuard: vi.fn() }))
const { listUsers, setUserDisabled, createTenantAndUser } = vi.hoisted(() => ({
  listUsers: vi.fn(),
  setUserDisabled: vi.fn(),
  createTenantAndUser: vi.fn(),
}))
const { hash } = vi.hoisted(() => ({ hash: vi.fn(async () => "HASHED") }))

vi.mock("@/lib/tenancy", () => ({ ownerGuard }))
vi.mock("@/lib/users-repo", () => ({ listUsers, setUserDisabled, createTenantAndUser }))
vi.mock("bcryptjs", () => ({ default: { hash } }))

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/admin/users", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

describe("admin users routes — exports", () => {
  it("collection route exports GET + POST", async () => {
    const mod = await import("@/app/api/admin/users/route")
    expect(typeof mod.GET).toBe("function")
    expect(typeof mod.POST).toBe("function")
  })
  it("[id] route exports PATCH", async () => {
    const mod = await import("@/app/api/admin/users/[id]/route")
    expect(typeof mod.PATCH).toBe("function")
  })
})

describe("GET /api/admin/users — owner gate", () => {
  beforeEach(() => { ownerGuard.mockReset(); listUsers.mockReset() })

  it("returns 403 for a non-owner without calling listUsers", async () => {
    ownerGuard.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))
    const { GET } = await import("@/app/api/admin/users/route")
    const res = await GET()
    expect(res.status).toBe(403)
    expect(listUsers).not.toHaveBeenCalled()
  })

  it("returns the user list when ownerGuard allows it", async () => {
    ownerGuard.mockResolvedValue(null)
    const rows = [{ id: "1", email: "a@b.com", name: "A", disabled: false, created_at: "now", is_owner: true }]
    listUsers.mockResolvedValue(rows)
    const { GET } = await import("@/app/api/admin/users/route")
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ users: rows })
  })
})

describe("POST /api/admin/users — owner gate + validation + create", () => {
  beforeEach(() => {
    ownerGuard.mockReset(); createTenantAndUser.mockReset(); hash.mockClear()
    hash.mockResolvedValue("HASHED")
  })

  it("returns 403 for a non-owner without calling createTenantAndUser", async () => {
    ownerGuard.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))
    const { POST } = await import("@/app/api/admin/users/route")
    const res = await POST(jsonReq({ email: "a@b.com", name: "A", password: "password1" }) as any)
    expect(res.status).toBe(403)
    expect(createTenantAndUser).not.toHaveBeenCalled()
  })

  it("rejects a missing email with 400", async () => {
    ownerGuard.mockResolvedValue(null)
    const { POST } = await import("@/app/api/admin/users/route")
    const res = await POST(jsonReq({ name: "A", password: "password1" }) as any)
    expect(res.status).toBe(400)
    expect(createTenantAndUser).not.toHaveBeenCalled()
  })

  it("rejects a weak/short password (<8 chars) with 400", async () => {
    ownerGuard.mockResolvedValue(null)
    const { POST } = await import("@/app/api/admin/users/route")
    const res = await POST(jsonReq({ email: "a@b.com", name: "A", password: "short" }) as any)
    expect(res.status).toBe(400)
    expect(createTenantAndUser).not.toHaveBeenCalled()
  })

  it("creates a user via createTenantAndUser with a bcrypt (cost 12) hash, never echoes the password", async () => {
    ownerGuard.mockResolvedValue(null)
    createTenantAndUser.mockResolvedValue({ id: "9", email: "a@b.com", name: "A", tenantId: "3" })
    const { POST } = await import("@/app/api/admin/users/route")
    const res = await POST(jsonReq({ email: "A@B.com", name: "A", password: "password1" }) as any)
    expect(res.status).toBe(200)
    expect(hash).toHaveBeenCalledWith("password1", 12)
    expect(createTenantAndUser).toHaveBeenCalledWith("A@B.com", "HASHED", "A")
    const body = await res.json()
    expect(body).toEqual({ user: { id: "9", email: "a@b.com", name: "A" } })
    expect(JSON.stringify(body)).not.toMatch(/password/i)
  })

  it("duplicate email → 409", async () => {
    ownerGuard.mockResolvedValue(null)
    createTenantAndUser.mockRejectedValue(new Error("email_taken"))
    const { POST } = await import("@/app/api/admin/users/route")
    const res = await POST(jsonReq({ email: "a@b.com", name: "A", password: "password1" }) as any)
    expect(res.status).toBe(409)
  })
})

describe("PATCH /api/admin/users/[id] — owner gate + owner-disable guard + toggle", () => {
  const params = Promise.resolve({ id: "5" })
  beforeEach(() => { ownerGuard.mockReset(); listUsers.mockReset(); setUserDisabled.mockReset() })

  function patchReq(body: unknown) {
    return new Request("http://localhost/api/admin/users/5", { method: "PATCH", body: JSON.stringify(body) })
  }

  it("returns 403 for a non-owner without calling setUserDisabled", async () => {
    ownerGuard.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))
    const { PATCH } = await import("@/app/api/admin/users/[id]/route")
    const res = await PATCH(patchReq({ disabled: true }) as any, { params })
    expect(res.status).toBe(403)
    expect(setUserDisabled).not.toHaveBeenCalled()
  })

  it("refuses to disable the owner's own account (400)", async () => {
    ownerGuard.mockResolvedValue(null)
    listUsers.mockResolvedValue([{ id: "5", email: "owner@b.com", name: "Owner", disabled: false, created_at: "now", is_owner: true }])
    const { PATCH } = await import("@/app/api/admin/users/[id]/route")
    const res = await PATCH(patchReq({ disabled: true }) as any, { params })
    expect(res.status).toBe(400)
    expect(setUserDisabled).not.toHaveBeenCalled()
  })

  it("disables a non-owner user, returns { ok: true }", async () => {
    ownerGuard.mockResolvedValue(null)
    listUsers.mockResolvedValue([{ id: "5", email: "u@b.com", name: "U", disabled: false, created_at: "now", is_owner: null }])
    setUserDisabled.mockResolvedValue(undefined)
    const { PATCH } = await import("@/app/api/admin/users/[id]/route")
    const res = await PATCH(patchReq({ disabled: true }) as any, { params })
    expect(res.status).toBe(200)
    expect(setUserDisabled).toHaveBeenCalledWith("5", true)
    expect(await res.json()).toEqual({ ok: true })
  })

  it("re-enables a user", async () => {
    ownerGuard.mockResolvedValue(null)
    listUsers.mockResolvedValue([{ id: "5", email: "u@b.com", name: "U", disabled: true, created_at: "now", is_owner: null }])
    setUserDisabled.mockResolvedValue(undefined)
    const { PATCH } = await import("@/app/api/admin/users/[id]/route")
    const res = await PATCH(patchReq({ disabled: false }) as any, { params })
    expect(res.status).toBe(200)
    expect(setUserDisabled).toHaveBeenCalledWith("5", false)
  })

  it("404 when the target user doesn't exist", async () => {
    ownerGuard.mockResolvedValue(null)
    listUsers.mockResolvedValue([])
    const { PATCH } = await import("@/app/api/admin/users/[id]/route")
    const res = await PATCH(patchReq({ disabled: true }) as any, { params })
    expect(res.status).toBe(404)
    expect(setUserDisabled).not.toHaveBeenCalled()
  })

  it("400 for a malformed body (disabled not boolean)", async () => {
    ownerGuard.mockResolvedValue(null)
    const { PATCH } = await import("@/app/api/admin/users/[id]/route")
    const res = await PATCH(patchReq({ disabled: "yes" }) as any, { params })
    expect(res.status).toBe(400)
    expect(setUserDisabled).not.toHaveBeenCalled()
  })
})
