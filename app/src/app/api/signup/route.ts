import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { createTenantAndUser } from "@/lib/users-repo"
import { rateLimit } from "@/lib/rate-limit"

const SIGNUP_RATE_LIMIT_MAX = 5
const SIGNUP_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour

export async function POST(req: NextRequest) {
  // #129: public self-registration is off by default. Flag (not deletion) so
  // SaaS self-serve can be re-enabled later; checked before any validation.
  if (process.env.REGISTRATION_ENABLED !== "true") {
    return NextResponse.json({ error: "registration_disabled" }, { status: 403 })
  }

  // #126: 5 signups/hr/IP, checked before touching the body so an abusive IP
  // can't force repeated bcrypt/DB work even with malformed payloads.
  // Key on x-real-ip (NPM sets it to $remote_addr; the app binds 127.0.0.1 so
  // NPM is the sole ingress). NEVER trust the leftmost X-Forwarded-For token —
  // it's client-supplied and $proxy_add_x_forwarded_for appends the real IP
  // after it, so the left end is attacker-controlled. Fall back to the LAST
  // XFF token (the trusted hop) then a constant.
  const xff = req.headers.get("x-forwarded-for")
  const ip = req.headers.get("x-real-ip")?.trim()
    || xff?.split(",").pop()?.trim()
    || "unknown"
  if (!rateLimit(`signup:${ip}`, SIGNUP_RATE_LIMIT_MAX, SIGNUP_RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  try {
    const { email, password, name, company_website } = await req.json()
    // #126: honeypot. Real users never see or fill this hidden field; a bot
    // that fills every input will. Don't tell it — pretend success silently.
    if (company_website) {
      return NextResponse.json({ ok: true })
    }
    if (!email || !password || String(password).length < 8) return NextResponse.json({ error: "Email and an 8+ char password are required" }, { status: 400 })
    const hash = await bcrypt.hash(String(password), 12)
    const user = await createTenantAndUser(String(email), hash, name ? String(name) : null)
    return NextResponse.json({ ok: true, user })
  } catch (e: any) {
    if (e?.message === "email_taken") return NextResponse.json({ error: "That email is already registered" }, { status: 409 })
    console.error("[/api/signup]", e)
    return NextResponse.json({ error: "Signup failed" }, { status: 500 })
  }
}
