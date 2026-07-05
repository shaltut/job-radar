import { norm } from './norm.js';

/**
 * True if a job matches the profile:
 *  - has >=1 includeKeywords term (role focus),
 *  - has >=1 requireKeywords term when that list is non-empty (e.g. seniority — ANDed with include),
 *  - has no excludeKeywords term,
 *  - satisfies remoteOnly.
 */
export function matchesProfile(job, profile) {
  // remote === false is explicit non-remote; null/undefined means unknown, which we allow through
  if (profile.remoteOnly && job.remote === false) return false;
  const haystack = norm([job.title, (job.tags || []).join(' '), job.description].join(' '));
  const inc = (profile.includeKeywords || []).map(norm).filter(Boolean);
  const req = (profile.requireKeywords || []).map(norm).filter(Boolean);
  const exc = (profile.excludeKeywords || []).map(norm).filter(Boolean);
  if (inc.length && !inc.some((k) => haystack.includes(k))) return false;
  if (req.length && !req.some((k) => haystack.includes(k))) return false;
  if (exc.some((k) => haystack.includes(k))) return false;
  return true;
}
