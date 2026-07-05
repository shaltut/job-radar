import { mapValid, stripHtml, toISOOrNull } from '../normalize.js';

// Careerjet's public API is HTTP-only (the https endpoint times out) and rejects
// calls without a Referer header ("Undeclared referrer"). Both are handled below.
const BASE = 'http://public.api.careerjet.net/search';

/**
 * Careerjet public search API locale per GCC country key (MENA_COUNTRIES.key).
 * Used as the `locale_code` query param; the human-readable `location` comes from
 * MENA_COUNTRIES[].loc and is passed in by the caller.
 */
export const CAREERJET_LOCALES = {
  uae: 'en_AE',
  ksa: 'en_SA',
  qatar: 'en_QA',
  kuwait: 'en_KW',
  bahrain: 'en_BH',
  oman: 'en_OM',
};

/**
 * Fetch jobs from the Careerjet public search API (free; needs only an affiliate id).
 * One call per GCC country (locale_code + location supplied by the caller). Tolerates
 * non-ok / throw / bad-json by returning [] (fault-tolerant like jobicy.js).
 *
 * REQUIRED params: affid, user_ip, user_agent (the API rejects calls missing user_ip /
 * user_agent). user_ip/user_agent are hardcoded.
 *
 * config keys (all optional): keywords, contract_type, work_hours, sort, radius.
 *   NOTE: locale_code and location are always set by the caller and are NOT overridden
 *   by config, regardless of what config contains.
 *
 * Documented shape (field names UNVERIFIED — mapped defensively):
 *   GET .../search?affid=<AFFID>&keywords=<kw>&location=<loc>&locale_code=<LOCALE>
 *       &pagesize=50&page=1&sort=date&user_ip=127.0.0.1&user_agent=job-radar/0.1
 *   → { type, jobs: [{ title, description, company, locations, salary, url, date }], hits, pages }.
 */
export async function fetchCareerjet(profile, fetchImpl = fetch, { affid, localeCode, location } = {}, config = {}) {
  const term = (profile && profile.includeKeywords && profile.includeKeywords[0]) || 'software';
  const params = new URLSearchParams({
    affid: affid || '',
    keywords: term,
    location: location || 'Gulf',
    locale_code: localeCode || 'en_AE',
    pagesize: '50',
    page: '1',
    sort: 'date',
    user_ip: process.env.CAREERJET_USER_IP || '127.0.0.1',
    user_agent: 'job-radar/0.1',
  });

  // Spread config filter keys into params; locale_code and location are protected.
  const PROTECTED = new Set(['locale_code', 'location', 'affid', 'user_ip', 'user_agent']);
  for (const [k, v] of Object.entries(config || {})) {
    if (PROTECTED.has(k)) continue;
    if (v == null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length > 0) params.set(k, v[0]); // multiselect → use first value
    } else {
      params.set(k, String(v));
    }
  }

  const url = `${BASE}?${params.toString()}`;
  let data;
  try {
    const res = await fetchImpl(url, {
      headers: {
        'User-Agent': 'job-radar/0.1',
        // Careerjet returns 403 "Undeclared referrer" without this.
        Referer: process.env.CAREERJET_REFERER || 'https://example.com/jobs',
      },
    });
    if (!res.ok) return [];
    data = await res.json();
  } catch {
    return [];
  }
  const rows = data && Array.isArray(data.jobs) ? data.jobs : [];
  return mapValid(rows, (r) => ({
    source: 'careerjet',
    externalId: null,
    title: r.title,
    company: r.company ?? null,
    location: r.locations || location || 'Gulf',
    remote: false,
    url: r.url,
    description: stripHtml(r.description),
    tags: [],
    market: 'mena',
    postedAt: toISOOrNull(r.date),
  }));
}
