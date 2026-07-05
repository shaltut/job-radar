import { mapValid, stripHtml, toISOOrNull } from '../normalize.js';

// WeWorkRemotely is free + no-auth but exposes only an RSS/XML feed — its .json job
// routes deliberately return 406 (anti-scraping) and /api is the employer/partner API.
// So we parse the RSS. No XML dependency (job-radar stays pg-only): a minimal,
// item-scoped tag extractor that handles CDATA + the basic XML entities.
const FEED = 'https://weworkremotely.com/remote-jobs.rss';

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'").replace(/&apos;/g, "'").replace(/&#0*38;/g, '&').replace(/&amp;/g, '&');
}

/** Extract the text of the first <name>…</name> inside an item block (CDATA-aware). */
function tagText(block, name) {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return null;
  let v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) v = cdata[1].trim();
  return v ? decodeEntities(v) : null;
}

/** Parse <item> blocks from an RSS string into plain field objects. Never throws. */
export function parseRssItems(xml) {
  if (typeof xml !== 'string') return [];
  const items = [];
  const re = /<item\b[\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[0];
    items.push({
      title: tagText(b, 'title'),
      link: tagText(b, 'link'),
      guid: tagText(b, 'guid'),
      region: tagText(b, 'region'),
      skills: tagText(b, 'skills'),
      category: tagText(b, 'category'),
      description: tagText(b, 'description'),
      pubDate: tagText(b, 'pubDate'),
    });
  }
  return items;
}

/** WWR <title> is "Company: Role". Split on the first ": " (company optional). */
function splitTitle(raw) {
  const t = (stripHtml(raw) || '').trim();
  const i = t.indexOf(': ');
  return i > 0 ? { company: t.slice(0, i).trim(), title: t.slice(i + 2).trim() } : { company: null, title: t };
}

/** Comma-separated skills → tags (strips the Oxford "and", caps at 20). */
function skillsToTags(skills, category) {
  if (skills) {
    const tags = skills.split(',').map((s) => s.replace(/^\s*and\s+/i, '').trim()).filter(Boolean).slice(0, 20);
    if (tags.length) return tags;
  }
  return category ? [category] : [];
}

/**
 * Fetch remote jobs from WeWorkRemotely's public RSS (free, no auth). All WWR jobs
 * are remote (market 'global'). Tolerates non-ok / throw / unparseable by returning [].
 */
export async function fetchWeWorkRemotely(profile, fetchImpl = fetch) {
  let xml;
  try {
    const res = await fetchImpl(FEED, { headers: { 'User-Agent': 'job-radar/0.1 (+https://github.com/job-radar)' } });
    if (!res.ok) return [];
    xml = await res.text();
  } catch {
    return [];
  }
  const items = parseRssItems(xml);
  return mapValid(items, (r) => {
    const { company, title } = splitTitle(r.title);
    const url = r.link || r.guid;
    return {
      source: 'weworkremotely',
      externalId: r.guid || r.link || null,
      title,
      company,
      location: r.region || 'Remote',
      remote: true,
      url,
      description: stripHtml(r.description),
      tags: skillsToTags(r.skills, r.category),
      market: 'global',
      postedAt: toISOOrNull(r.pubDate),
    };
  });
}
