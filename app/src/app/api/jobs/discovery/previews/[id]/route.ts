import { NextRequest, NextResponse } from "next/server"
import { jobsDb } from "@/lib/jobs-db"
import { ownerGuard, requireOwner } from "@/lib/tenancy"
import { getPreview } from "@/lib/discovery-repo"

/**
 * GET /api/jobs/discovery/previews/[id]
 *
 * Poll a preview request by id. Returns the current status, result (when
 * done), and error (when failed).
 *
 * Returns: { status, result, error }
 *   status: 'requested' | 'running' | 'done' | 'error'
 *   result: { fetched, kept, jobs:[...] } when status==='done', else null
 *   error:  string when status==='error', else null
 *
 * Errors:
 *   400 — id is not a positive integer.
 *   404 — no preview row found for that id.
 *   500 — unexpected DB error.
 *
 * Auth + CSRF are enforced centrally in proxy.ts — this route is NOT in
 * PUBLIC_ROUTES so it inherits session auth and X-CSRF-Token validation
 * exactly like all other /api/jobs/* read routes.
 *
 * Owner-only until the Phase-4 multi-tenant engine (C2 boundary, kept
 * intentionally): previews run against the single-tenant engine (owner-scoped
 * config) — ownerGuard() 403s non-owners. getPreview() is still tenant-scoped
 * like every other discovery-repo fn; this route resolves the OWNER's own
 * tenantId (requireOwner()) to pass in, so a non-owner can never even attempt
 * an id belonging to another tenant.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await ownerGuard()
  if (g) return g
  try {
    const { tenantId } = await requireOwner()
    const { id: idStr } = await params
    const id = Number(idStr)
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid preview id" }, { status: 400 })
    }

    const row = await getPreview(jobsDb, tenantId, id)
    if (!row) {
      return NextResponse.json({ error: "Preview not found" }, { status: 404 })
    }

    return NextResponse.json({ status: row.status, result: row.result, error: row.error })
  } catch (error) {
    console.error("[/api/jobs/discovery/previews/[id] GET]", error)
    return NextResponse.json({ error: "Failed to fetch preview" }, { status: 500 })
  }
}
