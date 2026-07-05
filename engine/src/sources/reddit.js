import { mapValid, stripHtml, toISOOrNull } from '../normalize.js';

// Reddit app-only OAuth — needed to reach oauth.reddit.com from datacenter IPs.
const UA = 'job-radar/0.1 (job board reader)';
const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';

/**
 * Fetch hiring posts from Reddit (default: r/forhire).
 * Subreddits from JOBRADAR_REDDIT_SUBS env var (comma-separated, default 'forhire').
 * Only includes [Hiring] posts (excludes [For Hire] — those are workers, not employers).
 * Requires REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET env vars; returns [] if missing.
 * Tolerates per-subreddit failures; overall never throws.
 */
export async function fetchReddit(profile, fetchImpl = fetch) {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;

  // Graceful no-op when credentials are absent.
  if (!clientId || !clientSecret) return [];

  const subs = (process.env.JOBRADAR_REDDIT_SUBS || 'forhire')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // --- Step 1: get an app-only token ---
  let token;
  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
      },
      body: 'grant_type=client_credentials',
    });
    if (!tokenRes.ok) return [];
    const tokenData = await tokenRes.json();
    token = tokenData.access_token;
    if (!token) return [];
  } catch {
    return [];
  }

  // --- Step 2: fetch each subreddit via oauth.reddit.com ---
  const all = [];

  for (const sub of subs) {
    try {
      const url = `https://oauth.reddit.com/r/${sub}/new?limit=100`;
      const res = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': UA,
        },
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data || !data.data || !Array.isArray(data.data.children)) continue;

      const jobs = mapValid(data.data.children, ({ data: post }) => {
        const title = post.title || '';
        const flair = typeof post.link_flair_text === 'string' ? post.link_flair_text : '';

        // Keep only hiring posts (not [For Hire] / 'For Hire' flair).
        const isHiringFlair = flair.toLowerCase() === 'hiring';
        const isHiringTag = /\[hiring\]/i.test(title);
        if (!isHiringFlair && !isHiringTag) {
          throw new Error('canonical job missing required field: title'); // skipped via mapValid
        }

        // Strip leading [Hiring] / [HIRING] tag from title.
        const cleanTitle = title.replace(/^\[hiring\]\s*/i, '').trim();
        if (!cleanTitle) throw new Error('canonical job missing required field: title');

        const selftext = post.selftext || '';
        const description = stripHtml(selftext);
        const permalink = post.permalink || '';
        const jobUrl = `https://www.reddit.com${permalink}`;

        return {
          source: 'reddit',
          externalId: post.id,
          title: cleanTitle,
          company: null,
          location: null,
          remote: /\bremote\b/i.test(title + ' ' + selftext),
          url: jobUrl,
          description,
          tags: [],
          market: 'global',
          postedAt: toISOOrNull(post.created_utc != null ? post.created_utc * 1000 : null),
        };
      });

      all.push(...jobs);
    } catch {
      // Per-subreddit failure → contribute [] and continue.
    }
  }

  return all;
}
