import { describe, it, expect } from "vitest"
import { verifyCredentials } from "@/lib/auth-credentials"
const user = { id: "1", email: "a@b.com", password_hash: "HASH", name: "A", tenant_id: "3", is_owner: true, disabled: false }
const getUser = async (e: string) => (e === "a@b.com" ? user : null)
const compare = async (p: string, h: string) => p === "pw" && h === "HASH"
describe("verifyCredentials", () => {
  it("valid → user (no password_hash leaked, tenant carried)", async () => {
    expect(await verifyCredentials("a@b.com", "pw", { getUser, compare })).toEqual({ id: "1", email: "a@b.com", name: "A", tenantId: "3", isOwner: true })
  })
  it("wrong password → null", async () => { expect(await verifyCredentials("a@b.com", "nope", { getUser, compare })).toBeNull() })
  it("unknown email → null", async () => { expect(await verifyCredentials("x@y.com", "pw", { getUser, compare })).toBeNull() })
  it("missing fields → null", async () => {
    expect(await verifyCredentials("", "pw", { getUser, compare })).toBeNull()
    expect(await verifyCredentials("a@b.com", "", { getUser, compare })).toBeNull()
  })
  it("disabled user, correct password → null (#129)", async () => {
    const disabledGetUser = async (e: string) => (e === "a@b.com" ? { ...user, disabled: true } : null)
    expect(await verifyCredentials("a@b.com", "pw", { getUser: disabledGetUser, compare })).toBeNull()
  })
})
