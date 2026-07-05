import { mapValid, toISOOrNull } from '../normalize.js';

// Freelancer.com RSS — free, no-auth public feed for remote freelance projects.
const FEED = 'https://www.freelancer.com/rss.xml';

/** Extract the text inside the first <name>…</name> tag in the block (CDATA-aware). */
function tagText(block, name) {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return null;
  let v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) v = cdata[1].trim();
  return v || null;
}

/** Extract ALL <category …><![CDATA[ … ]]></category> values in a block. */
function allCategories(block) {
  const tags = [];
  const re = /<category\b[^>]*>([\s\S]*?)<\/category>/gi;
  let m;
  while ((m = re.exec(block)) !== null) {
    let v = m[1].trim();
    const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
    if (cdata) v = cdata[1].trim();
    if (v) tags.push(v);
  }
  return tags;
}

/**
 * Fetch freelance projects from Freelancer.com's public RSS feed (free, no auth).
 * All items are treated as remote + global (they are open freelance bids worldwide).
 * Tolerates non-ok / throw / parse failure by returning [].
 */
export async function fetchFreelancer(_profile, fetchImpl = fetch) {
  let xml;
  try {
    const res = await fetchImpl(FEED, { headers: { 'User-Agent': 'job-radar/0.1' } });
    if (!res.ok) return [];
    xml = await res.text();
  } catch {
    return [];
  }

  const items = [];
  const re = /<item\b[\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[0];
    items.push({
      title: tagText(b, 'title'),
      link: tagText(b, 'link'),
      guid: tagText(b, 'guid'),
      pubDate: tagText(b, 'pubDate'),
      description: tagText(b, 'description'),
      categories: allCategories(b),
    });
  }

  return mapValid(items, (r) => ({
    source: 'freelancer',
    externalId: r.guid ?? null,
    title: r.title,
    company: null,
    location: 'Remote',
    remote: true,
    url: r.link,
    description: r.description ?? null,
    tags: r.categories,
    market: 'global',
    postedAt: toISOOrNull(r.pubDate),
  }));
}
