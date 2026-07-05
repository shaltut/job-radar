import { NextResponse } from "next/server"
import { requireTenant } from "@/lib/tenancy"
import { getTenantKeyStatus, setTenantKey, clearTenantKey } from "@/lib/secrets"
import { validateApifyToken, validateOpenAiKey } from "@/lib/key-validate"

type Which = "apify" | "openai"

function isWhich(v: unknown): v is Which {
  return v === "apify" || v === "openai"
}

const VALIDATORS: Record<Which, (value: string) => Promise<boolean>> = {
  apify: validateApifyToken,
  openai: validateOpenAiKey,
}

/**
 * GET  /api/settings/keys → masked key status for the caller's tenant.
 * POST /api/settings/keys body {which, value} → validate-then-store (empty value = remove).
 *
 * Keys are NEVER returned to the client — only `getTenantKeyStatus`'s masked
 * shape (`{set, last4?}`). CSRF hardening is tracked separately (#126); this
 * route relies on the Auth.js session + Authelia same-origin posture for now.
 */
export async function GET() {
  try {
    const { tenantId } = await requireTenant()
    return NextResponse.json(await getTenantKeyStatus(tenantId))
  } catch (error) {
    console.error("[/api/settings/keys GET]", error)
    return NextResponse.json({ error: "Failed to load key status" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { tenantId } = await requireTenant()
    const body = await request.json().catch(() => ({}))
    const which = (body as { which?: unknown })?.which
    const value = (body as { value?: unknown })?.value
    if (!isWhich(which)) return NextResponse.json({ error: "invalid key" }, { status: 400 })
    if (typeof value !== "string") return NextResponse.json({ error: "invalid key" }, { status: 400 })

    // Empty value = removal. Handled BEFORE validation, since the validators
    // return false for an empty string (which would otherwise 400 a clear).
    if (value.trim() === "") {
      await clearTenantKey(tenantId, which)
      return NextResponse.json({ ok: true })
    }

    const valid = await VALIDATORS[which](value)
    if (!valid) return NextResponse.json({ error: "invalid key" }, { status: 400 })

    await setTenantKey(tenantId, which, value)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[/api/settings/keys POST]", error)
    return NextResponse.json({ error: "Failed to save key" }, { status: 500 })
  }
}
