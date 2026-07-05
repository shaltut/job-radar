import { NextRequest, NextResponse } from "next/server"
import { jobsDb } from "@/lib/jobs-db"
import { ownerGuard, requireOwner } from "@/lib/tenancy"
import { createPreview } from "@/lib/discovery-repo"

/**
 * POST /api/jobs/discovery/sources/[name]/preview
 *
 * Enqueues a preview request for the named source (capped at 10 records by
 * default). The engine's poller picks it up, runs the source in isolation
 * (no DB writes to `jobs`), and writes the result back to `source_previews`.
 *
 * Returns: { id: number } — the preview row id to poll via GET /previews/[id].
 *
 * Errors:
 *   400 — source name is not in the seeded `sources` table (unknown source).
 *   500 — unexpected DB error.
 *
 * Auth + CSRF are enforced centrally in proxy.ts — this route is NOT in
 * PUBLIC_ROUTES so it inherits session auth and X-CSRF-Token validation
 * exactly like all other /api/jobs/* write routes.
 *
 * Owner-only until the Phase-4 multi-tenant engine (C2 boundary, kept
 * intentionally): previews run against the single-tenant engine (owner-scoped
 * config) — ownerGuard() 403s non-owners. createPreview() is tenant-scoped like
 * every other discovery-repo fn; this route resolves the OWNER's own tenantId
 * (requireOwner()) to pass in.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const g = await ownerGuard()
  if (g) return g
  try {
    const { tenantId } = await requireOwner()
    const { name } = await params
    let id: number
    try {
      id = await createPreview(jobsDb, tenantId, name)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid source"
      if (msg.startsWith("unknown source")) {
        return NextResponse.json({ error: msg }, { status: 400 })
      }
      throw err
    }
    return NextResponse.json({ id })
  } catch (error) {
    console.error("[/api/jobs/discovery/sources/[name]/preview POST]", error)
    return NextResponse.json({ error: "Failed to create preview" }, { status: 500 })
  }
}
