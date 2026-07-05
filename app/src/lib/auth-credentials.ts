export interface SessionUser {
  id: string
  email: string
  name: string | null
  tenantId: string | null
  isOwner: boolean | null
}

interface Deps {
  getUser: (email: string) => Promise<
    { id: string; email: string; password_hash: string; name: string | null; tenant_id: string | null; is_owner: boolean | null; disabled?: boolean | null } | null
  >
  compare: (pw: string, hash: string) => Promise<boolean>
}

export async function verifyCredentials(email: string, password: string, { getUser, compare }: Deps): Promise<SessionUser | null> {
  if (!email || !password) return null
  const u = await getUser(email)
  if (!u) return null
  if (!(await compare(password, u.password_hash))) return null
  // #129: soft-disabled users (users.disabled=true) can never authenticate,
  // even with the correct password. Data is kept — only login is blocked.
  if (u.disabled) return null
  return { id: u.id, email: u.email, name: u.name, tenantId: u.tenant_id, isOwner: u.is_owner }
}
