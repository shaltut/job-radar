import { mapValid, stripHtml, toISOOrNull } from '../normalize.js';

const REMOTEOK_URL = 'https://remoteok.com/api';

/** Fetch jobs from RemoteOK (free, no auth). First array element is legal metadata — skip it. */
export async function fetchRemoteOk(_profile, fetchImpl = fetch) {
  let data;
  try {
    const res = await fetchImpl(REMOTEOK_URL, { headers: { 'User-Agent': 'job-radar/0.1' } });
    if (!res.ok) return [];
    data = await res.json();
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const rows = data.filter((r) => r && r.id && (r.position || r.title));
  return mapValid(rows, (r) => ({
    source: 'remoteok',
    externalId: r.id != null ? String(r.id) : null,
    title: r.position || r.title,
    company: r.company ?? null,
    location: r.location || 'Remote',
    remote: true,
    url: r.url || (r.slug ? `https://remoteok.com/remote-jobs/${r.slug}` : `https://remoteok.com/l/${r.id}`),
    description: stripHtml(r.description),
    tags: Array.isArray(r.tags) ? r.tags : [],
    market: 'global',
    postedAt: toISOOrNull(r.date),
  }));
}
