import { mapValid, stripHtml, toISOOrNull } from '../normalize.js';

// Hacker News "Who is hiring?" — free, no-auth, Algolia HN Search API.
const ALGOLIA_SEARCH = 'https://hn.algolia.com/api/v1/search_by_date?query=Ask%20HN%3A%20Who%20is%20hiring%3F&tags=story&hitsPerPage=10';
const ALGOLIA_ITEMS = 'https://hn.algolia.com/api/v1/items/';
const UA = 'job-radar/0.1';

/** Extract the first http(s) URL from a string, or null. Trims trailing punctuation. */
function firstUrl(text) {
  const m = /https?:\/\/[^\s"'<>)\]]+/.exec(text);
  if (!m) return null;
  // Strip trailing sentence-ending punctuation (., ;, ,) that was captured.
  return m[0].replace(/[.,;:!?]+$/, '');
}

/**
 * Fetch jobs from the current Hacker News "Ask HN: Who is Hiring?" thread.
 * Tolerates all fetch / parse failures by returning [].
 * Caps results at JOBRADAR_HN_MAX (default 100).
 */
export async function fetchHackerNews(profile, fetchImpl = fetch) {
  const max = Number(process.env.JOBRADAR_HN_MAX) || 100;
  const headers = { 'User-Agent': UA };

  // 1. Find the most recent "who is hiring?" thread.
  let storyId;
  try {
    const res = await fetchImpl(ALGOLIA_SEARCH, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || !Array.isArray(data.hits)) return [];
    // Prefer the canonical author; fall back to first title match.
    const hits = data.hits.filter((h) => h.title && /who is hiring/i.test(h.title));
    if (hits.length === 0) return [];
    const preferred = hits.find((h) => h.author === 'whoishiring') || hits[0];
    storyId = preferred.objectID;
  } catch {
    return [];
  }

  // 2. Fetch the story + top-level comment children.
  let children;
  try {
    const res = await fetchImpl(`${ALGOLIA_ITEMS}${storyId}`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || !Array.isArray(data.children)) return [];
    children = data.children;
  } catch {
    return [];
  }

  // 3. Cap and map.
  const capped = children.slice(0, max);

  return mapValid(capped, (child) => {
    // Skip dead/deleted/blank comments.
    if (child.dead || child.deleted) throw new Error('canonical job missing required field: title');
    const rawText = child.text;
    if (!rawText || String(rawText).trim() === '') throw new Error('canonical job missing required field: title');
    const body = stripHtml(rawText) || '';
    if (body.length < 40) throw new Error('canonical job missing required field: title');

    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    const firstLine = lines[0] || '';
    if (!firstLine) throw new Error('canonical job missing required field: title');

    const title = firstLine.slice(0, 140);
    const pipeIdx = firstLine.indexOf('|');
    const company = pipeIdx !== -1 ? firstLine.slice(0, pipeIdx).trim() || null : null;

    // Prefer a URL found in the body text; fall back to HN permalink.
    const url = firstUrl(body) || `https://news.ycombinator.com/item?id=${child.id}`;

    return {
      source: 'hackernews',
      externalId: String(child.id),
      title,
      company,
      location: null,
      remote: /\bremote\b/i.test(body),
      url,
      description: body,
      tags: [],
      market: 'global',
      postedAt: toISOOrNull(child.created_at),
    };
  });
}
