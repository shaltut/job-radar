import { mapValid, stripHtml, toISOOrNull } from '../normalize.js';

const BASE = 'https://remotive.com/api/remote-jobs';

/** Fetch remote jobs from Remotive (free, no auth). Uses first include keyword as search term.
 *  config.category: one or more category slugs; if set, issues one request per slug and merges.
 *  If category is unset, fetches without a category filter (today's default).
 */
export async function fetchRemotive(profile, fetchImpl = fetch, config = {}) {
  const term = (profile.includeKeywords && profile.includeKeywords[0]) || 'software';
  const categories = Array.isArray(config.category) && config.category.length > 0
    ? config.category
    : (config.category && typeof config.category === 'string' ? [config.category] : []);

  // Build list of URLs to fetch: one per category slug, or one without category.
  const urls = categories.length > 0
    ? categories.map((cat) => `${BASE}?search=${encodeURIComponent(term)}&limit=50&category=${encodeURIComponent(cat)}`)
    : [`${BASE}?search=${encodeURIComponent(term)}&limit=50`];

  const out = [];
  for (const url of urls) {
    let data;
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': 'job-radar/0.1' } });
      if (!res.ok) continue;
      data = await res.json();
    } catch {
      continue;
    }
    const rows = Array.isArray(data.jobs) ? data.jobs : [];
    out.push(...mapValid(rows, (r) => ({
      source: 'remotive',
      externalId: r.id != null ? String(r.id) : null,
      title: r.title,
      company: r.company_name ?? null,
      location: r.candidate_required_location ?? null,
      remote: true,
      url: r.url,
      description: stripHtml(r.description),
      tags: Array.isArray(r.tags) ? r.tags : [],
      market: 'global',
      postedAt: toISOOrNull(r.publication_date),
    })));
  }
  return out;
}
