/** Deterministic quality gate — cheap pre-filter applied before insert/scoring. */

const RED_FLAG_TERMS = [
  'unpaid',
  'equity only',
  'equity-only',
  '100% commission',
  'commission only',
  'commission-only',
  'no salary',
  'volunteer',
  'pay to apply',
  'pay-to-apply',
  'registration fee',
  'training fee',
  'mlm',
];

/**
 * @param {object} job - CanonicalJob
 * @param {object} [opts]
 * @param {number} [opts.maxAgeDays]  - positive number to enable staleness check
 * @param {number} [opts.nowMs]       - override for Date.now() (for testing)
 * @returns {{ ok: boolean, reason: string | null }}
 */
export function checkQuality(job, opts = {}) {
  const { maxAgeDays, nowMs = Date.now() } = opts;

  // Rule 1: Empty/unjudgeable
  const hasTitle = job.title != null && String(job.title).trim().length > 0;
  if (!hasTitle) return { ok: false, reason: 'empty' };

  const hasDescription = job.description != null && String(job.description).trim().length > 0;
  const hasTags = Array.isArray(job.tags) && job.tags.length > 0;
  if (!hasDescription && !hasTags) return { ok: false, reason: 'empty' };

  // Rule 2: Red-flag terms
  const haystack = `${job.title ?? ''} ${job.description ?? ''}`.toLowerCase();
  for (const term of RED_FLAG_TERMS) {
    if (haystack.includes(term)) {
      return { ok: false, reason: `red-flag: ${term}` };
    }
  }

  // Rule 3: Stale (OFF unless maxAgeDays is a positive number)
  if (typeof maxAgeDays === 'number' && maxAgeDays > 0 && job.postedAt != null) {
    const postedMs = job.postedAt instanceof Date
      ? job.postedAt.getTime()
      : new Date(job.postedAt).getTime();
    if (Number.isFinite(postedMs) && nowMs - postedMs > maxAgeDays * 24 * 60 * 60 * 1000) {
      return { ok: false, reason: 'stale' };
    }
  }

  return { ok: true, reason: null };
}
