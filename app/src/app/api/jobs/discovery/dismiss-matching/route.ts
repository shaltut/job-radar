import { NextResponse } from "next/server"
import { jobsDb } from "@/lib/jobs-db"
import { requireTenant } from "@/lib/tenancy"
import { dismissMatchingExcluded } from "@/lib/discovery-repo"

/**
 * POST /api/jobs/discovery/dismiss-matching → dismiss inbox jobs that match an exclude
 * keyword. Returns { dismissed: count }. Auth + CSRF inherited from proxy.ts.
 *
 * Per-tenant (C2): dismissMatchingExcluded() is now tenant-scoped on both sides —
 * it reads only THIS tenant's exclude terms and its UPDATE carries `AND tenant_id`,
 * so it can no longer touch another tenant's jobs (pre-C2 this ran a fully
 * unscoped UPDATE across ALL tenants' jobs; see discovery-repo.ts).
 */
export async function POST() {
  try {
    const { tenantId } = await requireTenant()
    const dismissed = await dismissMatchingExcluded(jobsDb, tenantId)
    return NextResponse.json({ dismissed })
  } catch (error) {
    console.error("[/api/jobs/discovery/dismiss-matching POST]", error)
    return NextResponse.json({ error: "Failed to dismiss matching jobs" }, { status: 500 })
  }
}
