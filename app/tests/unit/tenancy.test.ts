import { describe, it, expect, vi, beforeEach } from "vitest"

// requireTenant() lazily imports "@/auth" (see tenancy.ts comment: statically importing it
// pulls in next-auth's ESM build, which vitest's native loader can't resolve in this repo's
// pnpm layout). ownerGuard() calls requireOwner() -> requireTenant() -> that dynamic import,
// so exercising it here requires mocking "@/auth" — vi.mock intercepts dynamic imports of the
// same specifier too, so the real next-auth module is never touched.
const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock("@/auth", () => ({ auth }))
vi.mock("@/lib/jobs-db", () => ({ jobsDb: { query: vi.fn() } }))

import { resolveTenantCtx, ownerGuard } from "@/lib/tenancy"

describe("resolveTenantCtx", () => {
  const dbFallback = async (id: string) => (id === "7" ? { id: "7", tenant_id: "3", is_owner: true } : null)
  it("uses JWT claim when present", async () => {
    expect(await resolveTenantCtx({ id: "7", tenantId: "3", isOwner: true }, dbFallback)).toEqual({ userId: "7", tenantId: "3", isOwner: true })
  })
  it("falls back to DB when JWT lacks tenantId (pre-C session)", async () => {
    expect(await resolveTenantCtx({ id: "7" }, dbFallback)).toEqual({ userId: "7", tenantId: "3", isOwner: true })
  })
  it("throws when no user", async () => { await expect(resolveTenantCtx(null, dbFallback)).rejects.toThrow() })
  it("throws when user has no tenant anywhere", async () => { await expect(resolveTenantCtx({ id: "9" }, dbFallback)).rejects.toThrow() })
})

describe("ownerGuard", () => {
  beforeEach(() => { auth.mockReset() })

  it("returns null when the caller is the owner", async () => {
    auth.mockResolvedValue({ user: { id: "1", tenantId: "t1", isOwner: true } })
    expect(await ownerGuard()).toBeNull()
  })

  it("returns a 403 Response when requireOwner throws for a non-owner caller", async () => {
    auth.mockResolvedValue({ user: { id: "2", tenantId: "t1", isOwner: false } })
    const res = await ownerGuard()
    expect(res).not.toBeNull()
    expect(res?.status).toBe(403)
    expect(await res?.json()).toEqual({ error: "forbidden" })
  })

  it("returns a 403 Response when unauthenticated (defense-in-depth)", async () => {
    auth.mockResolvedValue(null)
    const res = await ownerGuard()
    expect(res?.status).toBe(403)
  })
})
