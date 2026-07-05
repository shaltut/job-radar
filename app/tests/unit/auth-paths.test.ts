import { describe, it, expect } from "vitest"
import { isPublicPath } from "@/lib/auth-paths"
describe("isPublicPath", () => {
  it("public paths", () => { for (const p of ["/login", "/signup", "/api/auth/callback/credentials", "/api/signup"]) expect(isPublicPath(p)).toBe(true) })
  it("protected paths", () => { for (const p of ["/", "/discovery", "/apify", "/api/jobs", "/api/jobs/5"]) expect(isPublicPath(p)).toBe(false) })
})
