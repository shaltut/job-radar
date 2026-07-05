import { NextRequest, NextResponse } from "next/server"
import { ownerGuard } from "@/lib/tenancy"
import { listUsers, setUserDisabled } from "@/lib/users-repo"

/**
 * PATCH /api/admin/users/[id]  Body: { disabled: boolean } → { ok: true }
 *
 * #129: owner-only (ownerGuard()). Soft-disable/enable only — never deletes.
 * Guards against the admin locking themselves out: the target row's is_owner
 * (from listUsers()'s tenants JOIN) identifies the single owner account, and
 * disabling it is rejected with 400 regardless of who's asking.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await ownerGuard()
  if (g) return g
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const { disabled } = body as { disabled?: unknown }
    if (typeof disabled !== "boolean") {
      return NextResponse.json({ error: "'disabled' must be a boolean" }, { status: 400 })
    }

    const users = await listUsers()
    const target = users.find((u) => String(u.id) === String(id))
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }
    if (target.is_owner) {
      return NextResponse.json({ error: "cannot disable the admin" }, { status: 400 })
    }

    await setUserDisabled(id, disabled)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[/api/admin/users/:id PATCH]", error)
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 })
  }
}
