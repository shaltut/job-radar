import { describe, it, expect } from "vitest"
import { relativeAgo } from "@/lib/relative-time"

const NOW = Date.parse("2026-06-21T12:00:00Z")
const ago = (days: number) => new Date(NOW - days * 86400000).toISOString()

describe("relativeAgo", () => {
  it("handles null/invalid", () => {
    expect(relativeAgo(null, NOW)).toBe("—")
    expect(relativeAgo("not-a-date", NOW)).toBe("—")
  })
  it("today / yesterday / days", () => {
    expect(relativeAgo(ago(0), NOW)).toBe("today")
    expect(relativeAgo(ago(1), NOW)).toBe("yesterday")
    expect(relativeAgo(ago(5), NOW)).toBe("5 days ago")
    expect(relativeAgo(ago(29), NOW)).toBe("29 days ago")
  })
  it("months", () => {
    expect(relativeAgo(ago(30), NOW)).toBe("1 month ago")
    expect(relativeAgo(ago(90), NOW)).toBe("3 months ago")
    expect(relativeAgo(ago(360), NOW)).toBe("12 months ago")
  })
  it("years", () => {
    expect(relativeAgo(ago(365), NOW)).toBe("1 year ago")
    expect(relativeAgo(ago(800), NOW)).toBe("2 years ago")
  })
  it("future date → soon", () => {
    expect(relativeAgo(new Date(NOW + 86400000).toISOString(), NOW)).toBe("soon")
  })
})
