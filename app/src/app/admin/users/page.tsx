import { redirect } from "next/navigation"
import { requireOwner } from "@/lib/tenancy"
import { listUsers } from "@/lib/users-repo"
import UsersClient from "./users-client"

/**
 * Server wrapper (#129): owner-only admin user management. Non-owners must
 * never reach the client UI (the underlying /api/admin/users routes are also
 * ownerGuard()-ed, but this keeps a non-owner from even seeing the page) —
 * same pattern as /discovery (C1). Redirects to "/" on failure.
 */
export default async function AdminUsersPage() {
  try {
    await requireOwner()
  } catch {
    redirect("/")
  }
  const users = await listUsers()
  return <UsersClient initialUsers={users} />
}
