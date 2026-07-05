import { describe, it, expect } from "vitest"
import { toggleValue, filterOptions } from "@/components/jobs/multi-select"

describe("toggleValue", () => {
  it("adds when absent, removes when present, preserves order", () => {
    expect(toggleValue([], "new")).toEqual(["new"])
    expect(toggleValue(["new", "applied"], "x")).toEqual(["new", "applied", "x"])
    expect(toggleValue(["new", "applied"], "new")).toEqual(["applied"])
  })
})

describe("filterOptions", () => {
  const opts = [{ value: "a", label: "Senior Backend" }, { value: "b", label: "Junior QA" }, { value: "c", label: "Staff Backend" }]
  it("case-insensitive substring match on label", () => {
    expect(filterOptions(opts, "back").map((o) => o.value)).toEqual(["a", "c"])
    expect(filterOptions(opts, "SENIOR").map((o) => o.value)).toEqual(["a"])
  })
  it("empty term returns all", () => {
    expect(filterOptions(opts, "   ")).toEqual(opts)
  })
})
