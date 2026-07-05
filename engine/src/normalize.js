const MARKETS = new Set(['global', 'mena']);

/** Validate + fill defaults for a CanonicalJob. Throws on missing/invalid required fields. */
export function validateCanonical(job) {
  for (const f of ['source', 'title', 'url']) {
    if (!job[f] || String(job[f]).trim() === '') throw new Error(`canonical job missing required field: ${f}`);
  }
  if (!MARKETS.has(job.market)) throw new Error(`canonical job has invalid market: ${job.market}`);
  return {
    source: job.source,
    externalId: job.externalId ?? null,
    title: job.title,
    company: job.company ?? null,
    location: job.location ?? null,
    remote: job.remote ?? null,
    url: job.url,
    description: job.description ?? null,
    tags: Array.isArray(job.tags) ? job.tags : [],
    market: job.market,
    postedAt: job.postedAt ?? null,
  };
}

/** Strip HTML tags and decode a few common entities. Returns null for null input. */
export function stripHtml(s) {
  if (s == null) return null;
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Map raw source rows to CanonicalJobs, skipping (not throwing on) any row that fails validation. */
export function mapValid(rows, mapFn) {
  const out = [];
  for (const r of rows) {
    try {
      out.push(validateCanonical(mapFn(r)));
    } catch (e) {
      // Only swallow validation failures (dirty data). Re-throw real bugs (TypeError, etc.).
      if (!(e instanceof Error) || !e.message.startsWith('canonical job')) throw e;
    }
  }
  return out;
}

/** Parse a date-ish value to an ISO string, or null if absent/invalid (never throws). */
export function toISOOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Parse a DAY/MONTH/YEAR date (optionally with HH:MM:SS), e.g. Wuzzuf's "09/10/2025 15:18:30",
 * to an ISO string. JS `new Date()` would read DD/MM as US MM/DD and swap the day/month, so we
 * parse the parts explicitly. Falls back to toISOOrNull for any non-DD/MM/YYYY input.
 */
export function dmyToISO(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/.exec(String(s ?? ''));
  if (!m) return toISOOrNull(s);
  const [, dd, mm, yyyy, h = '00', min = '00', sec = '00'] = m;
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +h, +min, +sec));
  // Reject silent rollover (e.g. 32/01 → Feb 1, month 13 → next year): require components to round-trip.
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== +yyyy || d.getUTCMonth() !== +mm - 1 || d.getUTCDate() !== +dd ||
    d.getUTCHours() !== +h || d.getUTCMinutes() !== +min || d.getUTCSeconds() !== +sec
  ) return null;
  return d.toISOString();
}

/**
 * Convert a relative time string ("3 days ago", "12 minutes ago", "just now") to an ISO date,
 * measured back from baseISO (e.g. the scrape time). Returns null if unparseable.
 */
export function relativeToISO(relative, baseISO) {
  if (!relative || typeof relative !== 'string') return null;
  const base = baseISO ? new Date(baseISO) : null;
  if (!base || Number.isNaN(base.getTime())) return null;
  const r = relative.trim().toLowerCase();
  const ms = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };
  if (/just now|moments? ago|^today/.test(r)) return base.toISOString();
  if (/^yesterday/.test(r)) return new Date(base.getTime() - ms.day).toISOString();
  // "a day ago" / "an hour ago"
  let m = r.match(/^an?\s+(minute|hour|day|week|month|year)\s+ago/);
  if (m) return new Date(base.getTime() - ms[m[1]]).toISOString();
  // "12 minutes ago", "30+ days ago"
  m = r.match(/(\d+)\+?\s*(minute|hour|day|week|month|year)s?\s*ago/);
  if (m) return new Date(base.getTime() - parseInt(m[1], 10) * ms[m[2]]).toISOString();
  return null;
}
