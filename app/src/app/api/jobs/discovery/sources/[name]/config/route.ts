import { NextRequest, NextResponse } from "next/server"
import { jobsDb } from "@/lib/jobs-db"
import { requireTenant } from "@/lib/tenancy"
import { getDiscoveryConfig, setSourceConfig, isKnownSource } from "@/lib/discovery-repo"

/**
 * PATCH /api/jobs/discovery/sources/[name]/config
 *
 * Body: a plain JSON object (the full new config for this source).
 * Returns: { config: <saved config object> } on success.
 *
 * Validation:
 *   - Body must be a plain object (not array, not null, not primitive) → 400
 *   - If `advanced` is present it must be a plain object → 400
 *   - `name` must be a known source (membership against live DB) → 400
 *
 * Auth + CSRF are enforced centrally in proxy.ts — this route is NOT in
 * PUBLIC_ROUTES so it inherits session auth and X-CSRF-Token validation
 * exactly like all other /api/jobs/* write routes.
 *
 * Per-tenant (C2): any authenticated tenant may call this. Per-source filter
 * config is saved into THIS tenant's `tenant_source_config` row (source names
 * themselves are still the global catalog).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { tenantId } = await requireTenant()
    const { name } = await params
    // Parse body — treat a JSON parse failure as an invalid body (→ 400)
    const body = await request.json().catch(() => null)

    // Validate: body must be a plain object
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body: must be a plain object" }, { status: 400 })
    }
    const config = body as Record<string, unknown>

    // Validate: advanced (if present) must be a plain object
    if ("advanced" in config) {
      const adv = config.advanced
      if (typeof adv !== "object" || adv === null || Array.isArray(adv)) {
        return NextResponse.json(
          { error: "Invalid request body: 'advanced' must be a plain object" },
          { status: 400 },
        )
      }
    }

    // Validate: source must exist (data-driven, no hardcoded list)
    let discoveryConfig
    try {
      discoveryConfig = await getDiscoveryConfig(jobsDb, tenantId)
    } catch (error) {
      console.error("[/api/jobs/discovery/sources/[name]/config PATCH] getDiscoveryConfig", error)
      return NextResponse.json({ error: "Failed to fetch discovery config" }, { status: 500 })
    }
    if (!isKnownSource(discoveryConfig, name)) {
      return NextResponse.json({ error: `Unknown source: ${name}` }, { status: 400 })
    }

    let saved
    try {
      saved = await setSourceConfig(jobsDb, tenantId, name, config)
    } catch (err) {
      // setSourceConfig throws descriptive errors on invalid input → 400
      const msg = err instanceof Error ? err.message : "Invalid config"
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    return NextResponse.json({ config: saved })
  } catch (error) {
    console.error("[/api/jobs/discovery/sources/[name]/config PATCH]", error)
    return NextResponse.json({ error: "Failed to save source config" }, { status: 500 })
  }
}
