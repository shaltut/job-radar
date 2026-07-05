/**
 * Human relative "ago" string for an ISO date (e.g. "today", "yesterday",
 * "5 days ago", "3 months ago", "2 years ago"). `now` is injectable for
 * deterministic tests. Display-only — never used for sorting/filtering.
 */
export function relativeAgo(d: string | null | undefined, now: number = Date.now()): string {
  if (!d) return "—"
  const t = new Date(d).getTime()
  if (!Number.isFinite(t)) return "—"
  const days = Math.floor((now - t) / 86400000)
  if (days < 0) return "soon"
  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 30) return `${days} days ago`
  if (days < 365) {
    const months = Math.max(1, Math.floor(days / 30))
    return months === 1 ? "1 month ago" : `${months} months ago`
  }
  const years = Math.floor(days / 365)
  return years === 1 ? "1 year ago" : `${years} years ago`
}
