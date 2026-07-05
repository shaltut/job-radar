import { ELIGIBILITY_STD_LABELS, type EligibilityStd } from "@/lib/jobs-repo"

export interface FilterChip { key: string; label: string }

export interface ChipState {
  statuses: string[]; markets: string[]; sources: string[]
  titles: string[]; companies: string[]; locations: string[]; workModes: string[]
  categories: string[]; eligibilities: string[]
  scoreMin: number | null; scoreMax: number | null
  addedWithin: string; postedWithin: string; hasMaterials: boolean
  q: string
}

const ARRAY_LABELS: Record<string, string> = {
  statuses: "Status", markets: "Market", sources: "Source", titles: "Title", companies: "Company", locations: "Location", workModes: "Work",
  categories: "Category", eligibilities: "Eligibility",
}

// Friendly value labels per array key (defaults to the raw value when the key has none).
const VALUE_LABELS: Partial<Record<string, Record<string, string>>> = {
  eligibilities: ELIGIBILITY_STD_LABELS,
}

export function activeFilterChips(s: ChipState): FilterChip[] {
  const chips: FilterChip[] = []
  for (const key of ["statuses", "markets", "sources", "titles", "companies", "locations", "workModes", "categories", "eligibilities"] as const) {
    for (const v of s[key]) {
      const valueLabel = VALUE_LABELS[key]?.[v as EligibilityStd] ?? v
      chips.push({ key: `${key}:${v}`, label: `${ARRAY_LABELS[key]}: ${valueLabel}` })
    }
  }
  if (s.scoreMin != null) chips.push({ key: "scoreMin", label: `Score ≥ ${s.scoreMin}` })
  if (s.scoreMax != null) chips.push({ key: "scoreMax", label: `Score ≤ ${s.scoreMax}` })
  if (s.addedWithin) chips.push({ key: "addedWithin", label: `Added ≤ ${s.addedWithin}d` })
  if (s.postedWithin) chips.push({ key: "postedWithin", label: `Posted ≤ ${s.postedWithin}d` })
  if (s.hasMaterials) chips.push({ key: "materials", label: "Has materials" })
  if (s.q) chips.push({ key: "q", label: `Search: "${s.q}"` })
  return chips
}
