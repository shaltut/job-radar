import "server-only"
import { jobsDb } from "@/lib/jobs-db"
export interface TenantCtx { userId: string; tenantId: string; isOwner: boolean }
type SessionUser = { id?: string; tenantId?: string; isOwner?: boolean } | null | undefined
type Fallback = (userId: string) => Promise<{ id: string; tenant_id: string; is_owner: boolean } | null>

export async function resolveTenantCtx(u: SessionUser, fallback: Fallback): Promise<TenantCtx> {
  if (!u?.id) throw new Error("unauthenticated")
  if (u.tenantId) return { userId: u.id, tenantId: u.tenantId, isOwner: !!u.isOwner }
  const row = await fallback(u.id)
  if (!row) throw new Error("no tenant for user")
  return { userId: String(row.id), tenantId: String(row.tenant_id), isOwner: !!row.is_owner }
}
const dbFallback: Fallback = async (userId) => {
  const r = await jobsDb.query("SELECT u.id, u.tenant_id, t.is_owner FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1", [userId])
  return r.rows[0] ?? null
}
export async function requireTenant(): Promise<TenantCtx> {
  // Lazy import: statically importing "@/auth" pulls in next-auth at module-load
  // time, which vitest's native ESM loader can't resolve in this repo's pnpm
  // layout (next-auth's ESM build imports the extensionless "next/server", and
  // this Next version has no "exports" map to redirect it — a Next.js/next-auth
  // interop quirk, not a tenancy bug). Deferring the import keeps that dependency
  // out of tenancy.test.ts's module graph (it only exercises resolveTenantCtx)
  // while behaving identically at runtime, where the bundler resolves it fine.
  const { auth } = await import("@/auth")
  const session = await auth()
  return resolveTenantCtx(session?.user as SessionUser, dbFallback)
}
export async function requireOwner(): Promise<TenantCtx> {
  const ctx = await requireTenant()
  if (!ctx.isOwner) throw new Error("owner only")
  return ctx
}

/**
 * Route-level guard for owner-only control-plane endpoints (discovery config,
 * Apify usage/runs/validate, etc). Returns a 403 Response if the caller is not
 * the owner (including unauthenticated — defense-in-depth; the middleware
 * already redirects unauth requests before they reach API routes), or null
 * when the caller may proceed.
 *
 * Usage: `const g = await ownerGuard(); if (g) return g` before any work.
 */
export async function ownerGuard(): Promise<Response | null> {
  try {
    await requireOwner()
    return null
  } catch {
    return Response.json({ error: "forbidden" }, { status: 403 })
  }
}
