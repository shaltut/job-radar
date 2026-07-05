import { mapValid, stripHtml, toISOOrNull } from '../normalize.js';

// Daily radar: page 1 only (newest first). The board paginates via links.next, but
// for a once-a-day pull the freshest page is enough.
const URL = 'https://www.arbeitnow.com/api/job-board-api?page=1';

/**
 * Fetch jobs from Arbeitnow (free, no auth). Europe/DE-AT-CH + visa-sponsorship
 * slice of the remote-worldwide market. Tolerates non-ok / throw / bad-json by
 * returning [].
 *
 * Documented shape: GET .../job-board-api?page=1
 *   → { data: [{ slug, title, company_name, location, remote, url, description,
 *        tags, created_at (unix seconds) }, ...], links: { next }, meta }.
 * market stays 'global' (canonical enum is only global|mena).
 */
export async function fetchArbeitnow(_profile, fetchImpl = fetch) {
  let data;
  try {
    const res = await fetchImpl(URL, { headers: { 'User-Agent': 'job-radar/0.1 (+https://github.com/job-radar)' } });
    if (!res.ok) return [];
    data = await res.json();
  } catch {
    return [];
  }
  const rows = data && Array.isArray(data.data) ? data.data : [];
  return mapValid(rows, (r) => ({
    source: 'arbeitnow',
    externalId: r.slug ?? null,
    title: r.title,
    company: r.company_name ?? null,
    location: r.location ?? null,
    remote: !!r.remote,
    url: r.url,
    description: stripHtml(r.description),
    tags: Array.isArray(r.tags) ? r.tags : [],
    market: 'global',
    // created_at is unix seconds → multiply to ms for Date().
    postedAt: r.created_at != null ? toISOOrNull(Number(r.created_at) * 1000) : null,
  }));
}
