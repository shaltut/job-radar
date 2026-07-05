import { describe, it, expect, beforeEach, afterEach } from "vitest"
describe("signup route", () => {
  it("exports POST", async () => { expect(typeof (await import("@/app/api/signup/route")).POST).toBe("function") })
})

describe("POST /api/signup — registration gate (#129)", () => {
  const savedEnv = process.env.REGISTRATION_ENABLED
  beforeEach(() => { delete process.env.REGISTRATION_ENABLED })
  afterEach(() => { process.env.REGISTRATION_ENABLED = savedEnv })

  it("returns 403 when REGISTRATION_ENABLED is unset (default off)", async () => {
    const { POST } = await import("@/app/api/signup/route")
    const req = new Request("http://localhost/api/signup", {
      method: "POST",
      body: JSON.stringify({ email: "a@b.com", password: "password1", name: "A" }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "registration_disabled" })
  })

  it("returns 403 when REGISTRATION_ENABLED is not exactly \"true\"", async () => {
    process.env.REGISTRATION_ENABLED = "false"
    const { POST } = await import("@/app/api/signup/route")
    const req = new Request("http://localhost/api/signup", {
      method: "POST",
      body: JSON.stringify({ email: "a@b.com", password: "password1", name: "A" }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(403)
  })
})

describe("POST /api/signup — rate limit + honeypot (#126)", () => {
  const savedEnv = process.env.REGISTRATION_ENABLED
  beforeEach(() => { process.env.REGISTRATION_ENABLED = "true" })
  afterEach(() => { process.env.REGISTRATION_ENABLED = savedEnv })

  // Deliberately invalid bodies (no password) so every attempt returns 400
  // without ever reaching bcrypt/DB — only the rate-limit counter (which runs
  // before body validation) is under test here.
  const invalidReq = (ip: string) =>
    new Request("http://localhost/api/signup", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: JSON.stringify({ email: "a@b.com" }),
    })

  it("allows 5 attempts/hr/IP then blocks the 6th with 429", async () => {
    const { POST } = await import("@/app/api/signup/route")
    const ip = `203.0.113.${Math.floor(Math.random() * 255)}`
    for (let i = 0; i < 5; i++) {
      const res = await POST(invalidReq(ip) as any)
      expect(res.status).toBe(400) // validation error, not yet rate-limited
    }
    const sixth = await POST(invalidReq(ip) as any)
    expect(sixth.status).toBe(429)
    expect(await sixth.json()).toEqual({ error: "rate_limited" })
  })

  it("tracks each IP independently", async () => {
    const { POST } = await import("@/app/api/signup/route")
    const ipA = `198.51.100.${Math.floor(Math.random() * 255)}`
    const ipB = `198.51.100.${Math.floor(Math.random() * 255) + 1}`
    for (let i = 0; i < 5; i++) await POST(invalidReq(ipA) as any)
    expect((await POST(invalidReq(ipA) as any)).status).toBe(429)
    // a different IP is unaffected by ipA's exhausted bucket
    expect((await POST(invalidReq(ipB) as any)).status).toBe(400)
  })

  it("honeypot: a filled company_website returns a fake 200 and never creates a user", async () => {
    const { POST } = await import("@/app/api/signup/route")
    const req = new Request("http://localhost/api/signup", {
      method: "POST",
      headers: { "x-forwarded-for": `192.0.2.${Math.floor(Math.random() * 255)}` },
      body: JSON.stringify({
        email: "bot@spam.com",
        password: "password1",
        name: "Bot",
        company_website: "https://totally-a-real-company.example",
      }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(body.user).toBeUndefined()
  })
})
