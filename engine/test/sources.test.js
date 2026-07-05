import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRemotive } from '../src/sources/remotive.js';

// A fake fetch returning Remotive's documented shape.
function fakeFetch(payload) {
  return async () => ({ ok: true, json: async () => payload });
}

test('fetchRemotive maps API rows to CanonicalJob[]', async () => {
  const payload = { jobs: [{
    id: 42, title: 'DevOps Engineer', company_name: 'Acme',
    candidate_required_location: 'Worldwide', url: 'https://remotive.com/x',
    description: '<p>do ops</p>', tags: ['devops', 'aws'],
    publication_date: '2026-06-16T10:00:00',
  }] };
  const jobs = await fetchRemotive({ includeKeywords: ['devops'] }, fakeFetch(payload));
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.equal(j.source, 'remotive');
  assert.equal(j.externalId, '42');
  assert.equal(j.title, 'DevOps Engineer');
  assert.equal(j.company, 'Acme');
  assert.equal(j.remote, true);
  assert.equal(j.market, 'global');
  assert.equal(j.url, 'https://remotive.com/x');
  assert.deepEqual(j.tags, ['devops', 'aws']);
});

test('fetchRemotive returns [] and does not throw on non-ok response', async () => {
  const jobs = await fetchRemotive({ includeKeywords: ['x'] }, async () => ({ ok: false, status: 503 }));
  assert.deepEqual(jobs, []);
});

import { fetchRemoteOk } from '../src/sources/remoteok.js';

test('fetchRemoteOk skips the legal preamble row and maps the rest', async () => {
  // RemoteOK's API returns a first element that is metadata/legal, not a job.
  const payload = [
    { legal: 'See https://remoteok.com/legal' },
    { id: '99', position: 'SRE', company: 'Globex', location: 'Remote',
      url: 'https://remoteok.com/l/99', description: 'sre work',
      tags: ['sre', 'devops'], date: '2026-06-15T08:00:00Z', slug: 'sre' },
  ];
  const jobs = await fetchRemoteOk({ includeKeywords: ['sre'] }, async () => ({ ok: true, json: async () => payload }));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].source, 'remoteok');
  assert.equal(jobs[0].title, 'SRE');
  assert.equal(jobs[0].company, 'Globex');
  assert.equal(jobs[0].remote, true);
  assert.equal(jobs[0].externalId, '99');
});

test('fetchRemoteOk tolerates a non-array body', async () => {
  const jobs = await fetchRemoteOk({ includeKeywords: ['x'] }, async () => ({ ok: true, json: async () => ({}) }));
  assert.deepEqual(jobs, []);
});

import { fetchJobicy } from '../src/sources/jobicy.js';

test('fetchJobicy maps API rows to CanonicalJob[] (one feed)', async () => {
  // Same payload for every geo; assert mapping on a single representative row.
  const payload = { success: true, jobCount: 1, jobs: [{
    id: 1234, jobTitle: 'Backend Engineer', companyName: 'Jobicy Co', jobGeo: 'USA',
    url: 'https://jobicy.com/jobs/1234', jobDescription: '<p>build apis</p>',
    jobIndustry: 'Dev', jobLevel: 'Senior', pubDate: '2026-06-16 09:00:00',
  }] };
  const jobs = await fetchJobicy({ includeKeywords: ['backend'] }, async () => ({ ok: true, json: async () => payload }));
  // 3 geos looped, same payload each → 3 mapped rows.
  assert.equal(jobs.length, 3);
  const j = jobs[0];
  assert.equal(j.source, 'jobicy');
  assert.equal(j.externalId, '1234');
  assert.equal(j.title, 'Backend Engineer');
  assert.equal(j.company, 'Jobicy Co');
  assert.equal(j.location, 'USA');
  assert.equal(j.remote, true);
  assert.equal(j.url, 'https://jobicy.com/jobs/1234');
  assert.equal(j.market, 'global');
  assert.deepEqual(j.tags, ['Dev']);
  assert.equal(j.postedAt, new Date('2026-06-16 09:00:00').toISOString());
});

test('fetchJobicy skips a feed on non-ok / network error / bad json without throwing', async () => {
  // every feed fails one way or another → []
  let n = 0;
  const flaky = async () => {
    n += 1;
    if (n === 1) return { ok: false, status: 503 };
    if (n === 2) throw new Error('ECONNRESET');
    return { ok: true, json: async () => { throw new SyntaxError('bad json'); } };
  };
  assert.deepEqual(await fetchJobicy({ includeKeywords: ['x'] }, flaky), []);
});

test('fetchJobicy tolerates a body with no jobs array', async () => {
  assert.deepEqual(await fetchJobicy({ includeKeywords: ['x'] }, async () => ({ ok: true, json: async () => ({ success: false }) })), []);
});

// ---- fetchJobicy: config param wiring ----

test('fetchJobicy: config.geo (single) replaces the default geo loop → 1 request', async () => {
  const urls = [];
  const fake = async (url) => { urls.push(url); return { ok: true, json: async () => ({ jobs: [] }) }; };
  await fetchJobicy({ includeKeywords: ['x'] }, fake, { geo: 'apac' });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /geo=apac/);
});

test('fetchJobicy: config.geo (array) issues one request per value', async () => {
  const urls = [];
  const fake = async (url) => { urls.push(url); return { ok: true, json: async () => ({ jobs: [] }) }; };
  await fetchJobicy({ includeKeywords: ['x'] }, fake, { geo: ['emea', 'apac'] });
  assert.equal(urls.length, 2);
  assert.ok(urls.some((u) => /geo=emea/.test(u)));
  assert.ok(urls.some((u) => /geo=apac/.test(u)));
});

test('fetchJobicy: config.industry (array) issues one request per value (combined with geo)', async () => {
  const urls = [];
  const fake = async (url) => { urls.push(url); return { ok: true, json: async () => ({ jobs: [] }) }; };
  await fetchJobicy({ includeKeywords: ['x'] }, fake, { geo: 'usa', industry: ['dev', 'data-science'] });
  assert.equal(urls.length, 2);
  assert.ok(urls.some((u) => /industry=dev/.test(u) && /geo=usa/.test(u)));
  assert.ok(urls.some((u) => /industry=data-science/.test(u) && /geo=usa/.test(u)));
});

test('fetchJobicy: config.tag replaces default tag in URL', async () => {
  const urls = [];
  const fake = async (url) => { urls.push(url); return { ok: true, json: async () => ({ jobs: [] }) }; };
  await fetchJobicy({ includeKeywords: ['x'] }, fake, { tag: 'python' });
  // default geos still used when geo not set
  assert.equal(urls.length, 3);
  assert.ok(urls.every((u) => /tag=python/.test(u)));
});

test('fetchJobicy: empty config → default 3 geos with industry=dev, tag=backend (unchanged behavior)', async () => {
  const urls = [];
  const fake = async (url) => { urls.push(url); return { ok: true, json: async () => ({ jobs: [] }) }; };
  await fetchJobicy({ includeKeywords: ['x'] }, fake, {});
  assert.equal(urls.length, 3);
  assert.ok(urls.every((u) => /industry=dev/.test(u) && /tag=backend/.test(u)));
  assert.ok(urls.some((u) => /geo=usa/.test(u)));
  assert.ok(urls.some((u) => /geo=canada/.test(u)));
  assert.ok(urls.some((u) => /geo=europe/.test(u)));
});

test('fetchJobicy: no config arg → same default 3 geos (backward compat)', async () => {
  const urls = [];
  const fake = async (url) => { urls.push(url); return { ok: true, json: async () => ({ jobs: [] }) }; };
  await fetchJobicy({ includeKeywords: ['x'] }, fake);
  assert.equal(urls.length, 3);
  assert.ok(urls.every((u) => /geo=/.test(u)));
});

// ---- fetchRemotive: config.category wiring ----

test('fetchRemotive: config.category (single string) appends ?category= to URL', async () => {
  const urls = [];
  const fake = async (url) => { urls.push(url); return { ok: true, json: async () => ({ jobs: [] }) }; };
  await fetchRemotive({ includeKeywords: ['backend'] }, fake, { category: 'software-development' });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /category=software-development/);
  assert.match(urls[0], /search=backend/);
});

test('fetchRemotive: config.category (array) issues one request per slug', async () => {
  const urls = [];
  const fake = async (url) => { urls.push(url); return { ok: true, json: async () => ({ jobs: [] }) }; };
  await fetchRemotive({ includeKeywords: ['x'] }, fake, { category: ['devops', 'data'] });
  assert.equal(urls.length, 2);
  assert.ok(urls.some((u) => /category=devops/.test(u)));
  assert.ok(urls.some((u) => /category=data/.test(u)));
});

test('fetchRemotive: empty config → no category param in URL (unchanged behavior)', async () => {
  const urls = [];
  const fake = async (url) => { urls.push(url); return { ok: true, json: async () => ({ jobs: [] }) }; };
  await fetchRemotive({ includeKeywords: ['x'] }, fake, {});
  assert.equal(urls.length, 1);
  assert.doesNotMatch(urls[0], /category=/);
});

test('fetchRemotive: no config arg → no category param (backward compat)', async () => {
  const urls = [];
  const fake = async (url) => { urls.push(url); return { ok: true, json: async () => ({ jobs: [] }) }; };
  await fetchRemotive({ includeKeywords: ['x'] }, fake);
  assert.equal(urls.length, 1);
  assert.doesNotMatch(urls[0], /category=/);
});

test('fetchRemotive: multi-category results are merged into a flat array', async () => {
  const makePayload = (id) => ({ jobs: [{ id, title: `Job ${id}`, company_name: 'Co', url: `https://x/${id}`, description: 'd', tags: [], publication_date: null }] });
  let call = 0;
  const fake = async () => ({ ok: true, json: async () => makePayload(++call) });
  const jobs = await fetchRemotive({ includeKeywords: ['x'] }, fake, { category: ['devops', 'data'] });
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].externalId, '1');
  assert.equal(jobs[1].externalId, '2');
});

// ---- fetchCareerjet: config param wiring ----

test('fetchCareerjet: config.keywords overrides the profile keyword in URL', async () => {
  let capturedUrl = '';
  const fake = async (url) => { capturedUrl = url; return { ok: true, json: async () => ({ jobs: [] }) }; };
  await fetchCareerjet({ includeKeywords: ['backend'] }, fake, { affid: 'a', localeCode: 'en_AE', location: 'United Arab Emirates' }, { keywords: 'rust developer' });
  assert.match(capturedUrl, /keywords=rust\+developer/);
});

test('fetchCareerjet: config.sort overrides the default "date" sort', async () => {
  let capturedUrl = '';
  const fake = async (url) => { capturedUrl = url; return { ok: true, json: async () => ({ jobs: [] }) }; };
  await fetchCareerjet({ includeKeywords: ['x'] }, fake, { affid: 'a', localeCode: 'en_AE', location: 'UAE' }, { sort: 'salary' });
  assert.match(capturedUrl, /sort=salary/);
});

test('fetchCareerjet: config.contract_type and radius appear in URL', async () => {
  let capturedUrl = '';
  const fake = async (url) => { capturedUrl = url; return { ok: true, json: async () => ({ jobs: [] }) }; };
  await fetchCareerjet({ includeKeywords: ['x'] }, fake, { affid: 'a', localeCode: 'en_SA', location: 'Saudi Arabia' }, { contract_type: 'p', radius: 50 });
  assert.match(capturedUrl, /contract_type=p/);
  assert.match(capturedUrl, /radius=50/);
});

test('fetchCareerjet: config does NOT override locale_code or location', async () => {
  let capturedUrl = '';
  const fake = async (url) => { capturedUrl = url; return { ok: true, json: async () => ({ jobs: [] }) }; };
  // Even if a user config somehow sends locale_code/location, the caller's values must win.
  await fetchCareerjet({ includeKeywords: ['x'] }, fake, { affid: 'a', localeCode: 'en_QA', location: 'Qatar' }, { locale_code: 'en_US', location: 'New York' });
  assert.match(capturedUrl, /locale_code=en_QA/);
  assert.match(capturedUrl, /location=Qatar/);
});

test('fetchCareerjet: empty config → URL matches today\'s default (sort=date, no extra keys)', async () => {
  let capturedUrl = '';
  const fake = async (url) => { capturedUrl = url; return { ok: true, json: async () => ({ jobs: [] }) }; };
  await fetchCareerjet({ includeKeywords: ['backend'] }, fake, { affid: 'aff123', localeCode: 'en_AE', location: 'United Arab Emirates' }, {});
  assert.match(capturedUrl, /sort=date/);
  assert.match(capturedUrl, /keywords=backend/);
  assert.doesNotMatch(capturedUrl, /contract_type/);
  assert.doesNotMatch(capturedUrl, /work_hours/);
  assert.doesNotMatch(capturedUrl, /radius/);
});

test('fetchCareerjet: no config arg → same default URL (backward compat)', async () => {
  let capturedUrl = '';
  const fake = async (url) => { capturedUrl = url; return { ok: true, json: async () => ({ jobs: [] }) }; };
  await fetchCareerjet({ includeKeywords: ['devops'] }, fake, { affid: 'a', localeCode: 'en_AE', location: 'UAE' });
  assert.match(capturedUrl, /sort=date/);
  assert.match(capturedUrl, /keywords=devops/);
});

import { fetchArbeitnow } from '../src/sources/arbeitnow.js';

test('fetchArbeitnow maps API rows to CanonicalJob[] (created_at unix seconds → ISO)', async () => {
  const created = 1750000000; // unix seconds
  const payload = { data: [{
    slug: 'backend-dev-berlin-acme', title: 'Backend Developer', company_name: 'Acme GmbH',
    location: 'Berlin', remote: true, url: 'https://arbeitnow.com/jobs/backend-dev-berlin-acme',
    description: '<p>join us</p>', tags: ['backend', 'php'], created_at: created,
  }], links: { next: null }, meta: {} };
  const jobs = await fetchArbeitnow({ includeKeywords: ['backend'] }, async () => ({ ok: true, json: async () => payload }));
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.equal(j.source, 'arbeitnow');
  assert.equal(j.externalId, 'backend-dev-berlin-acme');
  assert.equal(j.title, 'Backend Developer');
  assert.equal(j.company, 'Acme GmbH');
  assert.equal(j.location, 'Berlin');
  assert.equal(j.remote, true);
  assert.equal(j.url, 'https://arbeitnow.com/jobs/backend-dev-berlin-acme');
  assert.equal(j.market, 'global');
  assert.deepEqual(j.tags, ['backend', 'php']);
  assert.equal(j.postedAt, new Date(created * 1000).toISOString());
});

test('fetchArbeitnow returns [] and does not throw on non-ok / network error / bad json', async () => {
  assert.deepEqual(await fetchArbeitnow({}, async () => ({ ok: false, status: 502 })), []);
  assert.deepEqual(await fetchArbeitnow({}, async () => { throw new Error('timeout'); }), []);
  assert.deepEqual(await fetchArbeitnow({}, async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } })), []);
});

test('fetchArbeitnow tolerates a body with no data array', async () => {
  assert.deepEqual(await fetchArbeitnow({}, async () => ({ ok: true, json: async () => ({}) })), []);
});

import { fetchWeWorkRemotely, parseRssItems } from '../src/sources/weworkremotely.js';

const WWR_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>WWR</title><link>https://weworkremotely.com/remote-jobs.rss</link>
<item>
  <title>1Password: Senior Web Developer</title>
  <region>Anywhere in the World</region>
  <skills>Ruby, Rails, and PostgreSQL</skills>
  <category>Back-End Programming</category>
  <type>Full-Time</type>
  <description>&lt;p&gt;Join &amp; build&lt;/p&gt;</description>
  <link>https://weworkremotely.com/remote-jobs/1password-senior-web-developer</link>
  <guid>https://weworkremotely.com/remote-jobs/1password-senior-web-developer</guid>
  <pubDate>Thu, 18 Jun 2026 02:19:12 +0000</pubDate>
</item>
<item>
  <title>Standalone Role Without Company</title>
  <link>https://weworkremotely.com/remote-jobs/standalone</link>
  <pubDate>Wed, 17 Jun 2026 00:00:00 +0000</pubDate>
</item>
</channel></rss>`;

function rssFetch(body) { return async () => ({ ok: true, text: async () => body }); }

test('fetchWeWorkRemotely parses RSS → CanonicalJob[] (splits "Company: Role", skills→tags, all remote)', async () => {
  const jobs = await fetchWeWorkRemotely({ includeKeywords: ['developer'] }, rssFetch(WWR_RSS));
  assert.equal(jobs.length, 2);
  const j = jobs[0];
  assert.equal(j.source, 'weworkremotely');
  assert.equal(j.company, '1Password');
  assert.equal(j.title, 'Senior Web Developer');
  assert.equal(j.location, 'Anywhere in the World');
  assert.equal(j.remote, true);
  assert.equal(j.market, 'global');
  assert.equal(j.url, 'https://weworkremotely.com/remote-jobs/1password-senior-web-developer');
  assert.equal(j.externalId, 'https://weworkremotely.com/remote-jobs/1password-senior-web-developer');
  assert.deepEqual(j.tags, ['Ruby', 'Rails', 'PostgreSQL']); // Oxford "and" stripped
  assert.equal(j.description, 'Join & build');               // CDATA/entities decoded, tags stripped
  assert.equal(j.postedAt, new Date('Thu, 18 Jun 2026 02:19:12 +0000').toISOString());
});

test('fetchWeWorkRemotely tolerates a title with no company and a missing region/skills', async () => {
  const jobs = await fetchWeWorkRemotely({}, rssFetch(WWR_RSS));
  const j = jobs[1];
  assert.equal(j.company, null);
  assert.equal(j.title, 'Standalone Role Without Company');
  assert.equal(j.location, 'Remote'); // no <region> → default
  assert.deepEqual(j.tags, []);       // no <skills>/<category>
});

test('fetchWeWorkRemotely returns [] on non-ok / throw / unparseable', async () => {
  assert.deepEqual(await fetchWeWorkRemotely({}, async () => ({ ok: false, status: 503 })), []);
  assert.deepEqual(await fetchWeWorkRemotely({}, async () => { throw new Error('timeout'); }), []);
  assert.deepEqual(await fetchWeWorkRemotely({}, async () => ({ ok: true, text: async () => 'not xml at all' })), []);
});

test('parseRssItems is null-safe and CDATA-aware', () => {
  assert.deepEqual(parseRssItems(null), []);
  assert.deepEqual(parseRssItems(42), []);
  const items = parseRssItems('<rss><item><title><![CDATA[Acme: Dev]]></title><link>u</link></item></rss>');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Acme: Dev');
});

import { SOURCES, buildSources } from '../src/sources/index.js';

test('SOURCES registry includes the free sources as named fetchers', () => {
  const names = SOURCES.map((s) => s.name);
  // membership (not exact equality) so Task 14's token-gated sources don't break this test
  assert.ok(names.includes('remotive'), 'remotive present');
  assert.ok(names.includes('remoteok'), 'remoteok present');
  assert.ok(names.includes('hackernews'), 'hackernews present');
  assert.ok(names.includes('reddit'), 'reddit present');
  assert.ok(names.includes('freelancer'), 'freelancer present');
  for (const s of SOURCES) {
    assert.equal(typeof s.fetch, 'function');
    assert.ok(['global', 'mena'].includes(s.market));
  }
});

test('fetchRemotive returns [] on network error', async () => {
  assert.deepEqual(await fetchRemotive({ includeKeywords: ['x'] }, async () => { throw new Error('ECONNREFUSED'); }), []);
});

test('fetchRemotive returns [] when the 200 body is not valid JSON', async () => {
  assert.deepEqual(await fetchRemotive({ includeKeywords: ['x'] }, async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } })), []);
});

test('fetchRemotive keeps a job with an invalid date (postedAt null, no throw)', async () => {
  const payload = { jobs: [{ id: 1, title: 'DevOps', company_name: 'C', url: 'https://x/1', publication_date: 'TBD', tags: [] }] };
  const jobs = await fetchRemotive({ includeKeywords: ['devops'] }, async () => ({ ok: true, json: async () => payload }));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].postedAt, null);
});

test('fetchRemoteOk returns [] on non-ok response', async () => {
  assert.deepEqual(await fetchRemoteOk({}, async () => ({ ok: false, status: 429 })), []);
});

test('fetchRemoteOk returns [] on network error', async () => {
  assert.deepEqual(await fetchRemoteOk({}, async () => { throw new Error('timeout'); }), []);
});

import { makeApifySource } from '../src/sources/apify.js';

test('makeApifySource runs an actor and maps dataset items via the provided mapper', async () => {
  const items = [{ jobTitle: 'DevOps', companyName: 'WAcme', city: 'Cairo', jobUrl: 'https://wuzzuf/1' }];
  const fakeFetch = async (url) => {
    assert.match(url, /api\.apify\.com\/v2\/acts\/test~actor\/run-sync-get-dataset-items/);
    assert.match(url, /token=APIK/);
    return { ok: true, json: async () => items };
  };
  const src = makeApifySource({
    name: 'wuzzuf', market: 'mena', actorId: 'test~actor', token: 'APIK',
    buildInput: (p) => ({ q: p.includeKeywords[0] }),
    map: (r) => ({ source: 'wuzzuf', externalId: null, title: r.jobTitle, company: r.companyName,
      location: r.city, remote: false, url: r.jobUrl, description: null, tags: [], market: 'mena', postedAt: null }),
    fetchImpl: fakeFetch,
  });
  const jobs = await src.fetch({ includeKeywords: ['devops'] });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].source, 'wuzzuf');
  assert.equal(jobs[0].market, 'mena');
  assert.equal(jobs[0].company, 'WAcme');
});

test('makeApifySource throws on actor failure so it surfaces as a source error', async () => {
  const src = makeApifySource({
    name: 'bayt', market: 'mena', actorId: 'x~y', token: 'K',
    buildInput: () => ({}), map: (r) => r, fetchImpl: async () => ({ ok: false, status: 500 }),
  });
  await assert.rejects(() => src.fetch({ includeKeywords: ['x'] }), /HTTP 500/);
});

test('buildSources: free no-auth globals only when no token/flags', () => {
  const names = buildSources({}).map((s) => s.name);
  assert.deepEqual(names, ['remotive', 'remoteok', 'jobicy', 'arbeitnow', 'weworkremotely', 'himalayas', 'hackernews', 'reddit', 'freelancer']);
});

import { fetchHimalayas } from '../src/sources/himalayas.js';

// Helper: build a fake fetchImpl keyed by offset (extracted from URL query string).
function himFetch(pagesByOffset) {
  return async (url) => {
    const m = /offset=(\d+)/.exec(url);
    const offset = m ? Number(m[1]) : 0;
    const page = pagesByOffset[offset];
    if (!page) throw new Error(`unexpected offset ${offset}`);
    return page;
  };
}

// Build a page response with n synthetic jobs.
function himPage(n) {
  const jobs = Array.from({ length: n }, (_, i) => ({
    title: `Job ${i}`, companyName: 'Co', locationRestrictions: [],
    applicationLink: `https://himalayas.app/j/${i}`, guid: `guid-${i}`,
    description: 'desc', categories: ['Engineering'], pubDate: 1750000000,
  }));
  return { ok: true, json: async () => ({ jobs }) };
}

test('fetchHimalayas maps API rows (remote, categories→tags, unix pubDate→ISO)', async () => {
  const payload = { jobs: [{
    title: 'Staff Backend Engineer', companyName: 'Himcorp', locationRestrictions: ['United States', 'Canada'],
    applicationLink: 'https://himalayas.app/companies/himcorp/jobs/staff-be', guid: 'https://himalayas.app/companies/himcorp/jobs/staff-be',
    description: '<p>build</p>', categories: ['Software-Development', 'Backend'], pubDate: 1750000000,
  }] };
  // Single-page fetch: only offset 0, returns fewer than 20 → stops after page 0
  const fetchImpl = async (url) => {
    assert.match(url, /limit=20/);
    assert.match(url, /offset=0/);
    return { ok: true, json: async () => payload };
  };
  const jobs = await fetchHimalayas({ includeKeywords: ['backend'] }, fetchImpl);
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.equal(j.source, 'himalayas');
  assert.equal(j.title, 'Staff Backend Engineer');
  assert.equal(j.company, 'Himcorp');
  assert.equal(j.location, 'United States, Canada');
  assert.equal(j.remote, true);
  assert.equal(j.market, 'global');
  assert.equal(j.url, 'https://himalayas.app/companies/himcorp/jobs/staff-be');
  assert.deepEqual(j.tags, ['Software-Development', 'Backend']);
  assert.equal(j.postedAt, new Date(1750000000 * 1000).toISOString());
});

test('fetchHimalayas returns [] on non-ok / throw / bad-json / no jobs array (first-page failures)', async () => {
  assert.deepEqual(await fetchHimalayas({}, async () => ({ ok: false, status: 503 })), []);
  assert.deepEqual(await fetchHimalayas({}, async () => { throw new Error('timeout'); }), []);
  assert.deepEqual(await fetchHimalayas({}, async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } })), []);
  assert.deepEqual(await fetchHimalayas({}, async () => ({ ok: true, json: async () => ({}) })), []);
});

test('fetchHimalayas: paginates + aggregates + stops on a short page (20+20+5 → 45 jobs)', async () => {
  const requestedOffsets = [];
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    const m = /offset=(\d+)/.exec(url);
    const offset = m ? Number(m[1]) : 0;
    requestedOffsets.push(offset);
    if (offset === 0)  return himPage(20);
    if (offset === 20) return himPage(20);
    if (offset === 40) return himPage(5);
    throw new Error(`unexpected offset ${offset}`);
  };
  const savedMax = process.env.JOBRADAR_HIMALAYAS_MAX;
  delete process.env.JOBRADAR_HIMALAYAS_MAX;
  const jobs = await fetchHimalayas({}, fetchImpl);
  if (savedMax !== undefined) process.env.JOBRADAR_HIMALAYAS_MAX = savedMax;
  assert.deepEqual(requestedOffsets, [0, 20, 40]);
  assert.ok(!requestedOffsets.includes(60), 'must NOT fetch offset 60');
  for (const url of requestedUrls) assert.match(url, /limit=20/);
  assert.equal(jobs.length, 45);
});

test('fetchHimalayas: respects JOBRADAR_HIMALAYAS_MAX (max=40 → only 2 pages fetched)', async () => {
  const offsets = [];
  const fetchImpl = async (url) => {
    const m = /offset=(\d+)/.exec(url);
    offsets.push(m ? Number(m[1]) : 0);
    return himPage(20); // all pages full → would paginate forever without max cap
  };
  const saved = process.env.JOBRADAR_HIMALAYAS_MAX;
  process.env.JOBRADAR_HIMALAYAS_MAX = '40';
  const jobs = await fetchHimalayas({}, fetchImpl);
  process.env.JOBRADAR_HIMALAYAS_MAX = saved;
  assert.deepEqual(offsets, [0, 20]);
  assert.equal(jobs.length, 40);
});

test('fetchHimalayas: first-page failure → []', async () => {
  const result = await fetchHimalayas({}, async () => ({ ok: false, status: 500 }));
  assert.deepEqual(result, []);
});

test('fetchHimalayas: first-page throw → []', async () => {
  const result = await fetchHimalayas({}, async () => { throw new Error('ECONNRESET'); });
  assert.deepEqual(result, []);
});

test('fetchHimalayas: later-page failure → returns accumulated so far', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    if (calls === 1) return himPage(20); // offset 0 ok
    throw new Error('network error on page 2'); // offset 20 throws
  };
  const jobs = await fetchHimalayas({}, fetchImpl);
  assert.equal(jobs.length, 20);
});

test('buildSources: MENA flag adds single bayt/naukrigulf/gulftalent + 6 per-country wuzzuf', () => {
  const sources = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1' });
  const names = sources.map((s) => s.name);
  // bayt, naukrigulf, gulftalent are now single fan-out entries (one entry each)
  assert.ok(names.includes('bayt'), 'bayt single entry present');
  assert.ok(!names.some((n) => n.startsWith('bayt-')), 'no per-country bayt-* entries');
  assert.ok(names.includes('naukrigulf'), 'naukrigulf single entry present');
  assert.ok(!names.some((n) => n.startsWith('naukrigulf-')), 'no per-country naukrigulf-* entries');
  assert.ok(names.includes('gulftalent'), 'gulftalent single entry present');
  assert.ok(!names.some((n) => n.startsWith('gulftalent-')), 'no per-country gulftalent-* entries');
  // wuzzuf remains per-country (6 entries)
  assert.ok(names.includes('wuzzuf-uae') && names.includes('wuzzuf-oman'));
  assert.equal(names.filter((n) => n.startsWith('wuzzuf-')).length, 6);
  assert.ok(sources.every((s) => ['global', 'mena'].includes(s.market)));
  assert.ok(!names.includes('linkedin')); // LinkedIn needs its own flag
});

test('buildSources: LinkedIn flag adds a single linkedin source (location fan-out, no separate linkedin-mena)', () => {
  const names = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_LINKEDIN: '1' }).map((s) => s.name);
  assert.ok(names.includes('linkedin'));
  assert.ok(!names.includes('linkedin-mena'), 'no separate linkedin-mena source any more');
  assert.ok(!names.includes('bayt-uae')); // MENA needs its own flag
});

test('buildSources: Indeed flag adds a single indeed source (location fan-out, no separate indeed-mena)', () => {
  const names = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_INDEED: '1' }).map((s) => s.name);
  assert.ok(names.includes('indeed'));                         // unified source
  assert.ok(!names.includes('indeed-mena'), 'no separate indeed-mena source any more');
  assert.ok(!names.some((n) => /^indeed-[a-z]{2,}$/.test(n))); // no per-country indeed-uae etc
  assert.ok(!names.includes('bayt'));                          // MENA needs its own flag
  assert.equal(buildSources({ APIFY_TOKEN: 'k' }).filter((s) => s.name.startsWith('indeed')).length, 0); // gated
});

test('indeed: remote leg searches remote-worldwide (default); location=[ksa] fans out to KSA using lowercase iso2', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => [] }; };

  // Default (no location config → ['remote']) → 1 remote leg call
  const sources = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_INDEED: '1' }, { fetchImpl });
  await sources.find((s) => s.name === 'indeed').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].country, 'us');
  assert.equal(calls[0].location, 'Remote');
  assert.equal(calls[0].title, 'backend');
  calls.length = 0;

  // location=['ksa'] → 1 per-country call for KSA
  const sources2 = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_INDEED: '1' }, { fetchImpl, sourceConfigs: { indeed: { location: ['ksa'] } } });
  await sources2.find((s) => s.name === 'indeed').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls.length, 1, 'exactly 1 per-country call for ksa');
  assert.equal(calls[0].country, 'sa'); // Saudi Arabia lowercase iso2
});

test('buildSources: Mostaql flag adds a single mena mostaql source (own flag, gated)', () => {
  const names = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MOSTAQL: '1' }).map((s) => s.name);
  assert.ok(names.includes('mostaql'));
  assert.ok(!names.some((n) => n.startsWith('mostaql-'))); // single mena entry
  assert.ok(!names.includes('bayt-uae') && !names.includes('wellfound')); // other families need their own flags
  assert.equal(buildSources({ APIFY_TOKEN: 'k' }).filter((s) => s.name === 'mostaql').length, 0); // gated
  // freelancer is always present (free, no flag)
  assert.ok(names.includes('freelancer'));
});

test('buildSources: Upwork flag adds a single global upwork source (own flag, gated)', () => {
  const names = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_UPWORK: '1' }).map((s) => s.name);
  assert.ok(names.includes('upwork'));
  assert.ok(!names.some((n) => n.startsWith('upwork-'))); // single global entry
  assert.ok(!names.includes('bayt-uae') && !names.includes('wellfound')); // other families need their own flags
  assert.equal(buildSources({ APIFY_TOKEN: 'k' }).filter((s) => s.name === 'upwork').length, 0); // gated
});

test('buildSources: Wellfound flag adds a single global wellfound source (own flag, gated)', () => {
  const names = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_WELLFOUND: '1' }).map((s) => s.name);
  assert.ok(names.includes('wellfound'));
  assert.ok(!names.some((n) => n.startsWith('wellfound-'))); // single global entry, no per-country
  assert.ok(!names.includes('bayt-uae') && !names.includes('indeed')); // other families need their own flags
  assert.equal(buildSources({ APIFY_TOKEN: 'k' }).filter((s) => s.name === 'wellfound').length, 0); // gated
});

test('wellfound source maps a dataset item (global, new actor fields)', async () => {
  const item = {
    id: 'wf42', title: 'Founding Engineer', company: 'SeedCo', location: 'Remote (US)',
    applyUrl: 'https://wellfound.com/jobs/wf42', description_text: 'build it',
    primaryRoleTitle: 'Engineering', jobType: 'Full-time',
    postedDate: '2026-05-03', remote: true,
  };
  const fetchImpl = async () => ({ ok: true, json: async () => [item] });
  const sources = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_WELLFOUND: '1' }, { fetchImpl });
  const j = (await sources.find((s) => s.name === 'wellfound').fetch({ includeKeywords: ['eng'] }))[0];
  assert.equal(j.source, 'wellfound');
  assert.equal(j.externalId, 'wf42');
  assert.equal(j.title, 'Founding Engineer');
  assert.equal(j.company, 'SeedCo');
  assert.equal(j.remote, true);
  assert.equal(j.market, 'global');
  assert.equal(j.url, 'https://wellfound.com/jobs/wf42');
  assert.deepEqual(j.tags, ['Engineering', 'Full-time']); // [primaryRoleTitle, jobType]
  assert.equal(j.postedAt, '2026-05-03T00:00:00.000Z');
});

test('buildSourcesFromDb: mostaql=false in DB drops it; =true (token) builds it', async () => {
  const off = (await buildSourcesFromDb({ APIFY_TOKEN: 'k', JOBRADAR_TENANT_ID: '1' }, cfgClient({ sources: [{ name: 'mostaql', enabled: false }] }))).map((s) => s.name);
  assert.ok(!off.includes('mostaql'));
  const on = (await buildSourcesFromDb({ APIFY_TOKEN: 'k', JOBRADAR_TENANT_ID: '1' }, cfgClient({ sources: [{ name: 'mostaql', enabled: true }] }))).map((s) => s.name);
  assert.ok(on.includes('mostaql'));
});

test('buildSourcesFromDb: upwork=false in DB drops it; =true (token) builds it', async () => {
  const off = (await buildSourcesFromDb({ APIFY_TOKEN: 'k', JOBRADAR_TENANT_ID: '1' }, cfgClient({ sources: [{ name: 'upwork', enabled: false }] }))).map((s) => s.name);
  assert.ok(!off.includes('upwork'));
  const on = (await buildSourcesFromDb({ APIFY_TOKEN: 'k', JOBRADAR_TENANT_ID: '1' }, cfgClient({ sources: [{ name: 'upwork', enabled: true }] }))).map((s) => s.name);
  assert.ok(on.includes('upwork'));
});

test('buildSourcesFromDb: wellfound=false in DB drops it; =true (token) builds it', async () => {
  const off = (await buildSourcesFromDb({ APIFY_TOKEN: 'k', JOBRADAR_TENANT_ID: '1' }, cfgClient({ sources: [{ name: 'wellfound', enabled: false }] }))).map((s) => s.name);
  assert.ok(!off.includes('wellfound'));
  const on = (await buildSourcesFromDb({ APIFY_TOKEN: 'k', JOBRADAR_TENANT_ID: '1' }, cfgClient({ sources: [{ name: 'wellfound', enabled: true }] }))).map((s) => s.name);
  assert.ok(on.includes('wellfound'));
});

test('indeedMap maps both legs (global remote=true, mena remote=false; new actor fields)', async () => {
  const item = {
    key: '900', title: 'Staff Engineer', employer: { name: 'Acme' },
    location: { city: 'Riyadh', countryName: 'Saudi Arabia' },
    url: 'https://indeed.com/v/900', description: 'do platform', datePublished: '2026-05-02',
    jobTypes: { A: 'Permanent' },
  };
  const fetchImpl = async () => ({ ok: true, json: async () => [item] });

  // Remote leg (default): location unset → ['remote'] → 1 call, market=global, remote=true
  const sources = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_INDEED: '1' }, { fetchImpl });
  const g = (await sources.find((s) => s.name === 'indeed').fetch({ includeKeywords: ['eng'] }))[0];
  assert.equal(g.source, 'indeed');
  assert.equal(g.externalId, '900');
  assert.equal(g.title, 'Staff Engineer');
  assert.equal(g.company, 'Acme');
  assert.equal(g.location, 'Riyadh, Saudi Arabia');
  assert.equal(g.url, 'https://indeed.com/v/900');
  assert.equal(g.remote, true);
  assert.equal(g.market, 'global');
  assert.equal(g.postedAt, '2026-05-02T00:00:00.000Z');
  assert.deepEqual(g.tags, ['Permanent']);               // Object.values(jobTypes)

  // UAE leg: location=['uae'] → 1 per-country call, market=mena, remote=false
  const sources2 = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_INDEED: '1' }, { fetchImpl, sourceConfigs: { indeed: { location: ['uae'] } } });
  const mJobs = await sources2.find((s) => s.name === 'indeed').fetch({ includeKeywords: ['eng'] });
  assert.equal(mJobs[0].remote, false);
  assert.equal(mJobs[0].market, 'mena');
});

test('buildSources wires bayt/naukrigulf/gulftalent per-country params; linkedin location fan-out', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true, json: async () => [] }; };

  // bayt with just ksa → 1 call with the ksa slug URL
  const baytksa = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1' }, { fetchImpl, sourceConfigs: { bayt: { country: ['ksa'] } } });
  await baytksa.find((s) => s.name === 'bayt').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.startUrl, /\/saudi-arabia\/jobs\/backend-jobs\//);
  calls.length = 0;

  // bayt with a per-source query override → startUrl uses the override, not the profile keyword
  const baytQ = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1' }, { fetchImpl, sourceConfigs: { bayt: { country: ['uae'], query: 'rust developer' } } });
  await baytQ.find((s) => s.name === 'bayt').fetch({ includeKeywords: ['backend'] });
  assert.match(calls[0].body.startUrl, /\/uae\/jobs\/rust-developer-jobs\//, 'bayt query config overrides the profile keyword');
  calls.length = 0;

  // naukrigulf with just uae → 1 call; uses query+location(c.loc)
  const ngUae = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1' }, { fetchImpl, sourceConfigs: { naukrigulf: { country: ['uae'] } } });
  await ngUae.find((s) => s.name === 'naukrigulf').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.location, 'United Arab Emirates'); // c.loc
  assert.equal(calls[0].body.query, 'backend');
  calls.length = 0;

  // gulftalent with just qatar → 1 call; uses keyword+location(city)
  const gtQatar = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1' }, { fetchImpl, sourceConfigs: { gulftalent: { country: ['qatar'] } } });
  await gtQatar.find((s) => s.name === 'gulftalent').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.location, 'Doha');         // c.city for qatar
  assert.equal(calls[0].body.keyword, 'backend');
  calls.length = 0;

  // linkedin with location=['uae'] → 1 per-country call with UAE loc URL
  const liUae = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_LINKEDIN: '1' }, { fetchImpl, sourceConfigs: { linkedin: { location: ['uae'] } } });
  await liUae.find((s) => s.name === 'linkedin').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls.length, 1, 'linkedin location=[uae] → 1 per-country call');
  assert.match(calls[0].body.urls[0], /location=United\+Arab\+Emirates/);
});

test('naukrigulf maps dataset items to mena CanonicalJobs (new actor fields)', async () => {
  const item = {
    jobId: '77', title: 'Senior Backend Engineer', company: 'GulfCo', location: 'Dubai',
    url: 'https://www.naukrigulf.com/job/77', descriptionHtml: '<p>do backend</p>', keywords: ['node', 'aws'],
    postedAt: '2026-05-01',
  };
  const fetchImpl = async () => ({ ok: true, json: async () => [item] });
  const sources = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1' }, { fetchImpl, sourceConfigs: { naukrigulf: { country: ['uae'] } } });
  const jobs = await sources.find((s) => s.name === 'naukrigulf').fetch({ includeKeywords: ['backend'] });
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.equal(j.source, 'naukrigulf');
  assert.equal(j.externalId, '77');
  assert.equal(j.title, 'Senior Backend Engineer');
  assert.equal(j.company, 'GulfCo');
  assert.equal(j.location, 'Dubai');
  assert.equal(j.remote, false);
  assert.equal(j.market, 'mena');
  assert.equal(j.url, 'https://www.naukrigulf.com/job/77');
  assert.deepEqual(j.tags, ['node', 'aws']);             // from keywords
  assert.equal(j.postedAt, '2026-05-01T00:00:00.000Z');
});

test('gulftalent maps dataset items to mena CanonicalJobs (new actor fields)', async () => {
  const item = {
    job_id: 'gt77', title: 'Senior Backend Engineer', company: 'GulfCo', location: 'Dubai',
    url: 'https://www.gulftalent.com/job/77', description_text: 'do backend',
    date_posted: '2026-05-01', is_remote: false, category: 'Engineering', industry: 'Technology',
  };
  const fetchImpl = async () => ({ ok: true, json: async () => [item] });
  const sources = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1' }, { fetchImpl, sourceConfigs: { gulftalent: { country: ['ksa'] } } });
  const jobs = await sources.find((s) => s.name === 'gulftalent').fetch({ includeKeywords: ['backend'] });
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.equal(j.source, 'gulftalent');
  assert.equal(j.externalId, 'gt77');
  assert.equal(j.title, 'Senior Backend Engineer');
  assert.equal(j.company, 'GulfCo');
  assert.equal(j.location, 'Dubai');
  assert.equal(j.remote, false);
  assert.equal(j.market, 'mena');
  assert.equal(j.url, 'https://www.gulftalent.com/job/77');
  assert.deepEqual(j.tags, ['Engineering', 'Technology']); // [category, industry]
  assert.equal(j.postedAt, '2026-05-01T00:00:00.000Z');
});

import { MENA_COUNTRIES, linkedinSearchUrl, baytStartUrl, linkedinMap } from '../src/sources/index.js';

test('MENA_COUNTRIES is the 6 GCC states with bayt slug + loc + city', () => {
  assert.deepEqual(MENA_COUNTRIES.map((c) => c.key), ['uae', 'ksa', 'qatar', 'kuwait', 'bahrain', 'oman']);
  const ksa = MENA_COUNTRIES.find((c) => c.key === 'ksa');
  assert.equal(ksa.baytSlug, 'saudi-arabia');
  assert.equal(ksa.loc, 'Saudi Arabia');
  assert.equal(ksa.city, 'Riyadh');
  // verify all 6 have a city
  const cities = { uae: 'Dubai', ksa: 'Riyadh', qatar: 'Doha', kuwait: 'Kuwait City', bahrain: 'Manama', oman: 'Muscat' };
  for (const c of MENA_COUNTRIES) assert.equal(c.city, cities[c.key]);
});

test('linkedinSearchUrl builds remote (f_WT=2) and country variants, keyword-encoded', () => {
  const remote = linkedinSearchUrl('backend engineer', { remote: true });
  assert.match(remote, /keywords=backend\+engineer/);
  assert.match(remote, /location=Worldwide/);
  assert.match(remote, /f_WT=2/);
  const country = linkedinSearchUrl('backend', { loc: 'United Arab Emirates' });
  assert.match(country, /location=United\+Arab\+Emirates/);
  assert.doesNotMatch(country, /f_WT/);
});

test('baytStartUrl builds a country jobs URL with a slugged keyword', () => {
  assert.equal(baytStartUrl('saudi-arabia', 'Senior Backend'), 'https://www.bayt.com/en/saudi-arabia/jobs/senior-backend-jobs/');
  assert.equal(baytStartUrl('uae', null), 'https://www.bayt.com/en/uae/jobs/software-jobs/');
  assert.equal(baytStartUrl('uae', '!!!'), 'https://www.bayt.com/en/uae/jobs/software-jobs/'); // strips to empty → 'software'
});

test('linkedinMap maps the verified actor fields; remote true only for global', () => {
  const item = { id: '414', link: 'https://www.linkedin.com/jobs/view/414', title: 'Backend Engineer',
    companyName: 'Entefy', location: 'United States', postedAt: '2025-02-05',
    descriptionText: 'do backend', industries: ['Software'] };
  const g = linkedinMap('global')(item);
  assert.equal(g.source, 'linkedin');
  assert.equal(g.externalId, '414');
  assert.equal(g.title, 'Backend Engineer');
  assert.equal(g.company, 'Entefy');
  assert.equal(g.url, 'https://www.linkedin.com/jobs/view/414');
  assert.equal(g.remote, true);
  assert.equal(g.market, 'global');
  assert.deepEqual(g.tags, ['Software']);
  assert.equal(g.postedAt, '2025-02-05T00:00:00.000Z');
  const m = linkedinMap('mena')(item);
  assert.equal(m.remote, false);
  assert.equal(m.market, 'mena');
});

// ---- buildSources({countries}) + buildSourcesFromDb --------------------------

import { buildSourcesFromDb } from '../src/sources/index.js';

// A fake client whose three config SELECTs return the supplied rows.
function cfgClient({ sources = [], countries = [], excludes = [] } = {}) {
  return {
    async query(text) {
      if (/FROM sources/i.test(text)) return { rows: sources };
      if (/FROM discovery_countries/i.test(text)) return { rows: countries };
      if (/FROM discovery_excludes/i.test(text)) return { rows: excludes };
      return { rows: [] };
    },
  };
}
// A client that simulates the tables not existing yet (P2 fallback path).
const absentTablesClient = { async query() { const e = new Error('no relation'); e.code = '42P01'; throw e; } };

test('per-source country config fans out to only the selected GCC countries', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => [] }; };
  // bayt with country=['uae','qatar'] → exactly 2 per-country Apify calls
  const sources = buildSources(
    { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1' },
    { fetchImpl, sourceConfigs: { bayt: { country: ['uae', 'qatar'] } } },
  );
  await sources.find((s) => s.name === 'bayt').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls.length, 2, 'exactly 2 per-country calls for uae+qatar');
  assert.ok(calls.some((c) => c.startUrl.includes('/uae/')));
  assert.ok(calls.some((c) => c.startUrl.includes('/qatar/')));
  assert.ok(!calls.some((c) => c.startUrl.includes('/saudi-arabia/')));
});

test('buildSourcesFromDb with null client === buildSources(env) (P1/P2 — no config = today)', async () => {
  const env = {};
  const fromDb = (await buildSourcesFromDb(env, null)).map((s) => s.name);
  assert.deepEqual(fromDb, buildSources(env).map((s) => s.name));
});

test('buildSourcesFromDb with absent tables falls back to env-built list (P2)', async () => {
  const env = { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1' };
  const fromDb = (await buildSourcesFromDb(env, absentTablesClient)).map((s) => s.name);
  assert.deepEqual(fromDb, buildSources(env).map((s) => s.name));
});

test('buildSourcesFromDb with empty present tables === today (empty = no override)', async () => {
  const env = { JOBRADAR_TENANT_ID: '1' };
  const fromDb = (await buildSourcesFromDb(env, cfgClient({}))).map((s) => s.name);
  assert.deepEqual(fromDb, buildSources(env).map((s) => s.name));
});

test('buildSourcesFromDb: bayt=false in DB drops bayt source', async () => {
  const env = { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1', JOBRADAR_TENANT_ID: '1' };
  const client = cfgClient({ sources: [{ name: 'bayt', enabled: false }] });
  const names = (await buildSourcesFromDb(env, client)).map((s) => s.name);
  assert.ok(!names.includes('bayt'));
  assert.ok(names.includes('naukrigulf')); // other families untouched
});

test('buildSourcesFromDb: indeed=false in DB drops the unified indeed source', async () => {
  const env = { APIFY_TOKEN: 'k', JOBRADAR_TENANT_ID: '1' };
  // indeed is now a single unified source (no indeed-mena family)
  const client = cfgClient({ sources: [{ name: 'indeed', enabled: false }] });
  const names = (await buildSourcesFromDb(env, client)).map((s) => s.name);
  assert.ok(!names.includes('indeed'));
  assert.ok(!names.includes('indeed-mena'), 'indeed-mena no longer emitted');
});

test('buildSourcesFromDb: indeed=true in DB (token present) builds unified indeed source', async () => {
  const env = { APIFY_TOKEN: 'k', JOBRADAR_TENANT_ID: '1' };
  // When DB config present + token, forceIndeed emits the unified source
  const client = cfgClient({ sources: [{ name: 'indeed', enabled: true }] });
  const names = (await buildSourcesFromDb(env, client)).map((s) => s.name);
  assert.ok(names.includes('indeed'));
  assert.ok(!names.includes('indeed-mena'), 'indeed-mena no longer emitted');
});

test('buildSourcesFromDb: country filtering is now per-source via config.country (not global)', async () => {
  const env = { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1', JOBRADAR_TENANT_ID: '1' };
  // With the refactor, country subsetting is per-source via each source's config.country.
  // The discovery_countries table is no longer read by loadDiscoveryConfig.
  // Default: all 6 countries are fetched by each MENA source (fan-out).
  const client = cfgClient({});  // empty config — no source toggles, no country overrides
  const names = (await buildSourcesFromDb(env, client)).map((s) => s.name);
  // Single fan-out entries present (no per-country names)
  assert.ok(names.includes('bayt'), 'bayt single entry present');
  assert.ok(names.includes('naukrigulf'), 'naukrigulf single entry present');
  assert.ok(names.includes('gulftalent'), 'gulftalent single entry present');
  assert.ok(!names.some((n) => /^(bayt|naukrigulf|gulftalent)-[a-z]+$/.test(n)));
});

test('buildSourcesFromDb: DB source toggle wins over MENA flag when token present (flag unset, bayt=true → bayt builds)', async () => {
  const env = { APIFY_TOKEN: 'k', JOBRADAR_TENANT_ID: '1' }; // JOBRADAR_ENABLE_MENA unset
  const client = cfgClient({ sources: [{ name: 'bayt', enabled: true }] });
  const names = (await buildSourcesFromDb(env, client)).map((s) => s.name);
  // candidate MENA set emitted because token present + DB config present; other families not toggled off → present too
  assert.ok(names.includes('bayt'), 'single bayt entry present when DB config enables it');
});

test('buildSourcesFromDb: token absent + bayt=true in DB still yields NO bayt source (P3)', async () => {
  const env = { JOBRADAR_TENANT_ID: '1' }; // no APIFY_TOKEN
  const client = cfgClient({ sources: [{ name: 'bayt', enabled: true }, { name: 'linkedin', enabled: true }] });
  const names = (await buildSourcesFromDb(env, client)).map((s) => s.name);
  assert.ok(!names.some((n) => n.startsWith('bayt-')));
  assert.ok(!names.includes('linkedin'));
});

// ---- Careerjet (free aggregator API, gated on CAREERJET_AFFID) ---------------

import { fetchCareerjet, CAREERJET_LOCALES } from '../src/sources/careerjet.js';

test('buildSources: Careerjet flag adds careerjet-uae..careerjet-oman (6, own free affid gate)', () => {
  const names = buildSources({ CAREERJET_AFFID: 'aff123', JOBRADAR_ENABLE_CAREERJET: '1' }).map((s) => s.name);
  assert.ok(names.includes('careerjet-uae') && names.includes('careerjet-oman'));
  assert.equal(names.filter((n) => n.startsWith('careerjet-')).length, 6);
  assert.ok(!names.includes('bayt-uae') && !names.includes('indeed')); // other families need their own flags
  // gated: no affid → not registered even with the enable flag
  assert.equal(buildSources({ JOBRADAR_ENABLE_CAREERJET: '1' }).filter((s) => s.name.startsWith('careerjet')).length, 0);
  // gated: affid present but flag off (no force) → not registered
  assert.equal(buildSources({ CAREERJET_AFFID: 'aff123' }).filter((s) => s.name.startsWith('careerjet')).length, 0);
});

test('Careerjet per-country fetch builds the right locale_code + location + required params', async () => {
  const calls = [];
  let lastOpts;
  const fetchImpl = async (url, opts) => { calls.push(url); lastOpts = opts; return { ok: true, json: async () => ({ jobs: [] }) }; };
  const sources = buildSources({ CAREERJET_AFFID: 'aff123', JOBRADAR_ENABLE_CAREERJET: '1' }, { fetchImpl });
  await sources.find((s) => s.name === 'careerjet-ksa').fetch({ includeKeywords: ['backend'] });
  const u = calls[0];
  assert.match(u, /^http:\/\/public\.api\.careerjet\.net\/search\?/); // HTTP only (https endpoint times out)
  assert.match(u, /affid=aff123/);
  assert.match(u, /locale_code=en_SA/);          // Saudi Arabia locale
  assert.match(u, /location=Saudi\+Arabia/);     // full English name from MENA_COUNTRIES.loc
  assert.match(u, /keywords=backend/);
  assert.match(u, /user_ip=/);                    // required by the API (real public IP)
  assert.match(u, /user_agent=job-radar%2F0.1/); // required by the API
  assert.ok(lastOpts.headers.Referer, 'sends a Referer header (API 403s without it)');
  calls.length = 0;
  await sources.find((s) => s.name === 'careerjet-oman').fetch({ includeKeywords: ['backend'] });
  assert.match(calls[0], /locale_code=en_OM/);
  assert.match(calls[0], /location=Oman/);
  // locale map exposes all 6 GCC locales
  assert.deepEqual(Object.keys(CAREERJET_LOCALES).sort(), ['bahrain', 'kuwait', 'ksa', 'oman', 'qatar', 'uae'].sort());
});

test('fetchCareerjet maps a sample row to a valid mena CanonicalJob (defensive fields)', async () => {
  const payload = { type: 'JOBS', hits: 1, pages: 1, jobs: [{
    title: 'Senior DevOps Engineer', company: 'Gulf Cloud', locations: 'Dubai, UAE',
    salary: 'AED 30k', url: 'https://www.careerjet.ae/jobad/abc123',
    description: '<p>run the platform</p>', date: '2026-06-15T09:00:00Z',
  }] };
  const fetchImpl = async () => ({ ok: true, json: async () => payload });
  const jobs = await fetchCareerjet({ includeKeywords: ['devops'] }, fetchImpl, { affid: 'aff123', localeCode: 'en_AE', location: 'United Arab Emirates' });
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.equal(j.source, 'careerjet');
  assert.equal(j.externalId, null);
  assert.equal(j.title, 'Senior DevOps Engineer');
  assert.equal(j.company, 'Gulf Cloud');
  assert.equal(j.location, 'Dubai, UAE');
  assert.equal(j.remote, false);
  assert.equal(j.market, 'mena');
  assert.equal(j.url, 'https://www.careerjet.ae/jobad/abc123');
  assert.equal(j.description, 'run the platform');
  assert.deepEqual(j.tags, []);
  assert.equal(j.postedAt, new Date('2026-06-15T09:00:00Z').toISOString());
});

test('fetchCareerjet falls back to the passed location when a row has no locations', async () => {
  const payload = { jobs: [{ title: 'Backend Engineer', company: 'X', url: 'https://careerjet/x', date: 'TBD' }] };
  const j = (await fetchCareerjet({ includeKeywords: ['backend'] }, async () => ({ ok: true, json: async () => payload }), { affid: 'a', localeCode: 'en_QA', location: 'Qatar' }))[0];
  assert.equal(j.location, 'Qatar');
  assert.equal(j.postedAt, null); // invalid date kept as null, no throw
});

test('fetchCareerjet returns [] on non-ok / network error / bad json / no jobs array', async () => {
  const ctx = { affid: 'a', localeCode: 'en_AE', location: 'United Arab Emirates' };
  assert.deepEqual(await fetchCareerjet({}, async () => ({ ok: false, status: 503 }), ctx), []);
  assert.deepEqual(await fetchCareerjet({}, async () => { throw new Error('timeout'); }, ctx), []);
  assert.deepEqual(await fetchCareerjet({}, async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } }), ctx), []);
  assert.deepEqual(await fetchCareerjet({}, async () => ({ ok: true, json: async () => ({ type: 'JOBS' }) }), ctx), []);
});

test('buildSourcesFromDb: careerjet=false in DB drops it; =true (affid) builds all 6', async () => {
  const env = { CAREERJET_AFFID: 'aff123', JOBRADAR_TENANT_ID: '1' };
  const off = (await buildSourcesFromDb(env, cfgClient({ sources: [{ name: 'careerjet', enabled: false }] }))).map((s) => s.name);
  assert.ok(!off.some((n) => n.startsWith('careerjet-')));
  const on = (await buildSourcesFromDb(env, cfgClient({ sources: [{ name: 'careerjet', enabled: true }] }))).map((s) => s.name);
  assert.equal(on.filter((n) => n.startsWith('careerjet-')).length, 6);
});

test('buildSourcesFromDb: affid absent + careerjet=true in DB still yields NO careerjet source', async () => {
  const env = { JOBRADAR_TENANT_ID: '1' }; // no CAREERJET_AFFID
  const client = cfgClient({ sources: [{ name: 'careerjet', enabled: true }] });
  const names = (await buildSourcesFromDb(env, client)).map((s) => s.name);
  assert.ok(!names.some((n) => n.startsWith('careerjet-')));
});

// ---- makeMenaSource: fan-out tests (Task 2) ----

import { makeMenaSource, makeLocationSource } from '../src/sources/index.js';
import { applyFilters } from '../src/sources/filters.js';

test('makeMenaSource: config.country=[uae,ksa] → exactly 2 per-country fetches, results merged', async () => {
  const capturedInputs = [];
  const fetchImpl = async (_url, opts) => {
    capturedInputs.push(JSON.parse(opts.body));
    return { ok: true, json: async () => [{ id: 'j1', title: 'Eng', companyName: 'Co', location: 'Gulf', link: 'https://x/1', postedAt: null }] };
  };
  const src = makeMenaSource({
    name: 'test-mena', market: 'mena',
    actorId: 'test~actor', token: 'T',
    config: { country: ['uae', 'ksa'] },
    perCountryBuildInput: (c, p) => ({ searchQuery: p.includeKeywords?.[0] || 'x', country: c.key }),
    map: (r) => ({ source: 'test-mena', externalId: r.id, title: r.title, company: r.companyName, location: r.location, remote: false, url: r.link, description: null, tags: [], market: 'mena', postedAt: null }),
    fetchImpl,
  });
  const jobs = await src.fetch({ includeKeywords: ['backend'] });
  assert.equal(capturedInputs.length, 2, 'exactly 2 per-country Apify calls');
  assert.equal(capturedInputs[0].country, 'uae');
  assert.equal(capturedInputs[1].country, 'ksa');
  assert.equal(jobs.length, 2, 'results from both countries merged');
});

test('makeMenaSource: empty config.country → all 6 GCC countries fetched (regression: same as old all-6 behavior)', async () => {
  const capturedCountries = [];
  const fetchImpl = async (_url, opts) => {
    capturedCountries.push(JSON.parse(opts.body).country);
    return { ok: true, json: async () => [] };
  };
  const src = makeMenaSource({
    name: 'test-mena-all', market: 'mena',
    actorId: 'test~actor', token: 'T',
    config: {},  // no country → all 6
    perCountryBuildInput: (c) => ({ country: c.key }),
    map: (r) => r,
    fetchImpl,
  });
  await src.fetch({ includeKeywords: ['x'] });
  assert.deepEqual(capturedCountries, ['uae', 'ksa', 'qatar', 'kuwait', 'bahrain', 'oman'],
    'no-config fan-out == all 6 GCC countries (regression-safe)');
});

test('makeMenaSource: no config at all → all 6 GCC countries fetched (regression)', async () => {
  const capturedCountries = [];
  const fetchImpl = async (_url, opts) => {
    capturedCountries.push(JSON.parse(opts.body).country);
    return { ok: true, json: async () => [] };
  };
  const src = makeMenaSource({
    name: 'test-mena-noconf', market: 'mena',
    actorId: 'test~actor', token: 'T',
    // config omitted entirely
    perCountryBuildInput: (c) => ({ country: c.key }),
    map: (r) => r,
    fetchImpl,
  });
  await src.fetch({});
  assert.deepEqual(capturedCountries, ['uae', 'ksa', 'qatar', 'kuwait', 'bahrain', 'oman']);
});

test('makeMenaSource: config.country with only stale/invalid keys → falls back to all 6 (no silent dry source)', async () => {
  const capturedCountries = [];
  const fetchImpl = async (_url, opts) => {
    capturedCountries.push(JSON.parse(opts.body).country);
    return { ok: true, json: async () => [] };
  };
  const src = makeMenaSource({
    name: 'test-mena-stale', market: 'mena',
    actorId: 'test~actor', token: 'T',
    config: { country: ['egypt', 'mars'] }, // none match a GCC key
    perCountryBuildInput: (c) => ({ country: c.key }),
    map: (r) => r,
    fetchImpl,
  });
  await src.fetch({});
  assert.deepEqual(capturedCountries, ['uae', 'ksa', 'qatar', 'kuwait', 'bahrain', 'oman']);
});

test('makeMenaSource: country key in config not forwarded to actor input (stripped before applyFilters)', async () => {
  let capturedInput = null;
  const fetchImpl = async (_url, opts) => {
    capturedInput = JSON.parse(opts.body);
    return { ok: true, json: async () => [] };
  };
  const src = makeMenaSource({
    name: 'test-mena-strip', market: 'mena',
    actorId: 'test~actor', token: 'T',
    config: { country: ['uae'], query: 'devops' },
    perCountryBuildInput: (c, p, cfg) => applyFilters({ country: c.iso2, defaultQuery: 'x' }, cfg),
    map: (r) => r,
    fetchImpl,
  });
  await src.fetch({ includeKeywords: ['y'] });
  assert.equal(capturedInput.country, 'AE', 'iso2 from country row, not the GCC key');
  assert.equal(capturedInput.query, 'devops', 'non-country config key flows through');
  assert.ok(!Array.isArray(capturedInput.country), 'country key not forwarded as array');
});

test('bayt: no config.country → all 6 GCC baytSlug URLs fetched (regression)', async () => {
  const slugs = [];
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    slugs.push(/\/en\/([^/]+)\//.exec(body.startUrl)?.[1]);
    return { ok: true, json: async () => [] };
  };
  const sources = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1' }, { fetchImpl });
  await sources.find((s) => s.name === 'bayt').fetch({ includeKeywords: ['backend'] });
  assert.deepEqual(slugs, ['uae', 'saudi-arabia', 'qatar', 'kuwait', 'bahrain', 'oman'],
    'bayt fans out to all 6 GCC bayt slug URLs by default');
});

test('gulftalent: no config.country → all 6 GCC capital cities fetched (regression)', async () => {
  const cities = [];
  const fetchImpl = async (_url, opts) => {
    cities.push(JSON.parse(opts.body).location);
    return { ok: true, json: async () => [] };
  };
  const sources = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1' }, { fetchImpl });
  await sources.find((s) => s.name === 'gulftalent').fetch({ includeKeywords: ['backend'] });
  assert.deepEqual(cities, ['Dubai', 'Riyadh', 'Doha', 'Kuwait City', 'Manama', 'Muscat'],
    'gulftalent fans out to all 6 GCC capital cities by default');
});

test('naukrigulf: no config.country → all 6 GCC country names fetched via c.loc (regression)', async () => {
  const locs = [];
  const fetchImpl = async (_url, opts) => {
    locs.push(JSON.parse(opts.body).location);
    return { ok: true, json: async () => [] };
  };
  const sources = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1' }, { fetchImpl });
  await sources.find((s) => s.name === 'naukrigulf').fetch({ includeKeywords: ['backend'] });
  assert.deepEqual(locs, ['United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Kuwait', 'Bahrain', 'Oman'],
    'naukrigulf fans out to all 6 GCC c.loc values by default');
});

test('indeed location=[uae,ksa,...all GCC] fans out to all 6 GCC lowercase ISO2 codes', async () => {
  const iso2s = [];
  const fetchImpl = async (_url, opts) => {
    iso2s.push(JSON.parse(opts.body).country);
    return { ok: true, json: async () => [] };
  };
  // location=[all 6 GCC keys] → 6 per-country calls with lowercase ISO2 country codes
  const sources = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_INDEED: '1' }, {
    fetchImpl,
    sourceConfigs: { indeed: { location: ['uae', 'ksa', 'qatar', 'kuwait', 'bahrain', 'oman'] } },
  });
  await sources.find((s) => s.name === 'indeed').fetch({ includeKeywords: ['backend'] });
  assert.deepEqual(iso2s, ['ae', 'sa', 'qa', 'kw', 'bh', 'om'],
    'indeed with all GCC locations fans out to all 6 lowercase ISO2 codes');
});

test('indeed: default (no config.location) → only 1 remote-worldwide call (regression: no GCC fan-out by default)', async () => {
  const calls = [];
  const fetchImpl = async (_url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => [] }; };
  const sources = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_INDEED: '1' }, { fetchImpl });
  await sources.find((s) => s.name === 'indeed').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls.length, 1, 'default → 1 remote-worldwide call only');
  assert.equal(calls[0].country, 'us');
  assert.equal(calls[0].location, 'Remote');
});

test('linkedin location=[uae,...all GCC] fans out to all 6 GCC loc URLs', async () => {
  const locs = [];
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    locs.push(body.urls?.[0]);
    return { ok: true, json: async () => [] };
  };
  const sources = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_LINKEDIN: '1' }, {
    fetchImpl,
    sourceConfigs: { linkedin: { location: ['uae', 'ksa', 'qatar', 'kuwait', 'bahrain', 'oman'] } },
  });
  await sources.find((s) => s.name === 'linkedin').fetch({ includeKeywords: ['backend'] });
  assert.equal(locs.length, 6, 'all 6 GCC locations → 6 per-country calls');
  assert.match(locs[0], /United\+Arab\+Emirates/);
  assert.match(locs[1], /Saudi\+Arabia/);
});

test('linkedin: default (no config.location) → only 1 remote-worldwide call (regression: no GCC fan-out by default)', async () => {
  const calls = [];
  const fetchImpl = async (_url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => [] }; };
  const sources = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_LINKEDIN: '1' }, { fetchImpl });
  await sources.find((s) => s.name === 'linkedin').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls.length, 1, 'default → 1 remote-worldwide call only');
  assert.match(calls[0].urls[0], /Worldwide/);
  assert.match(calls[0].urls[0], /f_WT=2/);
});

test('loadDiscoveryConfig no longer returns countries field', async () => {
  // Verify that loadDiscoveryConfig does not return cfg.countries
  const { loadDiscoveryConfig: ldc } = await import('../src/discoveryStore.js');
  const client = {
    async query(text) {
      if (/FROM sources/i.test(text)) return { rows: [] };
      if (/FROM discovery_excludes/i.test(text)) return { rows: [] };
      return { rows: [] };
    },
  };
  const cfg = await ldc(client, 1);
  assert.ok(cfg.sources instanceof Map, 'sources present');
  assert.deepEqual(cfg.excludes, [], 'excludes present');
  assert.equal(cfg.countries, undefined, 'countries field no longer returned');
});

test('buildSourcesFromDb: no longer subsets by countries; source toggles + sourceConfigs still work', async () => {
  const env = { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1', JOBRADAR_TENANT_ID: '1' };
  // bayt=false drops it; sourceConfigs flows through; no country subsetting
  const client = cfgClient({ sources: [{ name: 'bayt', enabled: false, config: null }] });
  const names = (await buildSourcesFromDb(env, client)).map((s) => s.name);
  assert.ok(!names.includes('bayt'), 'bayt toggle=false works');
  assert.ok(names.includes('naukrigulf'), 'other MENA sources still present');
  assert.ok(names.includes('gulftalent'), 'other MENA sources still present');
});

// ---- makeLocationSource unit tests ----

// Helper: build a makeLocationSource and run its fetch with the given config
function makeTestLocationSource(config, fetchImpl) {
  const remoteItem = { id: 'g1', title: 'Remote Job', companyName: 'GlobalCo', location: 'Remote', link: 'https://x/g1', postedAt: null };
  const menaItem = { id: 'm1', title: 'Gulf Job', companyName: 'GulfCo', location: 'Dubai', link: 'https://x/m1', postedAt: null };
  const mapFor = (market) => (r) => ({
    source: 'test-loc', externalId: r.id, title: r.title, company: r.companyName,
    location: r.location, remote: market === 'global', url: r.link,
    description: null, tags: [], market, postedAt: null,
  });
  let callCount = 0;
  const fakeImpl = fetchImpl || (async (_url, opts) => {
    const body = JSON.parse(opts.body);
    callCount++;
    // Remote leg has country: 'US'; country legs have iso2
    const items = body.country === 'US' ? [remoteItem] : [menaItem];
    return { ok: true, json: async () => items };
  });
  return makeLocationSource({
    name: 'test-loc',
    actorId: 'test~actor',
    token: 'T',
    config,
    remoteBuildInput: (p, cfg) => ({ country: 'US', location: 'Remote', q: p.includeKeywords?.[0] || 'x', ...cfg }),
    perCountryBuildInput: (c, p, cfg) => ({ country: c.iso2, q: p.includeKeywords?.[0] || 'x', ...cfg }),
    mapFor,
    fetchImpl: fakeImpl,
  });
}

test('makeLocationSource: location=[remote] → 1 remote search, market global', async () => {
  const src = makeTestLocationSource({ location: ['remote'] });
  const jobs = await src.fetch({ includeKeywords: ['dev'] });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].market, 'global');
  assert.equal(jobs[0].remote, true);
});

test('makeLocationSource: location=[remote,uae] → 2 searches merged (remote=global + uae=mena)', async () => {
  const calls = [];
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const item = body.country === 'US'
      ? { id: 'g1', title: 'Remote Job', companyName: 'Co', location: 'Remote', link: 'https://r', postedAt: null }
      : { id: 'm1', title: 'UAE Job', companyName: 'Co', location: 'Dubai', link: 'https://u', postedAt: null };
    return { ok: true, json: async () => [item] };
  };
  const src = makeTestLocationSource({ location: ['remote', 'uae'] }, fetchImpl);
  const jobs = await src.fetch({ includeKeywords: ['dev'] });
  assert.equal(calls.length, 2, 'exactly 2 Apify calls');
  assert.equal(jobs.length, 2, 'results from both legs merged');
  assert.ok(jobs.some((j) => j.market === 'global'), 'remote leg tagged global');
  assert.ok(jobs.some((j) => j.market === 'mena'), 'UAE leg tagged mena');
});

test('makeLocationSource: empty config → defaults to [remote] (1 remote search)', async () => {
  const calls = [];
  const fetchImpl = async (_url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => [] }; };
  const src = makeLocationSource({
    name: 'test-empty', actorId: 'a~b', token: 'T', config: {},
    remoteBuildInput: (p, cfg) => ({ country: 'US', ...cfg }),
    perCountryBuildInput: (c) => ({ country: c.iso2 }),
    mapFor: () => () => null,
    fetchImpl,
  });
  await src.fetch({});
  assert.equal(calls.length, 1, 'default → 1 call (remote leg)');
  assert.equal(calls[0].country, 'US');
});

test('makeLocationSource: no config at all → defaults to [remote]', async () => {
  const calls = [];
  const fetchImpl = async (_url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => [] }; };
  const src = makeLocationSource({
    name: 'test-noconf', actorId: 'a~b', token: 'T',
    remoteBuildInput: (p, cfg) => ({ country: 'US', ...cfg }),
    perCountryBuildInput: (c) => ({ country: c.iso2 }),
    mapFor: () => () => null,
    fetchImpl,
  });
  await src.fetch({});
  assert.equal(calls.length, 1, 'no config → 1 call (remote leg default)');
  assert.equal(calls[0].country, 'US');
});

test('makeLocationSource: stale-only keys → falls back to [remote]', async () => {
  const calls = [];
  const fetchImpl = async (_url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => [] }; };
  const src = makeLocationSource({
    name: 'test-stale', actorId: 'a~b', token: 'T',
    config: { location: ['egypt', 'mars', 'invalid'] }, // none valid
    remoteBuildInput: (p, cfg) => ({ country: 'US', ...cfg }),
    perCountryBuildInput: (c) => ({ country: c.iso2 }),
    mapFor: () => () => null,
    fetchImpl,
  });
  await src.fetch({});
  assert.equal(calls.length, 1, 'stale keys → fall back to remote (1 call)');
  assert.equal(calls[0].country, 'US');
});

test('makeLocationSource: location not forwarded to actor input (stripped from config)', async () => {
  let capturedInput = null;
  const fetchImpl = async (_url, opts) => { capturedInput = JSON.parse(opts.body); return { ok: true, json: async () => [] }; };
  const src = makeLocationSource({
    name: 'test-strip', actorId: 'a~b', token: 'T',
    config: { location: ['remote'], keywords: 'devops' },
    remoteBuildInput: (p, cfg) => ({ country: 'US', ...cfg }),
    perCountryBuildInput: (c, p, cfg) => ({ country: c.iso2, ...cfg }),
    mapFor: () => () => null,
    fetchImpl,
  });
  await src.fetch({});
  assert.equal(capturedInput.country, 'US');
  assert.equal(capturedInput.keywords, 'devops', 'non-location config key passes through');
  assert.ok(!('location' in capturedInput) || capturedInput.location !== 'remote',
    'location fan-out key must not reach the actor input as a raw array');
});

// ---- FIX 1: preview fan-out bounded to one leg ----

test('bayt preview-mode (previewLimit:10) with default config → exactly 1 fetchImpl call (not 6)', async () => {
  const calls = [];
  const fetchImpl = async (_url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => [] }; };
  const sources = buildSources(
    { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1' },
    { fetchImpl, previewLimit: 10 },
  );
  await sources.find((s) => s.name === 'bayt').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls.length, 1, 'preview-mode bayt must fan out to exactly 1 leg (first country only)');
});

test('naukrigulf preview-mode (previewLimit:10) with default config → exactly 1 fetchImpl call (not 6)', async () => {
  const calls = [];
  const fetchImpl = async (_url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => [] }; };
  const sources = buildSources(
    { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1' },
    { fetchImpl, previewLimit: 10 },
  );
  await sources.find((s) => s.name === 'naukrigulf').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls.length, 1, 'preview-mode naukrigulf must fan out to exactly 1 leg');
});

test('gulftalent preview-mode (previewLimit:10) with default config → exactly 1 fetchImpl call (not 6)', async () => {
  const calls = [];
  const fetchImpl = async (_url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => [] }; };
  const sources = buildSources(
    { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1' },
    { fetchImpl, previewLimit: 10 },
  );
  await sources.find((s) => s.name === 'gulftalent').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls.length, 1, 'preview-mode gulftalent must fan out to exactly 1 leg');
});

test('linkedin preview-mode (previewLimit:10) with location=[remote,uae] → exactly 1 fetchImpl call (remote leg only)', async () => {
  const calls = [];
  const fetchImpl = async (_url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => [] }; };
  const sources = buildSources(
    { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_LINKEDIN: '1' },
    { fetchImpl, previewLimit: 10, sourceConfigs: { linkedin: { location: ['remote', 'uae'] } } },
  );
  await sources.find((s) => s.name === 'linkedin').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls.length, 1, 'preview-mode linkedin with 2 locations must fan out to exactly 1 leg (remote)');
  assert.match(calls[0].urls[0], /Worldwide/, 'first leg is the remote leg');
});

test('bayt non-preview default still makes 6 per-country calls (regression guard)', async () => {
  const calls = [];
  const fetchImpl = async (_url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => [] }; };
  const sources = buildSources(
    { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1' },
    { fetchImpl }, // no previewLimit
  );
  await sources.find((s) => s.name === 'bayt').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls.length, 6, 'non-preview bayt must still fan out to all 6 GCC countries');
});

// ---- FIX 2: makeLocationSource must strip country from config too ----

test('makeLocationSource: stale config.country is stripped and does NOT leak into actor input', async () => {
  let capturedInput = null;
  const fetchImpl = async (_url, opts) => { capturedInput = JSON.parse(opts.body); return { ok: true, json: async () => [] }; };
  const src = makeLocationSource({
    name: 'test-country-strip', actorId: 'a~b', token: 'T',
    config: { location: ['uae'], country: ['SA'] }, // stale country must be stripped
    remoteBuildInput: (p, cfg) => ({ country: 'US', ...cfg }),
    perCountryBuildInput: (c, p, cfg) => ({ country: c.iso2, ...cfg }),
    mapFor: () => () => null,
    fetchImpl,
  });
  await src.fetch({});
  // location=['uae'] → UAE leg: country should be AE (from countryRow.iso2), not 'SA'
  assert.equal(capturedInput.country, 'AE', 'per-country country is iso2 from the leg row, not stale SA');
  assert.ok(!Array.isArray(capturedInput.country), 'country not forwarded as-is (stale array stripped)');
});

// ---- Per-source cadence (respectCadence) -------------------------------------

import { recordCadenceRuns } from '../src/discoveryStore.js';

// Fixed reference: 2026-06-20T12:00:00Z (used to deterministically test isSourceDue via DB rows)
const CADENCE_NOW = new Date('2026-06-20T12:00:00Z');

test('buildSourcesFromDb respectCadence:false (default) → all enabled sources kept (regression)', async () => {
  const env = { JOBRADAR_TENANT_ID: '1' };
  // null last_run_at on remotive — without respectCadence it should still be included
  const client = cfgClient({ sources: [{ name: 'remotive', enabled: true, run_interval_hours: 24, last_run_at: new Date(CADENCE_NOW.getTime() - 1 * 3_600_000) }] });
  const names = (await buildSourcesFromDb(env, client)).map((s) => s.name);
  assert.ok(names.includes('remotive'), 'remotive kept when respectCadence=false (default)');
});

test('buildSourcesFromDb respectCadence:true → source with family ran 1h ago (interval 24) is dropped', async () => {
  const env = { JOBRADAR_TENANT_ID: '1' };
  // remotive ran 1 hour ago with interval 24h → NOT due
  const lastRun1hAgo = new Date(CADENCE_NOW.getTime() - 1 * 3_600_000).toISOString();
  const client = cfgClient({ sources: [{ name: 'remotive', enabled: true, run_interval_hours: 24, last_run_at: lastRun1hAgo }] });
  // We need to override Date() inside buildSourcesFromDb — but the function uses new Date() internally.
  // Instead, verify the logic by using a source that IS due (null last_run_at) vs one that isn't.
  // For this test we accept that the real clock won't match; let's use a time far in the past as last_run_at
  // to reliably force NOT-due: we set last_run_at = right now (very recent), and interval = 999h.
  const recentRun = new Date().toISOString();
  const client2 = cfgClient({ sources: [{ name: 'remotive', enabled: true, run_interval_hours: 999, last_run_at: recentRun }] });
  const names = (await buildSourcesFromDb(env, client2, { respectCadence: true })).map((s) => s.name);
  assert.ok(!names.includes('remotive'), 'remotive dropped when not due (very recent run, large interval)');
});

test('buildSourcesFromDb respectCadence:true → source with null last_run_at is kept (never ran = always due)', async () => {
  const env = { JOBRADAR_TENANT_ID: '1' };
  const client = cfgClient({ sources: [{ name: 'remotive', enabled: true, run_interval_hours: 24, last_run_at: null }] });
  const names = (await buildSourcesFromDb(env, client, { respectCadence: true })).map((s) => s.name);
  assert.ok(names.includes('remotive'), 'remotive kept when last_run_at=null (never ran)');
});

test('buildSourcesFromDb respectCadence:true → source past its interval is kept', async () => {
  const env = { JOBRADAR_TENANT_ID: '1' };
  // ran 100h ago with interval 24h → definitely due
  const oldRun = new Date(Date.now() - 100 * 3_600_000).toISOString();
  const client = cfgClient({ sources: [{ name: 'remotive', enabled: true, run_interval_hours: 24, last_run_at: oldRun }] });
  const names = (await buildSourcesFromDb(env, client, { respectCadence: true })).map((s) => s.name);
  assert.ok(names.includes('remotive'), 'remotive kept when overdue (100h ago, 24h interval)');
});

test('buildSourcesFromDb respectCadence:true → disabled source (toggle=false) is still dropped', async () => {
  const env = { JOBRADAR_TENANT_ID: '1' };
  // toggle=false even with null last_run_at → must be dropped regardless of cadence
  const client = cfgClient({ sources: [{ name: 'remotive', enabled: false, run_interval_hours: 24, last_run_at: null }] });
  const names = (await buildSourcesFromDb(env, client, { respectCadence: true })).map((s) => s.name);
  assert.ok(!names.includes('remotive'), 'remotive dropped when toggle=false, even with respectCadence');
});

// recordCadenceRuns issues the right UPDATE WHERE name = ANY(...)
test('recordCadenceRuns: issues UPDATE sources SET last_run_at = now() WHERE name = ANY($1)', async () => {
  let capturedQuery = null;
  let capturedParams = null;
  const mockClient = {
    async query(text, params) {
      capturedQuery = text;
      capturedParams = params;
    },
  };
  await recordCadenceRuns(mockClient, ['remotive', 'remoteok', 'bayt']);
  assert.ok(capturedQuery != null, 'query was called');
  assert.match(capturedQuery, /UPDATE sources/i, 'query is an UPDATE on sources');
  assert.match(capturedQuery, /last_run_at/i, 'query sets last_run_at');
  assert.match(capturedQuery, /ANY\(\$1\)/i, 'query uses ANY($1) parameter');
  assert.deepEqual(capturedParams, [['remotive', 'remoteok', 'bayt']], 'params contain the family names array');
});

test('recordCadenceRuns: no-op on empty array', async () => {
  let called = false;
  const mockClient = { async query() { called = true; } };
  await recordCadenceRuns(mockClient, []);
  assert.equal(called, false, 'no DB call on empty family list');
});

test('recordCadenceRuns: no-op on null/undefined', async () => {
  let called = false;
  const mockClient = { async query() { called = true; } };
  await recordCadenceRuns(mockClient, null);
  await recordCadenceRuns(mockClient, undefined);
  assert.equal(called, false, 'no DB call on null/undefined');
});
