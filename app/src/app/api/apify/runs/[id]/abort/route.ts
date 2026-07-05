import { NextRequest, NextResponse } from "next/server"
import { abortRun } from "@/lib/apify-api"
import { requireTenant } from "@/lib/tenancy"
import { getTenantKeys } from "@/lib/secrets"

// Per-tenant (BYO-key, C3): aborts a run using the caller's own Apify token; the owner
// falls back to the shared process.env.APIFY_TOKEN when they haven't set one. No key →
// an empty-state signal (needsKey), not a 403 — any authenticated tenant may reach this route.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { tenantId, isOwner } = await requireTenant()
    const token = (await getTenantKeys(tenantId)).apify ?? (isOwner ? process.env.APIFY_TOKEN ?? null : null)
    if (!token) return NextResponse.json({ error: "no_apify_key", needsKey: true }, { status: 200 })
    const { id } = await params
    if (!id || typeof id !== "string") return NextResponse.json({ error: "Invalid run id" }, { status: 400 })
    const r = await abortRun(id, { token })
    return NextResponse.json(r, { status: "error" in r ? 502 : 200 })
  } catch (error) {
    console.error("[/api/apify/runs/[id]/abort POST]", error)
    return NextResponse.json({ error: "Failed to abort run" }, { status: 500 })
  }
}
