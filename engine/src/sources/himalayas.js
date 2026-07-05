import { mapValid, stripHtml, toISOOrNull } from '../normalize.js';

// Himalayas — free, no-auth public JSON API for remote-worldwide jobs.
const BASE = 'https://himalayas.app/jobs/api';
const PAGE = 20;

/**
 * Fetch remote jobs from Himalayas (free, no auth). All jobs are remote (market 'global').
 * Paginates via offset until JOBRADAR_HIMALAYAS_MAX jobs are fetched (default 200),
 * a page returns fewer than PAGE jobs (last page), or a page fails.
 * Tolerates non-ok / throw / bad-json by returning [] (first page) or partial results (later pages).
 * Shape verified 2026-06-18:
 *   { jobs: [{ title, companyName, locationRestrictions[], applicationLink, guid,
 *              pubDate (unix seconds), description (HTML), categories[], seniority[] }] }.
 */
export async function fetchHimalayas(profile, fetchImpl = fetch) {
  const max = Number(process.env.JOBRADAR_HIMALAYAS_MAX) || 200;
  const maxPages = Math.ceil(max / PAGE);

  const map = (r) => ({
    source: 'himalayas',
    externalId: r.guid ?? null,
    title: r.title,
    company: r.companyName ?? null,
    location: Array.isArray(r.locationRestrictions) && r.locationRestrictions.length ? r.locationRestrictions.join(', ') : 'Remote',
    remote: true,
    url: r.applicationLink || r.guid,
    description: stripHtml(r.description ?? r.excerpt),
    tags: Array.isArray(r.categories) ? r.categories : [],
    market: 'global',
    postedAt: toISOOrNull(typeof r.pubDate === 'number' ? r.pubDate * 1000 : r.pubDate),
  });

  const all = [];

  for (let p = 0; p < maxPages; p++) {
    const offset = p * PAGE;
    const url = `${BASE}?limit=20&offset=${offset}`;
    let data;
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': 'job-radar/0.1 (+https://github.com/job-radar)' } });
      if (!res.ok) {
        if (p === 0) return [];
        break;
      }
      data = await res.json();
    } catch {
      if (p === 0) return [];
      break;
    }
    if (!data || !Array.isArray(data.jobs) || data.jobs.length === 0) break;
    all.push(...mapValid(data.jobs, map));
    if (data.jobs.length < PAGE) break; // last page
  }

  return all;
}
