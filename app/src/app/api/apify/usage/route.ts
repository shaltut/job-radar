import { NextResponse } from "next/server"
import { getUsage, maskToken } from "@/lib/apify-api"
import { requireTenant } from "@/lib/tenancy"
import { getTenantKeys } from "@/lib/secrets"

// Per-tenant (BYO-key, C3): each caller's own Apify token; the owner falls back to the
// shared process.env.APIFY_TOKEN when they haven't set one. No key → an empty-state
// signal (needsKey), not a 403 — any authenticated tenant may reach this route.
export async function GET() {
  try {
    const { tenantId, isOwner } = await requireTenant()
    const token = (await getTenantKeys(tenantId)).apify ?? (isOwner ? process.env.APIFY_TOKEN ?? null : null)
    if (!token) return NextResponse.json({ error: "no_apify_key", needsKey: true }, { status: 200 })
    const usage = await getUsage({ token })
    const masked = maskToken(token)
    return NextResponse.json("error" in usage ? { error: usage.error, masked } : { usage, masked })
  } catch (error) {
    console.error("[/api/apify/usage GET]", error)
    return NextResponse.json({ error: "Failed to load usage" }, { status: 500 })
  }
}
