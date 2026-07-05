import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchHackerNews } from '../src/sources/hackernews.js';

// ---------------------------------------------------------------------------
// Fake payloads
// ---------------------------------------------------------------------------

const SEARCH_HITS = {
  hits: [
    {
      objectID: '9999',
      title: 'Ask HN: Who is hiring? (June 2026)',
      author: 'whoishiring',
      created_at: '2026-06-01T10:00:00.000Z',
    },
    {
      objectID: '8888',
      title: 'Ask HN: Who wants to be hired? (June 2026)',
      author: 'whoishiring',
      created_at: '2026-06-01T09:00:00.000Z',
    },
  ],
};

// A story with three top-level comment children:
//   child 1001 — remote job with a URL in body
//   child 1002 — non-remote job, no URL in body (→ HN permalink)
//   child 1003 — dead comment (should be skipped)
//   child 1004 — deleted comment (should be skipped)
//   child 1005 — blank text (should be skipped)
//   child 1006 — text too short (< 40 chars stripped)
const STORY_ITEMS = {
  id: 9999,
  title: 'Ask HN: Who is hiring? (June 2026)',
  children: [
    {
      id: 1001,
      created_at: '2026-06-01T11:00:00.000Z',
      text: '<p>Acme Corp | Senior Backend Engineer | Remote | $150k<br>We build distributed systems. Apply at https://jobs.acme.io/senior-backend. Great team, great mission.</p>',
    },
    {
      id: 1002,
      created_at: '2026-06-01T12:00:00.000Z',
      text: '<p>BetaCo | QA Lead | New York | Onsite only<br>Looking for a quality-focused engineer to own our testing pipeline. Email hr@betaco.example.com.</p>',
    },
    { id: 1003, dead: true, text: '<p>dead comment</p>' },
    { id: 1004, deleted: true, text: '<p>deleted comment</p>' },
    { id: 1005, text: '' },
    { id: 1006, text: '<p>Too short</p>' },
  ],
};

// ---------------------------------------------------------------------------
// Fake fetchImpl that routes by URL pattern
// ---------------------------------------------------------------------------

function makeFetch({ searchPayload = SEARCH_HITS, storyPayload = STORY_ITEMS, failSearch = false, failStory = false } = {}) {
  return async (url) => {
    if (/search_by_date/.test(url)) {
      if (failSearch) throw new Error('network error');
      return { ok: true, json: async () => searchPayload };
    }
    if (/items\//.test(url)) {
      if (failStory) throw new Error('network error');
      return { ok: true, json: async () => storyPayload };
    }
    throw new Error(`unexpected URL: ${url}`);
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('fetchHackerNews picks the who-is-hiring thread by author + title', async () => {
  let itemsUrl;
  const fetchImpl = async (url) => {
    if (/search_by_date/.test(url)) return { ok: true, json: async () => SEARCH_HITS };
    itemsUrl = url;
    return { ok: true, json: async () => STORY_ITEMS };
  };
  await fetchHackerNews({}, fetchImpl);
  // Should have used storyId 9999 (the who-is-hiring hit)
  assert.ok(itemsUrl.includes('9999'), `expected items URL to contain 9999, got ${itemsUrl}`);
});

test('fetchHackerNews maps valid comments to CanonicalJob[]', async () => {
  const jobs = await fetchHackerNews({}, makeFetch());
  // 6 children: 2 valid, dead/deleted/blank/too-short skipped
  assert.equal(jobs.length, 2);

  const j0 = jobs[0];
  assert.equal(j0.source, 'hackernews');
  assert.equal(j0.externalId, '1001');
  assert.equal(j0.market, 'global');
  assert.equal(j0.company, 'Acme Corp');
  assert.ok(j0.title.startsWith('Acme Corp'), `title should start with company name, got: ${j0.title}`);
  assert.ok(j0.title.length <= 140);
  assert.equal(j0.remote, true);
  assert.equal(j0.postedAt, new Date('2026-06-01T11:00:00.000Z').toISOString());
  assert.deepEqual(j0.tags, []);
});

test('fetchHackerNews uses the in-body URL when present', async () => {
  const jobs = await fetchHackerNews({}, makeFetch());
  const j0 = jobs[0]; // child 1001 has https://jobs.acme.io/senior-backend
  assert.equal(j0.url, 'https://jobs.acme.io/senior-backend');
});

test('fetchHackerNews falls back to HN permalink when no URL in body', async () => {
  const jobs = await fetchHackerNews({}, makeFetch());
  const j1 = jobs[1]; // child 1002 has no http URL
  assert.equal(j1.url, 'https://news.ycombinator.com/item?id=1002');
});

test('fetchHackerNews sets remote=true when body contains "remote"', async () => {
  const jobs = await fetchHackerNews({}, makeFetch());
  assert.equal(jobs[0].remote, true);   // child 1001: "Remote"
  assert.equal(jobs[1].remote, false);  // child 1002: "Onsite only"
});

test('fetchHackerNews skips dead/deleted/blank/too-short comments', async () => {
  const jobs = await fetchHackerNews({}, makeFetch());
  const ids = jobs.map((j) => j.externalId);
  assert.ok(!ids.includes('1003'), 'dead comment should be skipped');
  assert.ok(!ids.includes('1004'), 'deleted comment should be skipped');
  assert.ok(!ids.includes('1005'), 'blank text should be skipped');
  assert.ok(!ids.includes('1006'), 'too-short text should be skipped');
});

test('fetchHackerNews returns [] when search fetch fails', async () => {
  const jobs = await fetchHackerNews({}, makeFetch({ failSearch: true }));
  assert.deepEqual(jobs, []);
});

test('fetchHackerNews returns [] when search returns non-ok', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  assert.deepEqual(await fetchHackerNews({}, fetchImpl), []);
});

test('fetchHackerNews returns [] when story fetch fails', async () => {
  const jobs = await fetchHackerNews({}, makeFetch({ failStory: true }));
  assert.deepEqual(jobs, []);
});

test('fetchHackerNews returns [] when no matching thread found in hits', async () => {
  const emptyHits = { hits: [{ objectID: '777', title: 'Ask HN: Who wants to be hired?', author: 'user1', created_at: '2026-06-01T10:00:00.000Z' }] };
  const jobs = await fetchHackerNews({}, makeFetch({ searchPayload: emptyHits }));
  assert.deepEqual(jobs, []);
});

test('fetchHackerNews respects JOBRADAR_HN_MAX cap', async () => {
  // Story with 5 valid children; cap to 3
  const story = {
    id: 9999,
    children: Array.from({ length: 5 }, (_, i) => ({
      id: 2000 + i,
      created_at: '2026-06-01T10:00:00.000Z',
      text: `<p>Company ${i} | Role ${i} | Remote<br>A long enough description for this job posting entry here.</p>`,
    })),
  };
  const saved = process.env.JOBRADAR_HN_MAX;
  process.env.JOBRADAR_HN_MAX = '3';
  const jobs = await fetchHackerNews({}, makeFetch({ storyPayload: story }));
  process.env.JOBRADAR_HN_MAX = saved;
  assert.equal(jobs.length, 3);
});

test('fetchHackerNews sends User-Agent header', async () => {
  const headers = [];
  const fetchImpl = async (url, opts) => {
    headers.push(opts?.headers?.['User-Agent']);
    if (/search_by_date/.test(url)) return { ok: true, json: async () => SEARCH_HITS };
    return { ok: true, json: async () => STORY_ITEMS };
  };
  await fetchHackerNews({}, fetchImpl);
  assert.ok(headers.every((h) => typeof h === 'string' && h.startsWith('job-radar/')), `unexpected User-Agent: ${headers}`);
});
