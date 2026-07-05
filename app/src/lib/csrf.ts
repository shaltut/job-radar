/**
 * CSRF (Cross-Site Request Forgery) protection utilities
 *
 * Real, server-enforced protection (#126) is the origin/referer check below
 * (`isMutating` / `isSameOrigin`), wired into `src/proxy.ts` for every
 * mutating `/api/*` request — this is what actually gets enforced.
 *
 * The double-submit-cookie helpers further down are CLIENT-SIDE utilities
 * kept for existing callers (`fetchWithCsrf`/`api.*`); they attach an
 * `X-CSRF-Token` header when a `csrf_token` cookie is present, but no cookie
 * is currently issued and nothing server-side validates that header — they
 * are a no-op today and not part of the enforced defense.
 */

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"])

/** True for state-changing HTTP methods (POST/PUT/PATCH/DELETE). */
export function isMutating(method: string): boolean {
  return MUTATING.has(method.toUpperCase())
}

/**
 * True when the request is not mutating, or when its Origin header (falling
 * back to Referer) has the same host as the request itself. A mutating
 * request with neither header present is blocked — same-origin browsers
 * always send `Origin` on POST/PUT/PATCH/DELETE, so its absence is a strong
 * signal of a non-browser or forged request.
 */
export function isSameOrigin(request: Request): boolean {
  if (!isMutating(request.method)) return true
  const host = request.headers.get("host") ?? new URL(request.url).host
  const src = request.headers.get("origin") ?? request.headers.get("referer")
  if (!src) return false
  try {
    return new URL(src).host === host
  } catch {
    return false
  }
}

const CSRF_COOKIE_NAME = 'csrf_token'
const CSRF_HEADER_NAME = 'X-CSRF-Token'

/**
 * Get CSRF token from cookie (client-side)
 */
export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null

  const cookies = document.cookie.split(';')
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=')
    if (name === CSRF_COOKIE_NAME) {
      return decodeURIComponent(value)
    }
  }
  return null
}

/**
 * Get headers object with CSRF token included
 * Use this for state-changing requests (POST, PUT, DELETE, PATCH)
 */
export function getCsrfHeaders(): Record<string, string> {
  const token = getCsrfToken()
  if (!token) return {}
  return { [CSRF_HEADER_NAME]: token }
}

/**
 * Enhanced fetch wrapper that automatically includes CSRF token
 * for state-changing methods
 */
export async function fetchWithCsrf(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const method = (options.method || 'GET').toUpperCase()
  const isStateChanging = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)

  const headers = new Headers(options.headers)

  // Add CSRF token for state-changing methods
  if (isStateChanging) {
    const csrfToken = getCsrfToken()
    if (csrfToken) {
      headers.set(CSRF_HEADER_NAME, csrfToken)
    }
  }

  // Ensure JSON content type for POST/PUT/PATCH with body
  if (isStateChanging && options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Ensure cookies are sent
  })
}

/**
 * Convenience methods for common operations
 */
export const api = {
  get: (url: string, options?: RequestInit) =>
    fetchWithCsrf(url, { ...options, method: 'GET' }),

  post: (url: string, data?: unknown, options?: RequestInit) =>
    fetchWithCsrf(url, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: (url: string, data?: unknown, options?: RequestInit) =>
    fetchWithCsrf(url, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),

  patch: (url: string, data?: unknown, options?: RequestInit) =>
    fetchWithCsrf(url, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: (url: string, options?: RequestInit) =>
    fetchWithCsrf(url, { ...options, method: 'DELETE' }),
}
