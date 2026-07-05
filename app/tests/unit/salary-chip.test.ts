import { describe, it, expect } from "vitest"
import { formatSalaryChip, formatSalaryUsd } from "@/lib/salary-chip"
describe("formatSalaryChip", () => {
  it("listed → range · listed", () => { expect(formatSalaryChip({ salary_range: "$120k–$150k", salary_source: "listed" })).toBe("$120k–$150k · listed") })
  it("estimated → ~range · est", () => { expect(formatSalaryChip({ salary_range: "$130k", salary_source: "estimated" })).toBe("~$130k · est") })
  it("no range → empty", () => { expect(formatSalaryChip({ salary_range: null, salary_source: null })).toBe("") })
  it("range but unknown/null source → range only (never claims 'listed')", () => { expect(formatSalaryChip({ salary_range: "$130k", salary_source: null })).toBe("$130k") })
})

describe("formatSalaryUsd", () => {
  it("range: formats yearly + derived monthly (÷12), with k-rounding", () => {
    expect(formatSalaryUsd({ salary_usd_min: 120_000, salary_usd_max: 150_000 })).toBe("$120k–$150k/yr · $10k–$12.5k/mo")
  })
  it("min === max: single figure for both yearly and monthly", () => {
    expect(formatSalaryUsd({ salary_usd_min: 120_000, salary_usd_max: 120_000 })).toBe("$120k/yr · $10k/mo")
  })
  it("both null → empty string", () => {
    expect(formatSalaryUsd({ salary_usd_min: null, salary_usd_max: null })).toBe("")
  })
  it("only min present → treated as a single figure", () => {
    expect(formatSalaryUsd({ salary_usd_min: 90_000, salary_usd_max: null })).toBe("$90k/yr · $7.5k/mo")
  })
  it("only max present → treated as a single figure", () => {
    expect(formatSalaryUsd({ salary_usd_min: null, salary_usd_max: 96_000 })).toBe("$96k/yr · $8k/mo")
  })
  it("non-round monthly division rounds sensibly to one decimal", () => {
    // 100000/12 = 8333.33 → $8.3k; 130000/12 = 10833.33 → $10.8k
    expect(formatSalaryUsd({ salary_usd_min: 100_000, salary_usd_max: 130_000 })).toBe("$100k–$130k/yr · $8.3k–$10.8k/mo")
  })
})
