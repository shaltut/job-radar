import { mapValid, stripHtml, toISOOrNull } from '../normalize.js';

const BASE = 'https://jobicy.com/api/v2/remote-jobs';

// Default geos to loop over for a daily radar. Jobicy serves one feed per geo; one daily
// cycle respects their ~1/hr-per-feed politeness. Industry/tag bias the results to dev/backend.
const DEFAULT_GEOS = ['usa', 'canada', 'europe'];
const DEFAULT_INDUSTRY = 'dev';
const DEFAULT_TAG = 'backend';

/**
 * Fetch remote jobs from Jobicy (free, no auth). Loops over geo(s) and industry/industries,
 * concatenating the mapped rows. Tolerates non-ok / throw / bad-json per feed by
 * skipping that feed (returns whatever the other feeds yielded).
 *
 * config:
 *   tag      — keyword (string); overrides DEFAULT_TAG when set.
 *   geo      — one or more geo slugs (string | string[]); overrides DEFAULT_GEOS when set;
 *              multi-value → one API call per value.
 *   industry — one or more industry slugs (string | string[]); overrides DEFAULT_INDUSTRY;
 *              multi-value → one API call per value (combined with each geo).
 *
 * Documented shape: GET .../remote-jobs?count=50&geo=usa&industry=dev&tag=backend
 *   → { jobCount, jobs: [{ id, jobTitle, companyName, jobGeo, url, jobDescription,
 *        jobIndustry, jobLevel, pubDate }, ...], success }.
 */
export async function fetchJobicy(profile, fetchImpl = fetch, config = {}) {
  // Resolve tag
  const tag = (config.tag && typeof config.tag === 'string') ? config.tag : DEFAULT_TAG;

  // Resolve geos: config.geo overrides DEFAULT_GEOS when present
  const geos = (() => {
    if (Array.isArray(config.geo) && config.geo.length > 0) return config.geo;
    if (config.geo && typeof config.geo === 'string') return [config.geo];
    return DEFAULT_GEOS;
  })();

  // Resolve industries: config.industry overrides DEFAULT_INDUSTRY when present
  const industries = (() => {
    if (Array.isArray(config.industry) && config.industry.length > 0) return config.industry;
    if (config.industry && typeof config.industry === 'string') return [config.industry];
    return [DEFAULT_INDUSTRY];
  })();

  const out = [];
  // One API call per (geo × industry) combination
  for (const geo of geos) {
    for (const industry of industries) {
      const url = `${BASE}?count=50&geo=${encodeURIComponent(geo)}&industry=${encodeURIComponent(industry)}&tag=${encodeURIComponent(tag)}`;
      let data;
      try {
        const res = await fetchImpl(url, { headers: { 'User-Agent': 'job-radar/0.1 (+https://github.com/job-radar)' } });
        if (!res.ok) continue;
        data = await res.json();
      } catch {
        continue;
      }
      const rows = data && Array.isArray(data.jobs) ? data.jobs : [];
      out.push(...mapValid(rows, (r) => ({
        source: 'jobicy',
        externalId: r.id != null ? String(r.id) : null,
        title: r.jobTitle,
        company: r.companyName ?? null,
        location: r.jobGeo ?? null,
        remote: true,
        url: r.url,
        description: stripHtml(r.jobDescription),
        tags: r.jobIndustry != null ? [r.jobIndustry] : [],
        market: 'global',
        postedAt: toISOOrNull(r.pubDate),
      })));
    }
  }
  return out;
}
