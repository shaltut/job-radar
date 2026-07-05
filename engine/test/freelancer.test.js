import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFreelancer } from '../src/sources/freelancer.js';

// A small synthetic Freelancer RSS with 2 items; the first has multiple <category> tags.
const FREELANCER_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Freelancer.com Projects</title>
<item>
  <title><![CDATA[Build a REST API in Node.js]]></title>
  <link>https://www.freelancer.com/projects/nodejs/build-a-rest-api</link>
  <guid isPermaLink="false">Freelancer_project_40522161</guid>
  <pubDate>Wed, 18 Jun 2026 10:00:00 +0000</pubDate>
  <description><![CDATA[Build a REST API (Budget: $100–$200, Jobs: Node.js, Express)]]></description>
  <category><![CDATA[Node.js]]></category>
  <category><![CDATA[REST API]]></category>
  <category><![CDATA[Express]]></category>
</item>
<item>
  <title><![CDATA[Design a landing page]]></title>
  <link>https://www.freelancer.com/projects/design/landing-page</link>
  <guid isPermaLink="false">Freelancer_project_40522200</guid>
  <pubDate>Tue, 17 Jun 2026 08:00:00 +0000</pubDate>
  <description><![CDATA[Design a landing page (Budget: $50–$100, Jobs: HTML, CSS)]]></description>
  <category><![CDATA[HTML]]></category>
</item>
</channel></rss>`;

function rssFetch(body) {
  return async () => ({ ok: true, text: async () => body });
}

test('fetchFreelancer maps RSS items to CanonicalJob[] (source, remote, market, location)', async () => {
  const jobs = await fetchFreelancer({}, rssFetch(FREELANCER_RSS));
  assert.equal(jobs.length, 2);
  for (const j of jobs) {
    assert.equal(j.source, 'freelancer');
    assert.equal(j.remote, true);
    assert.equal(j.market, 'global');
    assert.equal(j.location, 'Remote');
    assert.equal(j.company, null);
    assert.equal(typeof j.fetch, 'undefined');
  }
});

test('fetchFreelancer maps title from CDATA title tag', async () => {
  const jobs = await fetchFreelancer({}, rssFetch(FREELANCER_RSS));
  assert.equal(jobs[0].title, 'Build a REST API in Node.js');
  assert.equal(jobs[1].title, 'Design a landing page');
});

test('fetchFreelancer maps url from <link>', async () => {
  const jobs = await fetchFreelancer({}, rssFetch(FREELANCER_RSS));
  assert.equal(jobs[0].url, 'https://www.freelancer.com/projects/nodejs/build-a-rest-api');
  assert.equal(jobs[1].url, 'https://www.freelancer.com/projects/design/landing-page');
});

test('fetchFreelancer maps externalId from <guid> (whole string)', async () => {
  const jobs = await fetchFreelancer({}, rssFetch(FREELANCER_RSS));
  assert.equal(jobs[0].externalId, 'Freelancer_project_40522161');
  assert.equal(jobs[1].externalId, 'Freelancer_project_40522200');
});

test('fetchFreelancer maps postedAt from <pubDate> to ISO string', async () => {
  const jobs = await fetchFreelancer({}, rssFetch(FREELANCER_RSS));
  assert.equal(jobs[0].postedAt, new Date('Wed, 18 Jun 2026 10:00:00 +0000').toISOString());
  assert.equal(jobs[1].postedAt, new Date('Tue, 17 Jun 2026 08:00:00 +0000').toISOString());
});

test('fetchFreelancer maps description from CDATA description tag', async () => {
  const jobs = await fetchFreelancer({}, rssFetch(FREELANCER_RSS));
  assert.ok(jobs[0].description.includes('Budget'));
  assert.ok(jobs[0].description.includes('Node.js'));
});

test('fetchFreelancer collects multiple <category> values into tags array', async () => {
  const jobs = await fetchFreelancer({}, rssFetch(FREELANCER_RSS));
  // First item has 3 categories
  assert.deepEqual(jobs[0].tags, ['Node.js', 'REST API', 'Express']);
  // Second item has 1 category
  assert.deepEqual(jobs[1].tags, ['HTML']);
});

test('fetchFreelancer returns [] on non-ok response', async () => {
  const jobs = await fetchFreelancer({}, async () => ({ ok: false, status: 503 }));
  assert.deepEqual(jobs, []);
});

test('fetchFreelancer returns [] on fetch throw', async () => {
  const jobs = await fetchFreelancer({}, async () => { throw new Error('ECONNREFUSED'); });
  assert.deepEqual(jobs, []);
});

test('fetchFreelancer skips items missing required fields (title/url) via mapValid', async () => {
  const malformedRss = `<rss><channel>
<item>
  <title><![CDATA[Valid Project]]></title>
  <link>https://www.freelancer.com/projects/valid</link>
  <guid isPermaLink="false">Freelancer_project_99</guid>
</item>
<item>
  <!-- missing link/title → should be skipped -->
  <guid isPermaLink="false">Freelancer_project_00</guid>
</item>
</channel></rss>`;
  const jobs = await fetchFreelancer({}, rssFetch(malformedRss));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].externalId, 'Freelancer_project_99');
});
