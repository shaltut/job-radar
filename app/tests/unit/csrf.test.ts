import { describe, it, expect } from "vitest"
import { isMutating, isSameOrigin } from "@/lib/csrf"

const req = (method: string, headers: Record<string, string>) =>
  new Request("https://jobs.example.com/api/jobs", { method, headers })

describe("csrf", () => {
  it("GET/HEAD are non-mutating", () => {
    expect(isMutating("GET")).toBe(false)
    expect(isMutating("POST")).toBe(true)
  })
  it("same-origin POST passes", () =>
    expect(isSameOrigin(req("POST", { origin: "https://jobs.example.com" }))).toBe(true))
  it("cross-origin POST blocked", () =>
    expect(isSameOrigin(req("POST", { origin: "https://evil.com" }))).toBe(false))
  it("mutating POST with NO origin/referer blocked", () => expect(isSameOrigin(req("POST", {}))).toBe(false))
  it("GET with no origin passes", () => expect(isSameOrigin(req("GET", {}))).toBe(true))
  it("falls back to referer host", () =>
    expect(isSameOrigin(req("POST", { referer: "https://jobs.example.com/login" }))).toBe(true))
})
