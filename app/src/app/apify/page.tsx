import { redirect } from "next/navigation"
import { requireTenant } from "@/lib/tenancy"
import ApifyPageClient from "./apify-client"

/**
 * Server wrapper: per-tenant (BYO-key, C3) — any signed-in tenant may view this
 * page now (not owner-only). Each caller sees their own Apify usage/runs via
 * their stored token (owner falls back to the shared process.env.APIFY_TOKEN);
 * callers with no key see the client's "add your key in Settings" empty state,
 * driven by the underlying API routes' `needsKey` response. Redirects to "/"
 * only if the session can't resolve a tenant at all.
 */
export default async function ApifyPage() {
  try {
    await requireTenant()
  } catch {
    redirect("/")
  }
  return <ApifyPageClient />
}
