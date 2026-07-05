import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { ownerGuard } from "@/lib/tenancy"
import { listUsers, createTenantAndUser } from "@/lib/users-repo"

/**
 * GET  /api/admin/users  → { users: AdminUserRow[] } — every user, every tenant.
 * POST /api/admin/users  → { user: {id,email,name} } — admin-provisioned user.
 *
 * #129: owner-only (this is the whole tenant roster, not just the caller's own
 * tenant). ownerGuard() 403s any non-owner (including unauthenticated) before
 * any repo call. Auth + CSRF for state-changing methods are enforced centrally
 * in proxy.ts, same as every other /api/* route.
 *
 * Admin-provisioned users are created exactly like a public signup
 * (createTenantAndUser: a fresh tenant + its first user, transactional) — the
 * only difference is the admin types the temp password instead of the user
 * choosing it. Passwords are bcrypt-hashed at cost 12 and never echoed back.
 */
export async function GET() {
  const g = await ownerGuard()
  if (g) return g
  try {
    const users = await listUsers()
    return NextResponse.json({ users })
  } catch (error) {
    console.error("[/api/admin/users GET]", error)
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const g = await ownerGuard()
  if (g) return g
  try {
    const body = await request.json().catch(() => ({}))
    const { email, name, password } = body as { email?: unknown; name?: unknown; password?: unknown }
    if (typeof email !== "string" || !email.trim()) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }
    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
    }
    const nameStr = typeof name === "string" && name.trim() ? name : null
    const hash = await bcrypt.hash(password, 12)
    const user = await createTenantAndUser(email, hash, nameStr)
    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } })
  } catch (e: any) {
    if (e?.message === "email_taken") {
      return NextResponse.json({ error: "That email is already registered" }, { status: 409 })
    }
    console.error("[/api/admin/users POST]", e)
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 })
  }
}
