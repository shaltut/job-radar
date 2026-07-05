export interface SalaryFields { salary_range?: string | null; salary_source?: string | null }

/** Compact salary chip text: "$120k–$150k · listed" / "~$130k · est" / "$130k" (unknown source) / "" when no range. */
export function formatSalaryChip(j: SalaryFields): string {
  if (!j.salary_range) return ""
  if (j.salary_source === "estimated") return `~${j.salary_range} · est`
  if (j.salary_source === "listed") return `${j.salary_range} · listed`
  return j.salary_range // unknown/null source: show the range, never claim "listed"
}

export interface UsdSalaryFields { salary_usd_min?: number | null; salary_usd_max?: number | null }

/** Format a yearly USD figure as a "$Nk" string, rounded to 1 decimal (dropped when whole). */
function formatK(n: number): string {
  const k = n / 1000
  const rounded = Number(k.toFixed(1))
  const str = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `$${str}k`
}

/**
 * Compact USD comp text derived from the engine's normalized yearly total comp figures:
 * "$120k–$150k/yr · $10k–$12.5k/mo" (monthly = yearly ÷ 12), or "$120k/yr · $10k/mo" when
 * min === max (or only one bound is present). Returns "" when both bounds are null.
 */
export function formatSalaryUsd(j: UsdSalaryFields): string {
  const { salary_usd_min, salary_usd_max } = j
  if (salary_usd_min == null && salary_usd_max == null) return ""
  const lo = salary_usd_min ?? salary_usd_max!
  const hi = salary_usd_max ?? salary_usd_min!
  const yearly = lo === hi ? `${formatK(lo)}/yr` : `${formatK(lo)}–${formatK(hi)}/yr`
  const monthly = lo === hi ? `${formatK(lo / 12)}/mo` : `${formatK(lo / 12)}–${formatK(hi / 12)}/mo`
  return `${yearly} · ${monthly}`
}
