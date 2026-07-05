import { describe, it, expect, vi } from "vitest"
import { NextRequest } from "next/server"

// `auth` itself talks to Postgres/session-decoding; mock it so this test stays
// hermetic and only proves proxy.ts's own wiring: the CSRF short-circuit runs
// BEFORE Auth.js is ever invoked, and same-origin requests still reach it.
const authMock = vi.fn(async () => new Response(null, { status: 200 }))
vi.mock("@/auth", () => ({ auth: authMock }))

const req = (url: string, method: string, headers: Record<string, string> = {}) =>
  new NextRequest(url, { method, headers })

describe("proxy #126 CSRF wiring", () => {
  it("blocks a cross-origin mutating /api request with 403, WITHOUT calling auth()", async () => {
    authMock.mockClear()
    const { proxy } = await import("@/proxy")
    const res = await proxy(req("https://jobs.example.com/api/jobs", "POST", { origin: "https://evil.com" }), {} as any)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "csrf" })
    expect(authMock).not.toHaveBeenCalled()
  })

  it("blocks a mutating /api request with no Origin/Referer at all", async () => {
    authMock.mockClear()
    const { proxy } = await import("@/proxy")
    const res = await proxy(req("https://jobs.example.com/api/jobs", "POST"), {} as any)
    expect(res.status).toBe(403)
    expect(authMock).not.toHaveBeenCalled()
  })

  it("passes a same-origin mutating /api request through to auth()", async () => {
    authMock.mockClear()
    const { proxy } = await import("@/proxy")
    const res = await proxy(
      req("https://jobs.example.com/api/jobs", "POST", { origin: "https://jobs.example.com" }),
      {} as any
    )
    expect(authMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
  })

  it("never runs the CSRF check for non-mutating requests (GET passes straight through)", async () => {
    authMock.mockClear()
    const { proxy } = await import("@/proxy")
    const res = await proxy(req("https://jobs.example.com/api/jobs", "GET"), {} as any)
    expect(authMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
  })

  it("does not touch non-/api paths (page routes bypass the CSRF check, still reach auth())", async () => {
    authMock.mockClear()
    const { proxy } = await import("@/proxy")
    const res = await proxy(req("https://jobs.example.com/dashboard", "POST", { origin: "https://evil.com" }), {} as any)
    expect(authMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
  })
})
