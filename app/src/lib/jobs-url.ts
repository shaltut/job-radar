import { SORT_KEYS, type SortSpec } from "@/lib/jobs-repo"

export interface JobsViewState {
  statuses: string[]; markets: string[]; sources: string[]
  titles: string[]; companies: string[]; locations: string[]; workModes: string[]
  categories: string[]; eligibilities: string[]
  scoreMin: number | null; scoreMax: number | null
  addedWithin: string; postedWithin: string; hasMaterials: boolean
  q: string
  sorts: SortSpec[]; page: number
}

const ARRAY_KEYS = ["statuses", "markets", "sources", "titles", "companies", "locations", "workModes", "categories", "eligibilities"] as const

export function buildJobsQuery(s: JobsViewState): URLSearchParams {
  const sp = new URLSearchParams()
  for (const k of ARRAY_KEYS) (s[k] as string[]).forEach((v) => sp.append(k, v))
  if (s.scoreMin != null) sp.set("scoreMin", String(s.scoreMin))
  if (s.scoreMax != null) sp.set("scoreMax", String(s.scoreMax))
  if (s.addedWithin) sp.set("added", s.addedWithin)
  if (s.postedWithin) sp.set("posted", s.postedWithin)
  if (s.hasMaterials) sp.set("materials", "ready")
  if (s.q) sp.set("q", s.q)
  if (s.sorts.length) sp.set("sort", s.sorts.map((x) => `${x.col}:${x.dir}`).join(","))
  if (s.page > 1) sp.set("page", String(s.page))
  return sp
}

export function parseJobsView(sp: URLSearchParams): JobsViewState {
  const num = (v: string | null) => { const n = parseInt(v || "", 10); return Number.isFinite(n) ? n : null }
  const sorts: SortSpec[] = (sp.get("sort") || "").split(",").map((t) => t.trim()).filter(Boolean)
    .map((t) => { const [col, dir] = t.split(":"); return { col, dir } as { col: string; dir: string } })
    .filter((x): x is SortSpec => (SORT_KEYS as readonly string[]).includes(x.col) && (x.dir === "asc" || x.dir === "desc")) as SortSpec[]
  return {
    statuses: sp.getAll("statuses"), markets: sp.getAll("markets"), sources: sp.getAll("sources"),
    titles: sp.getAll("titles"), companies: sp.getAll("companies"), locations: sp.getAll("locations"), workModes: sp.getAll("workModes"),
    categories: sp.getAll("categories"), eligibilities: sp.getAll("eligibilities"),
    scoreMin: num(sp.get("scoreMin")), scoreMax: num(sp.get("scoreMax")),
    addedWithin: sp.get("added") || "", postedWithin: sp.get("posted") || "", hasMaterials: sp.get("materials") === "ready",
    q: sp.get("q") || "",
    sorts, page: Math.max(1, num(sp.get("page")) || 1),
  }
}
