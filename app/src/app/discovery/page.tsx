import { redirect } from "next/navigation"
import { requireTenant } from "@/lib/tenancy"
import DiscoveryPageClient from "./discovery-client"

/**
 * Server wrapper: per-tenant (C2) — every tenant now reads/writes their OWN
 * discovery config (sources/intervals/excludes), so any authenticated tenant
 * may reach this page; requireTenant() only redirects unauthenticated
 * requests to "/". Note the "Run discovery"/preview actions the client calls
 * stay owner-gated (C2 boundary: the engine is single-tenant until Phase 4) —
 * a non-owner reaching those specific buttons gets a 403 from the API, not
 * from this page.
 */
export default async function DiscoveryPage() {
  try {
    await requireTenant()
  } catch {
    redirect("/")
  }
  return <DiscoveryPageClient />
}
