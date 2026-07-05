import { redirect } from "next/navigation"
import { requireTenant } from "@/lib/tenancy"
import { getTenantKeyStatus } from "@/lib/secrets"
import { SettingsClient } from "./settings-client"

/**
 * Server wrapper: every signed-in user manages their own BYO keys (not
 * owner-gated, unlike /apify's shared-account view). Redirects to "/" if the
 * session can't resolve a tenant.
 */
export default async function SettingsPage() {
  let status
  try {
    const { tenantId } = await requireTenant()
    status = await getTenantKeyStatus(tenantId)
  } catch {
    redirect("/")
  }
  return <SettingsClient initialStatus={status} />
}
