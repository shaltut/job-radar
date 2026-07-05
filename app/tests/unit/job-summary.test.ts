import { describe, it, expect } from "vitest"
import { formatJobSummary } from "@/lib/job-summary"

describe("formatJobSummary", () => {
  it("renders stack(top4)+N — no location, no work_mode (both have their own columns; type forbids passing either)", () => {
    expect(formatJobSummary({ tech_stack: ["Go","Postgres","K8s","AWS","Redis"] }))
      .toBe("Go · Postgres · K8s · AWS +1")
  })
  it("short stack (<=4): no overflow suffix", () => {
    expect(formatJobSummary({ tech_stack: ["Go","Postgres"] })).toBe("Go · Postgres")
  })
  it("is empty when no stack (caller renders no sub-line, not redundant text)", () => {
    expect(formatJobSummary({})).toBe("")
  })
})
