import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSources } from '../src/sources/index.js';
import { dmyToISO, validateCanonical } from '../src/normalize.js';

// Regression fixtures captured from the REAL Apify actor outputs (verified 2026-06-18).
// Build one named source with a fetchImpl that (a) captures the request input and
// (b) returns the given dataset items; return the mapped jobs + the captured input.
async function runSource(name, env, items, { sourceConfigs } = {}) {
  let input = null;
  const fetchImpl = async (_url, opts) => { input = JSON.parse(opts.body); return { ok: true, json: async () => items }; };
  const src = buildSources(env, { fetchImpl, ...(sourceConfigs ? { sourceConfigs } : {}) }).find((s) => s.name === name);
  assert.ok(src, `source ${name} not built`);
  const jobs = await src.fetch({ includeKeywords: ['software engineer'] });
  return { jobs, input };
}

const MENA = { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MENA: '1' };

// ---- gulftalent: new actor uses keyword+location(city)+maxJobs; output uses job_id/date_posted/description_text/is_remote/category ----
test('gulftalent: input uses keyword+location(city)+maxJobs; output maps job_id/date_posted/category/is_remote', async () => {
  const item = {
    job_id: 'gt1', title: 'Software Engineer', company: 'ADGT', location: 'Abu Dhabi, UAE',
    description_text: 'build', url: 'https://www.gulftalent.com/uae/jobs/se-594218',
    date_posted: '2026-06-09T00:00:00+00:00', is_remote: false, category: 'IT', industry: 'Technology',
  };
  // Use config.country=['uae'] to fan out to just UAE → location=city='Dubai'
  const { jobs, input } = await runSource('gulftalent', MENA, [item], { sourceConfigs: { gulftalent: { country: ['uae'] } } });
  assert.equal(input.location, 'Dubai');                        // city, not ISO2
  assert.ok('keyword' in input, 'input has keyword key');
  assert.ok('maxJobs' in input, 'input has maxJobs key');
  assert.ok(!('country' in input), 'input must NOT have country key');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].externalId, 'gt1');                     // from job_id
  assert.equal(jobs[0].url, 'https://www.gulftalent.com/uae/jobs/se-594218');
  assert.equal(jobs[0].title, 'Software Engineer');
  assert.equal(jobs[0].postedAt, '2026-06-09T00:00:00.000Z');
  assert.deepEqual(jobs[0].tags, ['IT', 'Technology']);         // [category, industry]
  assert.equal(jobs[0].remote, false);                          // from is_remote
});

// ---- naukrigulf: new actor uses mode+query+location(country name)+maxResults; output uses jobId/keywords/postedAt/descriptionHtml ----
test('naukrigulf: input uses query+location(country name); output maps jobId/keywords/postedAt/descriptionHtml', async () => {
  const item = {
    jobId: 'ng1', title: 'Backend Engineer', company: 'Acme Gulf', location: 'Dubai',
    url: 'https://www.naukrigulf.com/job-1', descriptionHtml: '<p>build</p>', keywords: ['Node.js'],
    postedAt: '2026-06-10T00:00:00.000Z',
  };
  // Use config.country=['uae'] to fan out to just UAE → location=c.loc='United Arab Emirates'
  const { jobs, input } = await runSource('naukrigulf', MENA, [item], { sourceConfigs: { naukrigulf: { country: ['uae'] } } });
  assert.equal(input.location, 'United Arab Emirates');         // c.loc, not naukri short form
  assert.equal(input.mode, 'search');
  assert.ok('query' in input, 'input has query key');
  assert.ok(!('country' in input), 'input must NOT have country key');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].externalId, 'ng1');                     // from jobId
  assert.equal(jobs[0].postedAt, '2026-06-10T00:00:00.000Z');
  assert.deepEqual(jobs[0].tags, ['Node.js']);                  // from keywords
});

test('naukrigulf: ksa location uses full country name "Saudi Arabia"', async () => {
  const { input } = await runSource('naukrigulf', MENA, [], { sourceConfigs: { naukrigulf: { country: ['ksa'] } } });
  assert.equal(input.location, 'Saudi Arabia');                 // c.loc for ksa
});

// ---- wellfound: new actor uses keyword+results_wanted+proxyConfiguration; output uses id/applyUrl/postedDate/description_text/remote/primaryRoleTitle ----
test('wellfound: input uses keyword+results_wanted; output maps id/applyUrl/postedDate/description_text/remote/primaryRoleTitle', async () => {
  const item = {
    id: 'wf1', title: 'Senior ML Engineer', company: 'Empower',
    applyUrl: 'https://wellfound.com/jobs/4356198-x', companyUrl: 'https://wellfound.com/company/empower',
    description_text: 'build', location: 'South San Francisco', remote: true,
    postedDate: '2026-06-18T14:56:50.000Z', primaryRoleTitle: 'Machine Learning', jobType: 'Full-time',
  };
  const { jobs, input } = await runSource('wellfound', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_WELLFOUND: '1' }, [item]);
  assert.ok('keyword' in input, 'input has keyword key');
  assert.ok('results_wanted' in input, 'input has results_wanted key');
  assert.ok(!('enrichDetail' in input), 'input must NOT have enrichDetail key');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].externalId, 'wf1');                     // from id
  assert.equal(jobs[0].url, 'https://wellfound.com/jobs/4356198-x'); // from applyUrl
  assert.equal(jobs[0].location, 'South San Francisco');
  assert.equal(jobs[0].description, 'build');
  assert.equal(jobs[0].postedAt, '2026-06-18T14:56:50.000Z');  // from postedDate
  assert.deepEqual(jobs[0].tags, ['Machine Learning', 'Full-time']); // [primaryRoleTitle, jobType]
  assert.equal(jobs[0].remote, true);
});

// ---- wuzzuf: date_posted is DD/MM/YYYY (not US MM/DD) ----
test('wuzzuf: date_posted parsed as DD/MM/YYYY', async () => {
  const item = {
    title: 'Engineer', company: 'Roasty', location: 'Cairo, Egypt',
    url: 'https://wuzzuf.net/jobs/p/abc-engineer', description_text: 'build', skills: ['EE'],
    date_posted: '09/10/2025 15:18:30',
  };
  const { jobs } = await runSource('wuzzuf-uae', MENA, [item]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].postedAt, '2025-10-09T15:18:30.000Z');   // Oct 9 (DD/MM), not Sep 10 (MM/DD)
});

// ---- linkedin: industries is a STRING, not an array ----
test('linkedin: string industries becomes a single tag', async () => {
  const item = {
    id: 'li1', title: 'Data Analyst', companyName: 'Facebook', location: 'LA Metro',
    link: 'https://www.linkedin.com/jobs/view/li1', descriptionText: 'build',
    industries: 'Retail Office Equipment', postedAt: '2023-08-16',
  };
  const { jobs } = await runSource('linkedin', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_LINKEDIN: '1' }, [item]);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].tags, ['Retail Office Equipment']);  // [] before the string-industries fix
});

// ---- mostaql: input category=['development'], url←link, tags←category (array or string), postedAt null ----
test('mostaql: input has category=[development]; url from link; tags from category array; postedAt null', async () => {
  const item = {
    title: 'تطوير تطبيق ويب',
    description: 'نحتاج مطور لبناء تطبيق ويب',
    link: 'https://mostaql.com/projects/12345',
    budget: '500-1000 ر.س',
    hiring_rate: null,
    category: ['development', 'web'],
  };
  const { jobs, input } = await runSource('mostaql', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MOSTAQL: '1' }, [item]);
  assert.deepEqual(input.category, ['development']);              // actor input
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.equal(j.source, 'mostaql');
  assert.equal(j.externalId, null);
  assert.equal(j.title, 'تطوير تطبيق ويب');
  assert.equal(j.company, null);
  assert.equal(j.location, 'MENA');
  assert.equal(j.remote, true);
  assert.equal(j.url, 'https://mostaql.com/projects/12345');
  assert.equal(j.description, 'نحتاج مطور لبناء تطبيق ويب');
  assert.deepEqual(j.tags, ['development', 'web']);              // array category preserved
  assert.equal(j.market, 'mena');
  assert.equal(j.postedAt, null);
});

test('mostaql: string category becomes a single-element tags array', async () => {
  const item = {
    title: 'React Developer Needed',
    description: 'build a dashboard',
    link: 'https://mostaql.com/projects/99',
    category: 'development',
  };
  const { jobs } = await runSource('mostaql', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MOSTAQL: '1' }, [item]);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].tags, ['development']);
});

test('mostaql: null/missing category → empty tags array', async () => {
  const item = {
    title: 'Python Script',
    description: 'quick task',
    link: 'https://mostaql.com/projects/77',
    category: null,
  };
  const { jobs } = await runSource('mostaql', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MOSTAQL: '1' }, [item]);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].tags, []);
});

// ---- upwork: buildInput uses includeKeywords[0]; externalId←String(id); company←clientName; postedAt←absoluteDate ----
test('upwork: buildInput.query from includeKeywords[0]; externalId from id; company from clientName; postedAt from absoluteDate', async () => {
  const item = {
    id: 1234567890,
    title: 'Senior Node.js Developer',
    url: 'https://www.upwork.com/jobs/~01abc',
    description: 'Build a scalable backend service',
    clientName: 'TechStartup Inc',
    clientLocation: 'United States',
    tags: ['Node.js', 'PostgreSQL', 'REST API'],
    absoluteDate: '2026-06-18T14:00:00.000Z',
    relativeDate: '2 hours ago',
    budget: '$50/hr',
    experienceLevel: 'Expert',
  };
  const { jobs, input } = await runSource('upwork', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_UPWORK: '1' }, [item]);
  assert.equal(input.query, 'software engineer');                // from includeKeywords[0]
  assert.equal(input.page, 1);
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.equal(j.source, 'upwork');
  assert.equal(j.externalId, '1234567890');                     // String(r.id)
  assert.equal(j.title, 'Senior Node.js Developer');
  assert.equal(j.company, 'TechStartup Inc');                   // clientName
  assert.equal(j.location, 'United States');                    // clientLocation
  assert.equal(j.remote, true);
  assert.equal(j.url, 'https://www.upwork.com/jobs/~01abc');
  assert.equal(j.description, 'Build a scalable backend service');
  assert.deepEqual(j.tags, ['Node.js', 'PostgreSQL', 'REST API']);
  assert.equal(j.market, 'global');
  assert.equal(j.postedAt, '2026-06-18T14:00:00.000Z');        // absoluteDate wins
});

test('upwork: buildInput falls back to "software developer" when includeKeywords empty', async () => {
  let capturedInput = null;
  const fetchImpl = async (_url, opts) => { capturedInput = JSON.parse(opts.body); return { ok: true, json: async () => [] }; };
  const src = buildSources({ APIFY_TOKEN: 'k', JOBRADAR_ENABLE_UPWORK: '1' }, { fetchImpl }).find((s) => s.name === 'upwork');
  await src.fetch({});
  assert.equal(capturedInput.query, 'software developer');
});

test('upwork: null id → externalId null; missing clientLocation → "Remote"; postedAt from relativeDate if absoluteDate absent', async () => {
  const item = {
    id: null,
    title: 'Python Automation Script',
    url: 'https://www.upwork.com/jobs/~02xyz',
    description: 'automate workflow',
    clientName: null,
    clientLocation: null,
    tags: [],
    absoluteDate: null,
    relativeDate: '2026-06-17T09:00:00.000Z',
  };
  const { jobs } = await runSource('upwork', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_UPWORK: '1' }, [item]);
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.equal(j.externalId, null);
  assert.equal(j.company, null);
  assert.equal(j.location, 'Remote');
  assert.equal(j.postedAt, '2026-06-17T09:00:00.000Z');        // relativeDate used as fallback
});

// ---- upwork: sourceConfigs.upwork filters threaded into buildInput via applyFilters ----
const UPWORK_ENV = { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_UPWORK: '1' };

test('upwork: sourceConfigs.upwork with experienceLevel/jobType/advanced merged into actor input', async () => {
  const sourceConfigs = {
    upwork: { experienceLevel: ['expert'], jobType: ['hourly'], advanced: { paymentVerified: true } },
  };
  const { input } = await runSource('upwork', UPWORK_ENV, [], { sourceConfigs });
  assert.deepEqual(input.experienceLevel, ['expert']);
  assert.deepEqual(input.jobType, ['hourly']);
  assert.equal(input.paymentVerified, true);
  assert.equal(input.query, 'software engineer');   // defaults from profile keywords
  assert.equal(input.page, 1);
});

test('upwork: sourceConfigs.upwork with query overrides the profile default', async () => {
  const sourceConfigs = { upwork: { query: 'rust' } };
  const { input } = await runSource('upwork', UPWORK_ENV, [], { sourceConfigs });
  assert.equal(input.query, 'rust');
});

test('upwork: no sourceConfigs → input.query from profile, no extra keys', async () => {
  const { input } = await runSource('upwork', UPWORK_ENV, []);
  assert.equal(input.query, 'software engineer');
  assert.equal(input.page, 1);
  assert.equal('experienceLevel' in input, false);
  assert.equal('jobType' in input, false);
  assert.equal('paymentVerified' in input, false);
});

test('upwork: empty sourceConfigs.upwork → input unchanged (passthrough)', async () => {
  const { input } = await runSource('upwork', UPWORK_ENV, [], { sourceConfigs: { upwork: {} } });
  assert.equal(input.query, 'software engineer');
  assert.equal(input.page, 1);
  assert.equal('experienceLevel' in input, false);
});

// ---- per-source filter config: apifyMaps sourceConfigs wiring ----

// indeed: sourceConfigs.indeed merges title into buildInput; `location` is now the fan-out key
// (stripped from config before applyFilters), NOT an actor input override.
test('indeed: sourceConfigs.indeed with title overrides profile default; location fan-out key is stripped from actor input', async () => {
  // location (string) is NOT a valid fan-out key (must be array of remote/uae/...); defaults to ['remote']
  const { input } = await runSource('indeed', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_INDEED: '1' }, [], {
    sourceConfigs: { indeed: { title: 'rust engineer' } },
  });
  assert.equal(input.title, 'rust engineer');
  assert.equal(input.location, 'Remote');               // remote leg default — not overridden
  assert.equal(input.limit, 80);                        // hardcoded plumbing still present
});

test('indeed: location=[uae] sourceConfig fans out to UAE; country is lowercase iso2', async () => {
  // location=['uae'] → 1 per-country call for UAE; country is lowercase iso2
  const { input } = await runSource('indeed', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_INDEED: '1' }, [], {
    sourceConfigs: { indeed: { location: ['uae'] } },
  });
  assert.equal(input.country, 'ae');                    // lowercase iso2
});

test('indeed: empty sourceConfigs.indeed → input unchanged (passthrough)', async () => {
  const { input } = await runSource('indeed', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_INDEED: '1' }, [], {
    sourceConfigs: { indeed: {} },
  });
  assert.equal(input.title, 'software engineer');       // from includeKeywords[0]
  assert.equal(input.country, 'us');                    // lowercase iso2 for remote leg
  assert.equal(input.location, 'Remote');
});

// linkedin: sourceConfigs.linkedin merges count/scrapeCompany
test('linkedin: sourceConfigs.linkedin with count overrides env default', async () => {
  const { input } = await runSource('linkedin', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_LINKEDIN: '1' }, [], {
    sourceConfigs: { linkedin: { count: 100, scrapeCompany: true } },
  });
  assert.equal(input.count, 100);
  assert.equal(input.scrapeCompany, true);
  assert.ok(Array.isArray(input.urls) && input.urls.length === 1); // urls still built from profile
});

test('linkedin: empty sourceConfigs.linkedin → input unchanged', async () => {
  const { input } = await runSource('linkedin', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_LINKEDIN: '1' }, [], {
    sourceConfigs: { linkedin: {} },
  });
  assert.equal(input.count, 50);                        // env default (JOBRADAR_LINKEDIN_COUNT unset → 50)
  assert.ok(Array.isArray(input.urls));
});

// wellfound: sourceConfigs.wellfound merges keyword/remote/jobType/etc
test('wellfound: sourceConfigs.wellfound with keyword+remote+salaryMin merged in', async () => {
  const { input } = await runSource('wellfound', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_WELLFOUND: '1' }, [], {
    sourceConfigs: { wellfound: { keyword: 'rust', remote: true, salaryMin: 80000 } },
  });
  assert.equal(input.keyword, 'rust');
  assert.equal(input.remote, true);
  assert.equal(input.salaryMin, 80000);
  assert.equal(input.results_wanted, 80);               // hardcoded plumbing still present
  assert.ok(!('enrichDetail' in input), 'no enrichDetail key in new actor');
});

test('wellfound: empty sourceConfigs.wellfound → input unchanged', async () => {
  const { input } = await runSource('wellfound', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_WELLFOUND: '1' }, [], {
    sourceConfigs: { wellfound: {} },
  });
  assert.equal(input.keyword, 'software engineer');     // from includeKeywords[0]
  assert.equal(input.results_wanted, 80);
});

// gulftalent: sourceConfigs.gulftalent merges filter keys while keeping location=city
test('gulftalent: sourceConfigs.gulftalent with keyword+easyApplyOnly+fromDate merged in', async () => {
  // Use country=['uae'] to fan out to just UAE → location=city='Dubai'
  const { input } = await runSource('gulftalent', MENA, [], {
    sourceConfigs: { gulftalent: { country: ['uae'], keyword: 'devops', easyApplyOnly: true, fromDate: '2026-01-01' } },
  });
  assert.equal(input.keyword, 'devops');
  assert.equal(input.easyApplyOnly, true);
  assert.equal(input.fromDate, '2026-01-01');
  assert.equal(input.location, 'Dubai');                // city, not ISO2
  assert.equal(input.maxJobs, 80);
  assert.ok(!('country' in input), 'no country key in new actor input');
});

test('gulftalent: empty sourceConfigs.gulftalent with country=[ksa] → location=Riyadh (city)', async () => {
  const { input } = await runSource('gulftalent', MENA, [], {
    sourceConfigs: { gulftalent: { country: ['ksa'] } },
  });
  assert.equal(input.keyword, 'software engineer');
  assert.equal(input.location, 'Riyadh');               // ksa city
});

// naukrigulf: sourceConfigs.naukrigulf merges query/location(overrides c.loc when provided in cfg)
test('naukrigulf: sourceConfigs.naukrigulf with query+location (city override) merged in', async () => {
  // Use country=['uae'] to fan out to just UAE; location can be overridden by config
  const { input } = await runSource('naukrigulf', MENA, [], {
    sourceConfigs: { naukrigulf: { country: ['uae'], query: 'devops', location: 'Abu Dhabi' } },
  });
  assert.equal(input.query, 'devops');
  assert.equal(input.location, 'Abu Dhabi');            // config location overrides c.loc
  assert.equal(input.mode, 'search');
  assert.ok(!('country' in input), 'no country key in new actor input');
});

test('naukrigulf: empty sourceConfigs.naukrigulf with country=[ksa] → location=Saudi Arabia (c.loc)', async () => {
  const { input } = await runSource('naukrigulf', MENA, [], {
    sourceConfigs: { naukrigulf: { country: ['ksa'] } },
  });
  assert.equal(input.query, 'software engineer');
  assert.equal(input.location, 'Saudi Arabia');         // c.loc for ksa
});

// mostaql: sourceConfigs.mostaql.category overrides the hardcoded ['development']
test('mostaql: sourceConfigs.mostaql.category overrides hardcoded development default', async () => {
  const { input } = await runSource('mostaql', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MOSTAQL: '1' }, [], {
    sourceConfigs: { mostaql: { category: ['design', 'marketing'] } },
  });
  assert.deepEqual(input.category, ['design', 'marketing']);
});

test('mostaql: empty sourceConfigs.mostaql → category stays [development]', async () => {
  const { input } = await runSource('mostaql', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MOSTAQL: '1' }, [], {
    sourceConfigs: { mostaql: {} },
  });
  assert.deepEqual(input.category, ['development']);
});

test('mostaql: no sourceConfigs → category stays [development]', async () => {
  const { input } = await runSource('mostaql', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_MOSTAQL: '1' }, []);
  assert.deepEqual(input.category, ['development']);
});

// ---- dmyToISO helper ----
test('dmyToISO parses DD/MM/YYYY (with/without time), day>12, and falls back for ISO input', () => {
  assert.equal(dmyToISO('09/10/2025 15:18:30'), '2025-10-09T15:18:30.000Z');
  assert.equal(dmyToISO('25/10/2025 00:00:00'), '2025-10-25T00:00:00.000Z');
  assert.equal(dmyToISO('05/03/2026'), '2026-03-05T00:00:00.000Z');
  assert.equal(dmyToISO('2026-06-09T00:00:00.000Z'), '2026-06-09T00:00:00.000Z'); // fallback to toISOOrNull
  assert.equal(dmyToISO(null), null);
});

// ---- T2: SOURCE_LIMIT_KEYS + previewLimit ----

import { SOURCE_LIMIT_KEYS } from '../src/sources/index.js';

test('SOURCE_LIMIT_KEYS has the expected count keys per family', () => {
  assert.equal(SOURCE_LIMIT_KEYS.indeed, 'limit');
  assert.equal(SOURCE_LIMIT_KEYS.wellfound, 'results_wanted');
  assert.equal(SOURCE_LIMIT_KEYS.naukrigulf, 'maxResults');
  assert.equal(SOURCE_LIMIT_KEYS.gulftalent, 'maxJobs');
  assert.equal(SOURCE_LIMIT_KEYS.bayt, 'results_wanted');
  assert.equal(SOURCE_LIMIT_KEYS.wuzzuf, 'results_wanted');
  assert.equal(SOURCE_LIMIT_KEYS.linkedin, 'count');
  assert.equal(SOURCE_LIMIT_KEYS.upwork, null);
  assert.equal(SOURCE_LIMIT_KEYS.mostaql, null);
});

test('previewLimit:10 sets limit:10 on the indeed source', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => [] }; };
  const sources = buildSources(
    { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_INDEED: '1' },
    { fetchImpl, previewLimit: 10 },
  );
  await sources.find((s) => s.name === 'indeed').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls[0].limit, 10, 'indeed limit should be capped to previewLimit');
});

test('previewLimit:10 sets results_wanted:10 on the wellfound source', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => [] }; };
  const sources = buildSources(
    { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_WELLFOUND: '1' },
    { fetchImpl, previewLimit: 10 },
  );
  await sources.find((s) => s.name === 'wellfound').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls[0].results_wanted, 10, 'wellfound results_wanted should be capped to previewLimit');
});

test('previewLimit:10 — count-less source (upwork) input is unchanged (no extra key injected)', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => [] }; };
  const sources = buildSources(
    { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_UPWORK: '1' },
    { fetchImpl, previewLimit: 10 },
  );
  await sources.find((s) => s.name === 'upwork').fetch({ includeKeywords: ['backend'] });
  assert.ok(!('maxItems' in calls[0]), 'no maxItems on upwork');
  assert.ok(!('maxResults' in calls[0]), 'no maxResults on upwork');
  assert.ok(!('count' in calls[0]), 'no count on upwork');
  assert.ok(!('results_wanted' in calls[0]), 'no results_wanted on upwork');
});

test('no previewLimit — indeed limit stays at default 80 (regression)', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => [] }; };
  const sources = buildSources(
    { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_INDEED: '1' },
    { fetchImpl },
  );
  await sources.find((s) => s.name === 'indeed').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls[0].limit, 80, 'no previewLimit → default limit:80 preserved');
});

// ---- Map unit tests: representative raw item → CanonicalJob fields + validateCanonical passes ----

test('naukrigulfMap: maps representative live item; validateCanonical passes', async () => {
  const item = {
    jobId: 'ng42', jobKey: 'ng-key', title: 'Software Engineer', company: 'GulfTech',
    location: 'Dubai, UAE', url: 'https://www.naukrigulf.com/jobs/ng42',
    description: 'Build great things', descriptionHtml: '<p>Build great things</p>',
    keywords: ['JavaScript', 'Node.js'], locationType: 'Remote',
    postedAt: '2026-06-15T08:00:00.000Z',
  };
  const { jobs } = await runSource('naukrigulf', MENA, [item], { sourceConfigs: { naukrigulf: { country: ['uae'] } } });
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.equal(j.source, 'naukrigulf');
  assert.equal(j.externalId, 'ng42');                   // jobId wins over jobKey
  assert.equal(j.title, 'Software Engineer');
  assert.equal(j.company, 'GulfTech');
  assert.equal(j.location, 'Dubai, UAE');
  assert.equal(j.remote, true);                         // locationType === 'Remote'
  assert.equal(j.url, 'https://www.naukrigulf.com/jobs/ng42');
  assert.equal(j.description, 'Build great things');    // description field used first
  assert.deepEqual(j.tags, ['JavaScript', 'Node.js']);  // from keywords
  assert.equal(j.market, 'mena');
  assert.equal(j.postedAt, '2026-06-15T08:00:00.000Z');
  assert.doesNotThrow(() => validateCanonical(j));
});

test('naukrigulfMap: falls back to descriptionHtml strip when description absent', async () => {
  const item = {
    jobId: 'ng99', title: 'Backend Dev', company: 'Co', location: 'Riyadh',
    url: 'https://www.naukrigulf.com/jobs/ng99',
    descriptionHtml: '<p>Build APIs</p>', keywords: [], postedAt: null,
  };
  const { jobs } = await runSource('naukrigulf', MENA, [item], { sourceConfigs: { naukrigulf: { country: ['ksa'] } } });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].description, 'Build APIs');      // stripped from descriptionHtml
  assert.equal(jobs[0].remote, false);                  // locationType undefined → false
  assert.equal(jobs[0].postedAt, null);
  assert.doesNotThrow(() => validateCanonical(jobs[0]));
});

test('gulftalentMap: maps representative live item; validateCanonical passes', async () => {
  const item = {
    job_id: 'gt100', title: 'Senior DevOps Engineer', company: 'CloudCo',
    location: 'Riyadh, Saudi Arabia', url: 'https://www.gulftalent.com/jobs/gt100',
    description_text: 'Own the infrastructure', description_html: '<p>Own the infrastructure</p>',
    date_posted: '2026-06-10T12:00:00+00:00', is_remote: true,
    category: 'DevOps', industry: 'Cloud Computing',
  };
  const { jobs } = await runSource('gulftalent', MENA, [item], { sourceConfigs: { gulftalent: { country: ['ksa'] } } });
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.equal(j.source, 'gulftalent');
  assert.equal(j.externalId, 'gt100');                  // from job_id
  assert.equal(j.title, 'Senior DevOps Engineer');
  assert.equal(j.company, 'CloudCo');
  assert.equal(j.location, 'Riyadh, Saudi Arabia');
  assert.equal(j.remote, true);                         // from is_remote
  assert.equal(j.url, 'https://www.gulftalent.com/jobs/gt100');
  assert.equal(j.description, 'Own the infrastructure'); // description_text used first
  assert.deepEqual(j.tags, ['DevOps', 'Cloud Computing']); // [category, industry]
  assert.equal(j.market, 'mena');
  assert.equal(j.postedAt, '2026-06-10T12:00:00.000Z');
  assert.doesNotThrow(() => validateCanonical(j));
});

test('gulftalentMap: falls back to description_html strip; null category/industry → empty tags', async () => {
  const item = {
    job_id: 'gt101', title: 'QA Engineer', company: null, location: 'Doha',
    url: 'https://www.gulftalent.com/jobs/gt101',
    description_html: '<p>Test everything</p>', date_posted: null,
    is_remote: false, category: null, industry: null,
  };
  const { jobs } = await runSource('gulftalent', MENA, [item], { sourceConfigs: { gulftalent: { country: ['qatar'] } } });
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.equal(j.description, 'Test everything');       // stripped from description_html
  assert.deepEqual(j.tags, []);                         // null category+industry filtered out
  assert.equal(j.postedAt, null);
  assert.doesNotThrow(() => validateCanonical(j));
});

test('indeedMap: maps representative live item with employer object + jobTypes; validateCanonical passes', async () => {
  const item = {
    key: 'ind50', refNum: 'ref-50', title: 'Full Stack Engineer',
    employer: { name: 'TechCorp', logo: 'https://img/logo.png' },
    location: { city: 'Dubai', countryName: 'United Arab Emirates' },
    url: 'https://ae.indeed.com/viewjob?jk=ind50', description: 'Build full stack apps',
    jobTypes: { A: 'Permanent', B: 'Full-time' }, datePublished: '2026-06-12T09:00:00.000Z',
  };
  // Remote leg (default) → market=global, remote=true
  const { jobs } = await runSource('indeed', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_INDEED: '1' }, [item]);
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.equal(j.source, 'indeed');
  assert.equal(j.externalId, 'ind50');                  // key wins over refNum
  assert.equal(j.title, 'Full Stack Engineer');
  assert.equal(j.company, 'TechCorp');                  // employer.name
  assert.equal(j.location, 'Dubai, United Arab Emirates'); // city + countryName joined
  assert.equal(j.remote, true);                         // global leg
  assert.equal(j.url, 'https://ae.indeed.com/viewjob?jk=ind50');
  assert.equal(j.description, 'Build full stack apps');
  assert.deepEqual(j.tags, ['Permanent', 'Full-time']); // Object.values(jobTypes)
  assert.equal(j.market, 'global');
  assert.equal(j.postedAt, '2026-06-12T09:00:00.000Z');
  assert.doesNotThrow(() => validateCanonical(j));
});

test('indeedMap: string employer + missing location + dateOnIndeed fallback; validateCanonical passes', async () => {
  const item = {
    key: 'ind51', title: 'Data Analyst', employer: 'DataCo',
    location: null, url: 'https://uk.indeed.com/viewjob?jk=ind51',
    description: 'Analyse data', jobTypes: null, dateOnIndeed: '2026-06-01T00:00:00.000Z',
  };
  const { jobs } = await runSource('indeed', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_INDEED: '1' }, [item]);
  const j = jobs[0];
  assert.equal(j.company, 'DataCo');                    // string employer
  assert.equal(j.location, 'Remote');                   // global leg default when location null
  assert.deepEqual(j.tags, []);                         // null jobTypes → []
  assert.equal(j.postedAt, '2026-06-01T00:00:00.000Z'); // dateOnIndeed fallback
  assert.doesNotThrow(() => validateCanonical(j));
});

test('wellfoundMap: maps representative live item; validateCanonical passes', async () => {
  const item = {
    id: 'wf200', title: 'Founding ML Engineer', company: 'SeedAI',
    location: 'San Francisco, CA', applyUrl: 'https://wellfound.com/jobs/wf200',
    companyUrl: 'https://wellfound.com/company/seedai',
    description_text: 'Build the future of AI', description_html: '<p>Build the future of AI</p>',
    remote: true, primaryRoleTitle: 'Machine Learning', jobType: 'Full-time',
    postedDate: 1781860288,  // real actor format: Unix timestamp in SECONDS
  };
  const { jobs } = await runSource('wellfound', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_WELLFOUND: '1' }, [item]);
  assert.equal(jobs.length, 1);
  const j = jobs[0];
  assert.equal(j.source, 'wellfound');
  assert.equal(j.externalId, 'wf200');                  // from id
  assert.equal(j.title, 'Founding ML Engineer');
  assert.equal(j.company, 'SeedAI');
  assert.equal(j.location, 'San Francisco, CA');
  assert.equal(j.remote, true);                         // from remote
  assert.equal(j.url, 'https://wellfound.com/jobs/wf200'); // applyUrl wins over companyUrl
  assert.equal(j.description, 'Build the future of AI'); // description_text used first
  assert.deepEqual(j.tags, ['Machine Learning', 'Full-time']); // [primaryRoleTitle, jobType]
  assert.equal(j.market, 'global');
  assert.ok(j.postedAt && j.postedAt.startsWith('2026-'), 'seconds timestamp → 2026 ISO (not 1970): ' + j.postedAt);
  assert.doesNotThrow(() => validateCanonical(j));
});

test('wellfoundMap: falls back to companyUrl when applyUrl absent; html strip when description_text absent', async () => {
  const item = {
    id: 'wf201', title: 'Backend Engineer', company: 'StartupX',
    applyUrl: null, companyUrl: 'https://wellfound.com/company/startupx',
    description_html: '<p>Backend work</p>', location: null,
    remote: false, primaryRoleTitle: null, jobType: null,
    postedDate: null,
  };
  const { jobs } = await runSource('wellfound', { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_WELLFOUND: '1' }, [item]);
  const j = jobs[0];
  assert.equal(j.url, 'https://wellfound.com/company/startupx'); // companyUrl fallback
  assert.equal(j.description, 'Backend work');           // stripped from description_html
  assert.deepEqual(j.tags, []);                          // null primaryRoleTitle+jobType filtered out
  assert.equal(j.location, null);
  assert.equal(j.remote, false);
  assert.equal(j.postedAt, null);
  assert.doesNotThrow(() => validateCanonical(j));
});

test('no previewLimit — wellfound results_wanted stays at default 80 (regression)', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => [] }; };
  const sources = buildSources(
    { APIFY_TOKEN: 'k', JOBRADAR_ENABLE_WELLFOUND: '1' },
    { fetchImpl },
  );
  await sources.find((s) => s.name === 'wellfound').fetch({ includeKeywords: ['backend'] });
  assert.equal(calls[0].results_wanted, 80, 'no previewLimit → default results_wanted:80 preserved');
});
