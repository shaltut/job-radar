import "server-only"
import crypto from "node:crypto"
import { jobsDb } from "@/lib/jobs-db"

function key(): Buffer {
  const b64 = process.env.SECRETS_KEY
  if (!b64) throw new Error("SECRETS_KEY unset")
  const k = Buffer.from(b64, "base64")
  if (k.length !== 32) throw new Error("SECRETS_KEY must be 32 bytes (base64)")
  return k
}
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv)
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()])
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":")
}
export function decryptSecret(enc: string): string {
  const parts = enc.split(":")
  if (parts.length !== 3) throw new Error("bad ciphertext format")
  const [iv, tag, ct] = parts.map((p) => Buffer.from(p, "base64"))
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8")  // throws if tag mismatch
}
const COL = { apify: "apify_token_enc", openai: "openai_key_enc" } as const
export async function getTenantKeys(tenantId: string) {
  const r = await jobsDb.query("SELECT apify_token_enc, openai_key_enc FROM tenant_secrets WHERE tenant_id = $1", [tenantId])
  const row = r.rows[0]
  const dec = (v?: string | null) => { try { return v ? decryptSecret(v) : null } catch { return null } }
  return { apify: dec(row?.apify_token_enc), openai: dec(row?.openai_key_enc) }
}
export async function getTenantKeyStatus(tenantId: string) {
  const k = await getTenantKeys(tenantId)
  const st = (v: string | null) => (v ? { set: true, last4: v.slice(-4) } : { set: false })
  return { apify: st(k.apify), openai: st(k.openai) }
}
export async function setTenantKey(tenantId: string, which: "apify" | "openai", plaintext: string) {
  const col = COL[which]
  await jobsDb.query(
    `INSERT INTO tenant_secrets (tenant_id, ${col}, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (tenant_id) DO UPDATE SET ${col} = EXCLUDED.${col}, updated_at = now()`,
    [tenantId, encryptSecret(plaintext)])
}
export async function clearTenantKey(tenantId: string, which: "apify" | "openai") {
  await jobsDb.query(`UPDATE tenant_secrets SET ${COL[which]} = NULL, updated_at = now() WHERE tenant_id = $1`, [tenantId])
}
