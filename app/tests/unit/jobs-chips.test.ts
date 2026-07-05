import { describe, it, expect } from "vitest"
import { activeFilterChips } from "@/lib/jobs-chips"

describe("activeFilterChips", () => {
  it("one chip per selected array value + scalar chips", () => {
    const chips = activeFilterChips({
      statuses: ["shortlisted"], markets: [], sources: ["remoteok", "bayt"],
      titles: [], companies: [], locations: [], workModes: ["remote"],
      categories: [], eligibilities: [],
      scoreMin: 70, scoreMax: null, addedWithin: "", postedWithin: "30", hasMaterials: true, q: "",
    })
    const keys = chips.map((c) => c.key)
    expect(keys).toContain("statuses:shortlisted")
    expect(keys).toContain("sources:remoteok")
    expect(keys).toContain("sources:bayt")
    expect(keys).toContain("workModes:remote")
    expect(keys).toContain("scoreMin")
    expect(keys).toContain("postedWithin")
    expect(keys).toContain("materials")
    expect(chips.find((c) => c.key === "scoreMin")!.label).toMatch(/≥\s*70/)
    expect(chips.find((c) => c.key === "workModes:remote")!.label).toBe("Work: remote")
  })
  it("empty state → no chips", () => {
    expect(activeFilterChips({ statuses: [], markets: [], sources: [], titles: [], companies: [], locations: [], workModes: [], categories: [], eligibilities: [], scoreMin: null, scoreMax: null, addedWithin: "", postedWithin: "", hasMaterials: false, q: "" })).toEqual([])
  })
  it("q set → one search chip; q empty → no chip", () => {
    const base = { statuses: [], markets: [], sources: [], titles: [], companies: [], locations: [], workModes: [], categories: [], eligibilities: [], scoreMin: null, scoreMax: null, addedWithin: "", postedWithin: "", hasMaterials: false }
    const chips = activeFilterChips({ ...base, q: "react" })
    expect(chips).toEqual([{ key: "q", label: expect.stringContaining("react") }])
    expect(activeFilterChips({ ...base, q: "" })).toEqual([])
  })
  it("one chip per selected category, raw value used as-is", () => {
    const base = { statuses: [], markets: [], sources: [], titles: [], companies: [], locations: [], workModes: [], eligibilities: [], scoreMin: null, scoreMax: null, addedWithin: "", postedWithin: "", hasMaterials: false, q: "" }
    const chips = activeFilterChips({ ...base, categories: ["Technology & IT", "Healthcare"] })
    expect(chips).toEqual([
      { key: "categories:Technology & IT", label: "Category: Technology & IT" },
      { key: "categories:Healthcare", label: "Category: Healthcare" },
    ])
  })
  it("one chip per selected eligibility, using the friendly label (not the raw enum value)", () => {
    const base = { statuses: [], markets: [], sources: [], titles: [], companies: [], locations: [], workModes: [], categories: [], scoreMin: null, scoreMax: null, addedWithin: "", postedWithin: "", hasMaterials: false, q: "" }
    const chips = activeFilterChips({ ...base, eligibilities: ["us_citizen_only", "none"] })
    expect(chips).toEqual([
      { key: "eligibilities:us_citizen_only", label: "Eligibility: US citizens" },
      { key: "eligibilities:none", label: "Eligibility: —" },
    ])
  })
})
