import type { NextFetchEvent, NextRequest } from "next/server"
import { auth } from "@/auth"
import { isMutating, isSameOrigin } from "@/lib/csrf"

// `auth` is callable directly as a Request-in/Response-out middleware (this
// is exactly how `export { auth as proxy } from "@/auth"` worked before);
// next-auth's public types don't expose that overload, so it's cast here.
type AuthProxy = (request: NextRequest, event: NextFetchEvent) => Promise<Response>

/**
 * #126: real CSRF defense. Runs BEFORE any Auth.js handling — a mutating
 * (POST/PUT/PATCH/DELETE) request to `/api/*` whose Origin (or, failing
 * that, Referer) host doesn't match the request's own host is rejected with
 * 403, no session/auth work performed. Same-origin requests (the app's own
 * forms/fetches) are unaffected and fall through to the existing Auth.js
 * `authorized` gating unchanged.
 */
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (request.nextUrl.pathname.startsWith("/api/") && isMutating(request.method) && !isSameOrigin(request)) {
    return new Response(JSON.stringify({ error: "csrf" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })
  }
  return (auth as unknown as AuthProxy)(request, event)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
}
