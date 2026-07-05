import { describe, it, expect } from "vitest"
import { buildJobsQuery, parseJobsView, type JobsViewState } from "@/lib/jobs-url"

const sample: JobsViewState = {
  statuses: ["shortlisted"], markets: [], sources: ["remoteok"],
  titles: [], companies: [], locations: ["Riyadh, Saudi Arabia"], workModes: ["remote", "hybrid"],
  categories: ["Technology & IT", "Healthcare"], eligibilities: ["us_citizen_only", "none"],
  scoreMin: 70, scoreMax: null, addedWithin: "", postedWithin: "30",
  hasMaterials: true, sorts: [{ col: "score", dir: "desc" }, { col: "company", dir: "asc" }], page: 2,
  q: "react",
}

describe("jobs-url round-trip", () => {
  it("build → parse restores the state (comma-safe, repeated params)", () => {
    const sp = buildJobsQuery(sample)
    expect(sp.getAll("locations")).toEqual(["Riyadh, Saudi Arabia"])  // comma intact
    expect(sp.getAll("workModes")).toEqual(["remote", "hybrid"])
    expect(sp.getAll("categories")).toEqual(["Technology & IT", "Healthcare"])
    expect(sp.getAll("eligibilities")).toEqual(["us_citizen_only", "none"])
    expect(sp.get("sort")).toBe("score:desc,company:asc")
    expect(sp.get("q")).toBe("react")
    expect(parseJobsView(sp)).toEqual(sample)
  })
  it("empty state → empty-ish query and back", () => {
    const empty: JobsViewState = { statuses: [], markets: [], sources: [], titles: [], companies: [], locations: [], workModes: [], categories: [], eligibilities: [], scoreMin: null, scoreMax: null, addedWithin: "", postedWithin: "", hasMaterials: false, sorts: [], page: 1, q: "" }
    const sp = buildJobsQuery(empty)
    expect(sp.has("q")).toBe(false) // empty q omitted from the URL entirely
    expect(sp.has("workModes")).toBe(false)
    expect(sp.has("categories")).toBe(false)
    expect(sp.has("eligibilities")).toBe(false)
    expect(parseJobsView(sp)).toEqual(empty)
  })
  it("q round-trips independently of other filters", () => {
    const sp = buildJobsQuery({ ...sample, q: "node.js & go" })
    expect(sp.get("q")).toBe("node.js & go")
    expect(parseJobsView(sp).q).toBe("node.js & go")
  })
  it("categories/eligibilities round-trip independently of other filters", () => {
    const sp = buildJobsQuery({ ...sample, categories: ["Other"], eligibilities: ["security_clearance"] })
    expect(sp.getAll("categories")).toEqual(["Other"])
    expect(sp.getAll("eligibilities")).toEqual(["security_clearance"])
    const parsed = parseJobsView(sp)
    expect(parsed.categories).toEqual(["Other"])
    expect(parsed.eligibilities).toEqual(["security_clearance"])
  })
})
