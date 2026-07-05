import { NextRequest, NextResponse } from "next/server"
import { jobsDb } from "@/lib/jobs-db"
import { requireTenant } from "@/lib/tenancy"
import {
  getDiscoveryConfig,
  getSourceConfig,
  applyDiscoveryDiff,
  type DiscoveryDiff,
} from "@/lib/discovery-repo"

/**
 * GET  /api/jobs/discovery → { sources, excludes, sourceConfigs } (current config).
 * PUT  /api/jobs/discovery → applies a partial diff, returns the fresh config.
 *
 * Auth + CSRF are enforced centrally in proxy.ts for every /api/* route that is
 * not public, so this route inherits session auth and X-CSRF-Token validation
 * exactly like /api/jobs/[id] PATCH — no per-route auth code needed.
 *
 * Per-tenant (C2): every tenant reads/writes their OWN source toggles, intervals,
 * and exclude keywords — requireTenant() resolves the caller's tenantId, which is
 * threaded into every discovery-repo call below. The `sources` catalog stays
 * global/informational; per-tenant state lives in `tenant_source_config`.
 *
 * sourceConfigs: { [name]: Record<string, unknown> } — each source's per-source
 * filter config (from this tenant's tenant_source_config.config JSONB), fetched
 * in parallel alongside the main discovery config.
 */

export async function GET() {
  try {
    const { tenantId } = await requireTenant()
    const config = await getDiscoveryConfig(jobsDb, tenantId)
    // Fetch each source's filter config in parallel
    const sourceConfigEntries = await Promise.all(
      config.sources.map(async (s) => [s.name, await getSourceConfig(jobsDb, tenantId, s.name)] as const)
    )
    const sourceConfigs = Object.fromEntries(sourceConfigEntries)
    return NextResponse.json({ ...config, sourceConfigs })
  } catch (error) {
    console.error("[/api/jobs/discovery GET]", error)
    return NextResponse.json({ error: "Failed to fetch discovery config" }, { status: 500 })
  }
}

const isStr = (v: unknown): v is string => typeof v === "string"
const isBool = (v: unknown): v is boolean => typeof v === "boolean"

/**
 * Validate + narrow an untrusted body into a DiscoveryDiff, or null if malformed.
 * Validation lives HERE (not just downstream in applyDiscoveryDiff): every field is
 * type-checked, so a bad entry like {name:123} is rejected at the boundary with a 400
 * rather than relying on repo-layer guards. Exported for unit testing.
 */
export function parseDiff(body: unknown): DiscoveryDiff | null {
  if (typeof body !== "object" || body === null) return null
  const b = body as Record<string, unknown>
  const diff: DiscoveryDiff = {}

  if (b.sources !== undefined) {
    if (!Array.isArray(b.sources)) return null
    const sources: { name: string; enabled: boolean }[] = []
    for (const s of b.sources) {
      if (typeof s !== "object" || s === null) return null
      const { name, enabled } = s as Record<string, unknown>
      if (!isStr(name) || !isBool(enabled)) return null
      sources.push({ name, enabled })
    }
    diff.sources = sources
  }
  if (b.addExcludes !== undefined) {
    if (!Array.isArray(b.addExcludes) || b.addExcludes.some((t) => typeof t !== "string")) return null
    diff.addExcludes = b.addExcludes as string[]
  }
  if (b.removeExcludes !== undefined) {
    if (!Array.isArray(b.removeExcludes) || b.removeExcludes.some((t) => typeof t !== "string")) return null
    diff.removeExcludes = b.removeExcludes as string[]
  }
  if (b.intervals !== undefined) {
    if (!Array.isArray(b.intervals)) return null
    const intervals: { name: string; hours: number }[] = []
    for (const iv of b.intervals) {
      if (typeof iv !== "object" || iv === null) return null
      const { name, hours } = iv as Record<string, unknown>
      if (!isStr(name) || typeof hours !== "number") return null
      intervals.push({ name, hours })
    }
    diff.intervals = intervals
  }
  return diff
}

export async function PUT(request: NextRequest) {
  try {
    const { tenantId } = await requireTenant()
    const body = await request.json().catch(() => null)
    const diff = parseDiff(body)
    if (!diff) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }
    let config
    try {
      config = await applyDiscoveryDiff(jobsDb, tenantId, diff)
    } catch {
      // validation failure (unknown source/country, malformed term) → 400
      return NextResponse.json({ error: "Invalid discovery config update" }, { status: 400 })
    }
    return NextResponse.json(config)
  } catch (error) {
    console.error("[/api/jobs/discovery PUT]", error)
    return NextResponse.json({ error: "Failed to update discovery config" }, { status: 500 })
  }
}
