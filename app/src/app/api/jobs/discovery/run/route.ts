import { NextRequest, NextResponse } from "next/server"
import { jobsDb } from "@/lib/jobs-db"
import { ownerGuard, requireOwner } from "@/lib/tenancy"
import { latestDiscoveryRun, requestDiscoveryRun, isRunKind, type RunKind } from "@/lib/discovery-repo"

/**
 * GET  /api/jobs/discovery/run?kind=discover|score|tailor → latest run of that kind (poll).
 * POST /api/jobs/discovery/run  body {kind} → queue a UI run of that kind, returns latest.
 *
 * Auth + CSRF are enforced centrally in proxy.ts for non-public /api/* routes.
 *
 * Owner-only until the Phase-4 multi-tenant engine (C2 boundary, kept intentionally):
 * the discovery engine that executes discover/score/tailor runs is single-tenant
 * (JOBRADAR_TENANT_ID = the owner) — a non-owner queuing a run would enqueue work
 * whose results still land under the owner, which would be confusing/wrong to expose
 * broadly. ownerGuard() 403s non-owners; requireOwner() then resolves the owner's own
 * tenantId to pass into the repo calls (the repo fns are tenant-scoped like every
 * other discovery-repo fn — this route just always resolves the OWNER's tenantId).
 */

function kindOf(v: unknown): RunKind {
  return isRunKind(v) ? v : "discover"
}

export async function GET(request: NextRequest) {
  const g = await ownerGuard()
  if (g) return g
  try {
    const { tenantId } = await requireOwner()
    const kind = kindOf(request.nextUrl.searchParams.get("kind"))
    return NextResponse.json({ run: await latestDiscoveryRun(jobsDb, tenantId, kind) })
  } catch (error) {
    console.error("[/api/jobs/discovery/run GET]", error)
    return NextResponse.json({ error: "Failed to fetch run" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const g = await ownerGuard()
  if (g) return g
  try {
    const { tenantId } = await requireOwner()
    const body = await request.json().catch(() => ({}))
    const kind = kindOf((body as { kind?: unknown })?.kind)
    return NextResponse.json({ run: await requestDiscoveryRun(jobsDb, tenantId, kind) })
  } catch (error) {
    console.error("[/api/jobs/discovery/run POST]", error)
    return NextResponse.json({ error: "Failed to queue run" }, { status: 500 })
  }
}
