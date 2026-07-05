import { NextRequest, NextResponse } from "next/server"
import { jobsDb } from "@/lib/jobs-db"
import { requireTenant } from "@/lib/tenancy"
import { parseListParams, listJobs, distinctFacets, updateJobStatuses, isValidStatus, normalizeJobIds } from "@/lib/jobs-repo"

export async function GET(request: NextRequest) {
  try {
    const { tenantId } = await requireTenant()
    const params = parseListParams(request.nextUrl.searchParams)
    const [{ jobs, total, totalPages }, facets] = await Promise.all([
      listJobs(jobsDb, tenantId, params),
      distinctFacets(jobsDb, tenantId),
    ])
    return NextResponse.json({ jobs, facets, page: params.page, limit: params.limit, total, totalPages })
  } catch (error) {
    console.error("[/api/jobs GET]", error)
    return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 })
  }
}

/** Bulk status change: PATCH /api/jobs { ids: number[], status }. Auth + CSRF via proxy.ts. */
export async function PATCH(request: NextRequest) {
  try {
    const { tenantId } = await requireTenant()
    const body = await request.json().catch(() => null)
    // jobs.id is BIGSERIAL → ids arrive as strings; coerce + validate (see normalizeJobIds).
    const ids = normalizeJobIds((body as { ids?: unknown })?.ids)
    const status = (body as { status?: unknown })?.status
    if (!ids) {
      return NextResponse.json({ error: "ids must be a non-empty array of integers" }, { status: 400 })
    }
    if (!isValidStatus(status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 })
    }
    const updated = await updateJobStatuses(jobsDb, tenantId, ids, status)
    return NextResponse.json({ updated: updated.length, ids: updated })
  } catch (error) {
    console.error("[/api/jobs PATCH]", error)
    return NextResponse.json({ error: "Failed to update jobs" }, { status: 500 })
  }
}
