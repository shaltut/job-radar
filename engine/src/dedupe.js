import { createHash } from 'node:crypto';
import { norm } from './norm.js';

// Standalone boilerplate tokens that decorate a title but don't change the role.
// Matched as whole words only, so "Contractor" or "Hybridize" are never touched.
const BOILERPLATE = [
  'fully remote', 'remote', 'onsite', 'on-site', 'on site', 'hybrid',
  'contract', 'full time', 'full-time', 'part time', 'part-time',
];

/**
 * Derive a "core title" by stripping known posting decorations.
 *
 * Heuristic (deliberately conservative):
 *  1. Lowercase, then cut everything after the FIRST separator among
 *     `|`, `(`, `–`, `—`, and ` - `. These separators reliably introduce
 *     salary/remote/location decorations on job boards, e.g.
 *       "Backend Developer - Fully Remote | Upto $85/hr"  -> "Backend Developer"
 *       "Node.js Software Engineer - Remote"              -> "Node.js Software Engineer"
 *       "Backend Developer (Remote)"                      -> "Backend Developer"
 *  2. Strip salary fragments like "$85/hr" or "$120k" that may appear before
 *     any separator.
 *  3. Remove standalone boilerplate words (remote, hybrid, contract, full/part
 *     time, etc.) as whole words only.
 *  4. Collapse punctuation + whitespace via norm().
 *
 * We never cut on a separator that is part of the real title's meaning beyond
 * the first occurrence, and we only remove a fixed allow-list of decorations,
 * so genuinely different roles ("Backend" vs "Frontend") stay distinct.
 */
function coreTitle(title) {
  let t = String(title ?? '').toLowerCase();
  // 1. Cut at the first decoration separator: " | ", "(", "–", "—", or " - ".
  //    The hyphen variant requires surrounding spaces so hyphenated words
  //    ("on-site", "full-time", "front-end") are not split.
  const cut = t.search(/\s*\||\(|–|—|\s-\s/u);
  if (cut !== -1) t = t.slice(0, cut);
  // 2. Drop salary fragments ($85/hr, $120k, $85.50/hour, etc.).
  t = t.replace(/\$\s*\d[\d.,]*\s*(?:k|\/\s*hr|\/\s*hour|per\s*hour)?/gu, ' ');
  // 3. Remove standalone boilerplate tokens (whole-word match).
  for (const w of BOILERPLATE) {
    t = t.replace(new RegExp(`\\b${w.replace(/[-\s]/g, '[-\\s]')}\\b`, 'gu'), ' ');
  }
  // 4. Final normalization (lowercase/strip punctuation/collapse whitespace).
  return norm(t);
}

/**
 * Stable identity hash for a job, used for ON CONFLICT (dedupe_hash) DO NOTHING.
 *
 * Inputs: coreTitle | company, and — for non-remote roles only — the location.
 * Location is dropped when remote is true so the same remote role reposted with
 * different decorated locations collapses to one hash; it is kept for onsite
 * roles so the same title in different cities stays distinct. The hash algorithm
 * (sha1 hex) is unchanged; only its inputs are smarter.
 *
 * Conservatism: only known decorations after a recognized separator are
 * stripped, and company is always part of the key, so distinct roles or
 * distinct employers never collapse together.
 */
export function dedupeHash(job) {
  const parts = [coreTitle(job.title), norm(job.company)];
  if (!job.remote) parts.push(norm(job.location) || 'onsite');
  const key = parts.join('|');
  return createHash('sha1').update(key).digest('hex');
}
