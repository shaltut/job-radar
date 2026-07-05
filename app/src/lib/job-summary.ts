export interface JobSummaryFields {
  tech_stack?: string[] | null
}

/**
 * Compact "stack(top4)+N" line for the jobs TABLE. Location and work_mode are
 * intentionally omitted — the table has its own Location column and a dedicated
 * Work column (badge from work_mode/remote), so echoing either here is noise.
 * Returns "" when there's nothing job-specific to show, so the caller renders no
 * sub-line (e.g. a not-yet-summarized job) rather than redundant text.
 * (The Telegram digest uses the engine's jobSummaryLine, which DOES include
 * location + mode because the digest has no Location/Work columns.)
 */
export function formatJobSummary(j: JobSummaryFields): string {
  const stackArr = Array.isArray(j.tech_stack) ? j.tech_stack : []
  const stack = stackArr.slice(0, 4).join(" · ")
  const overflow = stackArr.length > 4 ? ` +${stackArr.length - 4}` : ""
  return stack ? stack + overflow : ""
}
