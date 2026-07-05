import { describe, it, expect } from "vitest"
import { rateLimit } from "@/lib/rate-limit"

describe("rateLimit", () => {
  it("allows the first `max` hits and blocks the next one", () => {
    const key = `test-basic-${Math.random()}`
    expect(rateLimit(key, 3, 60_000)).toBe(true)
    expect(rateLimit(key, 3, 60_000)).toBe(true)
    expect(rateLimit(key, 3, 60_000)).toBe(true)
    expect(rateLimit(key, 3, 60_000)).toBe(false)
  })

  it("tracks different keys independently", () => {
    const a = `test-a-${Math.random()}`
    const b = `test-b-${Math.random()}`
    expect(rateLimit(a, 1, 60_000)).toBe(true)
    expect(rateLimit(a, 1, 60_000)).toBe(false)
    // b has its own independent bucket
    expect(rateLimit(b, 1, 60_000)).toBe(true)
  })

  it("prunes hits older than the window (injectable `now`)", () => {
    const key = `test-window-${Math.random()}`
    const t0 = 1_000_000
    expect(rateLimit(key, 1, 1_000, t0)).toBe(true)
    // immediately after: still within the window, blocked
    expect(rateLimit(key, 1, 1_000, t0 + 500)).toBe(false)
    // after the window has elapsed: the old hit is pruned, allowed again
    expect(rateLimit(key, 1, 1_000, t0 + 1_500)).toBe(true)
  })

  it("defaults `now` to Date.now() when omitted", () => {
    const key = `test-default-now-${Math.random()}`
    expect(rateLimit(key, 2, 60_000)).toBe(true)
    expect(rateLimit(key, 2, 60_000)).toBe(true)
    expect(rateLimit(key, 2, 60_000)).toBe(false)
  })
})
