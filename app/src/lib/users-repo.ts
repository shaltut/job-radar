import "server-only"
import { jobsDb } from "@/lib/jobs-db"

type Q = { query: (text: string, params: any[]) => Promise<{ rows: any[] }> }
type PoolLike = { connect: () => Promise<Q & { release: () => void }> }

export interface DbUser {
  id: string
  email: string
  password_hash: string
  name: string | null
  tenant_id: string | null
  is_owner: boolean | null
  disabled: boolean
}

export interface AdminUserRow {
  id: string
  email: string
  name: string | null
  disabled: boolean
  created_at: string
  is_owner: boolean | null
}

export async function getUserByEmail(email: string, client: Q = jobsDb): Promise<DbUser | null> {
  const res = await client.query(
    "SELECT u.id, u.email, u.password_hash, u.name, u.tenant_id, u.disabled, t.is_owner FROM users u LEFT JOIN tenants t ON t.id=u.tenant_id WHERE u.email=$1",
    [email.trim().toLowerCase()]
  )
  return res.rows[0] ?? null
}

/**
 * Owner-only (#129 admin user management): lists every user across all tenants
 * for the /admin/users page — id/email/name/disabled/created_at + is_owner (to
 * identify the admin's own row, which can't be disabled).
 */
export async function listUsers(client: Q = jobsDb): Promise<AdminUserRow[]> {
  const res = await client.query(
    "SELECT u.id, u.email, u.name, u.disabled, u.created_at, t.is_owner FROM users u LEFT JOIN tenants t ON t.id=u.tenant_id ORDER BY u.created_at DESC",
    []
  )
  return res.rows
}

/**
 * Owner-only (#129): soft-disable/enable a user. Disabled users fail
 * verifyCredentials (auth-credentials.ts) even with a correct password; their
 * data is kept (never deleted).
 */
export async function setUserDisabled(userId: string, disabled: boolean, client: Q = jobsDb): Promise<void> {
  await client.query("UPDATE users SET disabled=$1 WHERE id=$2", [disabled, userId])
}

/**
 * Creates a tenant + its first user atomically (BEGIN/COMMIT, ROLLBACK on
 * error) via a dedicated pool client, so a duplicate-email signup can never
 * commit an orphan tenant with no user attached to it.
 */
export async function createTenantAndUser(
  email: string,
  passwordHash: string,
  name: string | null,
  pool: PoolLike = jobsDb
): Promise<{ id: string; email: string; name: string | null; tenantId: string }> {
  const e = email.trim().toLowerCase()
  const client = await pool.connect()
  try {
    await client.query("BEGIN", [])
    const t = await client.query("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name ? `${name}'s workspace` : e])
    const tenantId = t.rows[0].id
    const u = await client.query(
      "INSERT INTO users (email, password_hash, name, tenant_id) VALUES ($1,$2,$3,$4) RETURNING id, email, name",
      [e, passwordHash, name, tenantId]
    )
    // Belt-and-suspenders (C2 Task 4): seed this tenant's tenant_source_config from the
    // global sources catalog, enabled=false for every row. Not required for read-correctness
    // (discovery-repo's getDiscoveryConfig LEFT JOINs + COALESCEs enabled to false when no row
    // exists yet — behaviorally identical), but leaves a fully-populated, debuggable row set.
    await client.query(
      "INSERT INTO tenant_source_config (tenant_id, source_name, enabled) SELECT $1, name, false FROM sources ON CONFLICT (tenant_id, source_name) DO NOTHING",
      [tenantId],
    )
    await client.query("COMMIT", [])
    return { ...u.rows[0], tenantId }
  } catch (err: any) {
    await client.query("ROLLBACK", []).catch(() => {})
    if (err?.code === "23505") throw new Error("email_taken")
    throw err
  } finally {
    client.release()
  }
}

export async function createUser(
  email: string,
  passwordHash: string,
  name: string | null,
  client: Q = jobsDb
): Promise<{ id: string; email: string; name: string | null }> {
  try {
    const res = await client.query(
      "INSERT INTO users (email, password_hash, name) VALUES ($1,$2,$3) RETURNING id, email, name",
      [email.trim().toLowerCase(), passwordHash, name]
    )
    return res.rows[0]
  } catch (e: any) {
    if (e?.code === "23505") throw new Error("email_taken")
    throw e
  }
}
