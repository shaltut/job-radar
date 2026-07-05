import { describe, it, expect } from "vitest"
import { getUserByEmail, createUser, createTenantAndUser, listUsers, setUserDisabled } from "@/lib/users-repo"
function fake(rowsOrErr: any) {
  return { calls: [] as any[], async query(text: string, params: any[]) { this.calls.push({ text, params }); if (rowsOrErr instanceof Error) throw rowsOrErr; return { rows: rowsOrErr } } }
}
describe("users-repo", () => {
  it("getUserByEmail lowercases + selects", async () => {
    const c = fake([{ id: "1", email: "a@b.com", password_hash: "H", name: "A" }])
    const u = await getUserByEmail("A@B.com", c as any)
    expect(u?.id).toBe("1"); expect(c.calls[0].params[0]).toBe("a@b.com"); expect(c.calls[0].text).toMatch(/from users/i)
  })
  it("getUserByEmail → null when absent", async () => { expect(await getUserByEmail("x@y.com", fake([]) as any)).toBeNull() })
  it("getUserByEmail includes tenant_id + is_owner (LEFT JOIN tenants)", async () => {
    const c = fake([{ id: "1", email: "a@b.com", password_hash: "H", name: "A", tenant_id: "3", is_owner: true }])
    const u = await getUserByEmail("a@b.com", c as any)
    expect(u?.tenant_id).toBe("3"); expect(u?.is_owner).toBe(true); expect(c.calls[0].text).toMatch(/left join tenants/i)
  })
  it("getUserByEmail includes disabled (#129)", async () => {
    const c = fake([{ id: "1", email: "a@b.com", password_hash: "H", name: "A", disabled: true }])
    const u = await getUserByEmail("a@b.com", c as any)
    expect(u?.disabled).toBe(true)
    expect(c.calls[0].text).toMatch(/disabled/i)
  })
  it("listUsers selects id/email/name/disabled/created_at + is_owner (JOIN tenants)", async () => {
    const c = fake([{ id: "1", email: "a@b.com", name: "A", disabled: false, created_at: "2026-01-01", is_owner: true }])
    const rows = await listUsers(c as any)
    expect(rows).toEqual([{ id: "1", email: "a@b.com", name: "A", disabled: false, created_at: "2026-01-01", is_owner: true }])
    expect(c.calls[0].text).toMatch(/left join tenants/i)
    expect(c.calls[0].text).toMatch(/disabled/i)
    expect(c.calls[0].text).toMatch(/order by u\.created_at desc/i)
  })
  it("setUserDisabled emits UPDATE users SET disabled=$1 WHERE id=$2", async () => {
    const c = fake([])
    await setUserDisabled("7", true, c as any)
    expect(c.calls[0].text).toMatch(/update users set disabled\s*=\s*\$1 where id\s*=\s*\$2/i)
    expect(c.calls[0].params).toEqual([true, "7"])
  })
  it("createUser inserts lowercased email + returns id", async () => {
    const c = fake([{ id: "5", email: "a@b.com", name: "A" }])
    const u = await createUser("A@B.com", "HASH", "A", c as any)
    expect(u.id).toBe("5"); expect(c.calls[0].params).toEqual(["a@b.com", "HASH", "A"])
  })
  it("createUser duplicate → email_taken", async () => {
    const dup: any = new Error("dup"); dup.code = "23505"
    await expect(createUser("a@b.com", "H", null, fake(dup) as any)).rejects.toThrow("email_taken")
  })
  // createTenantAndUser is transactional (M1 fix): it acquires a dedicated client from
  // a pool, wraps the two INSERTs in BEGIN/COMMIT, and ROLLBACKs on error so a
  // duplicate-email signup can never commit an orphan tenant. These tests use a fake
  // "pool" whose .connect() returns a fake client — mirroring how `pg.Pool` is used in
  // production — rather than passing a bare query-only object directly.
  function fakePool(queue: any[]) {
    const calls: any[] = []
    let released = false
    const client = {
      async query(text: string, params: any[]) {
        calls.push({ text, params })
        const r = queue.shift()
        if (r instanceof Error) throw r
        return r
      },
      release() { released = true },
    }
    return { calls, isReleased: () => released, connect: async () => client }
  }

  it("createTenantAndUser runs both INSERTs + the tenant_source_config seed inside BEGIN/COMMIT, returns tenantId, releases the client", async () => {
    const pool = fakePool([
      { rows: [] }, // BEGIN
      { rows: [{ id: "9" }] }, // INSERT tenants
      { rows: [{ id: "5", email: "a@b.com", name: "A" }] }, // INSERT users
      { rows: [] }, // INSERT tenant_source_config (seed)
      { rows: [] }, // COMMIT
    ])
    const u = await createTenantAndUser("A@B.com", "HASH", "A", pool as any)
    expect(u).toEqual({ id: "5", email: "a@b.com", name: "A", tenantId: "9" })
    expect(pool.calls[0].text).toMatch(/^begin/i)
    expect(pool.calls[1].text).toMatch(/insert into tenants/i)
    expect(pool.calls[2].text).toMatch(/insert into users/i)
    expect(pool.calls[2].params).toEqual(["a@b.com", "HASH", "A", "9"])
    expect(pool.calls[3].text).toMatch(/insert into tenant_source_config/i)
    expect(pool.calls[4].text).toMatch(/^commit/i)
    expect(pool.isReleased()).toBe(true)
  })

  it("seeds tenant_source_config (enabled=false) from the global sources catalog", async () => {
    const pool = fakePool([
      { rows: [] }, // BEGIN
      { rows: [{ id: "9" }] }, // INSERT tenants
      { rows: [{ id: "5", email: "new@x.com", name: null }] }, // INSERT users
      { rows: [] }, // INSERT tenant_source_config (seed)
      { rows: [] }, // COMMIT
    ])
    await createTenantAndUser("new@x.com", "hash", null, pool as any)
    const seed = pool.calls.find((c) => /INSERT INTO tenant_source_config/i.test(c.text))!
    expect(seed.text).toMatch(/SELECT \$1, name, false FROM sources/)
    expect(seed.text).toMatch(/ON CONFLICT \(tenant_id, source_name\) DO NOTHING/)
    expect(seed.params).toEqual(["9"])
  })

  it("createTenantAndUser duplicate email → ROLLBACK, email_taken, client still released", async () => {
    const dup: any = new Error("dup"); dup.code = "23505"
    const pool = fakePool([
      { rows: [] }, // BEGIN
      { rows: [{ id: "9" }] }, // INSERT tenants
      dup, // INSERT users fails
      { rows: [] }, // ROLLBACK
    ])
    await expect(createTenantAndUser("a@b.com", "H", null, pool as any)).rejects.toThrow("email_taken")
    expect(pool.calls.at(-1)?.text).toMatch(/^rollback/i)
    expect(pool.isReleased()).toBe(true)
  })
})
