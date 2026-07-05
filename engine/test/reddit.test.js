import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchReddit } from '../src/sources/reddit.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLIENT_ID = 'test_client_id';
const CLIENT_SECRET = 'test_client_secret';
const EXPECTED_BASIC = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
const TOKEN = 'TKN';

// ---------------------------------------------------------------------------
// Fake payload
// ---------------------------------------------------------------------------

// A listing with:
//   post A — [Hiring] tag in title (included)
//   post B — [For Hire] tag in title (excluded — worker, not employer)
//   post C — flair "Hiring" (included)
//   post D — flair "For Hire" (excluded — but also has no [hiring] tag)
//   post E — remote [Hiring] post (included; check remote=true)
const LISTING = {
  data: {
    children: [
      {
        data: {
          id: 'a1b2c3',
          title: '[Hiring] Senior Backend Engineer | $150k | NYC',
          selftext: 'We are looking for a talented backend engineer.',
          permalink: '/r/forhire/comments/a1b2c3/hiring_senior_backend_engineer/',
          link_flair_text: null,
          created_utc: 1750000000,
        },
      },
      {
        data: {
          id: 'x9y8z7',
          title: '[For Hire] Freelance React Developer',
          selftext: 'I am a React developer looking for work.',
          permalink: '/r/forhire/comments/x9y8z7/for_hire_freelance_react_developer/',
          link_flair_text: 'For Hire',
          created_utc: 1750001000,
        },
      },
      {
        data: {
          id: 'f3g4h5',
          title: 'DevOps Lead — Remote — contract/full-time',
          selftext: 'We are hiring a DevOps engineer to work fully remote.',
          permalink: '/r/forhire/comments/f3g4h5/devops_lead_remote/',
          link_flair_text: 'Hiring',
          created_utc: 1750002000,
        },
      },
      {
        data: {
          id: 'p0q1r2',
          title: 'UI/UX Designer portfolio',
          selftext: 'Portfolio post by a designer.',
          permalink: '/r/forhire/comments/p0q1r2/ui_ux_designer/',
          link_flair_text: 'For Hire',
          created_utc: 1750003000,
        },
      },
      {
        data: {
          id: 'r9s8t7',
          title: '[HIRING] Remote Senior Data Scientist',
          selftext: 'Looking for remote data scientists globally.',
          permalink: '/r/forhire/comments/r9s8t7/hiring_senior_data_scientist/',
          link_flair_text: null,
          created_utc: 1750004000,
        },
      },
    ],
  },
};

// Token response fixture
const TOKEN_RESPONSE = {
  access_token: TOKEN,
  token_type: 'bearer',
  expires_in: 3600,
};

// ---------------------------------------------------------------------------
// Credential setup/teardown helpers
// ---------------------------------------------------------------------------

function setCredentials() {
  process.env.REDDIT_CLIENT_ID = CLIENT_ID;
  process.env.REDDIT_CLIENT_SECRET = CLIENT_SECRET;
}

function clearCredentials() {
  delete process.env.REDDIT_CLIENT_ID;
  delete process.env.REDDIT_CLIENT_SECRET;
}

// ---------------------------------------------------------------------------
// Dual-endpoint fake fetch
// ---------------------------------------------------------------------------

/**
 * Build a fake fetchImpl that handles both endpoints:
 *   POST .../api/v1/access_token → token response
 *   GET  oauth.reddit.com/r/.../new → LISTING (or custom listingPayload)
 *
 * Options:
 *   tokenFail   — token endpoint returns { ok: false }
 *   tokenThrow  — token endpoint throws
 *   listingPayload — override the listing JSON (default LISTING)
 *   captureReqs — array to push { url, opts } into
 */
function makeFetch({
  tokenFail = false,
  tokenThrow = false,
  listingPayload = LISTING,
  captureReqs = null,
} = {}) {
  return async (url, opts) => {
    if (captureReqs) captureReqs.push({ url, opts });

    if (url.includes('/api/v1/access_token')) {
      if (tokenThrow) throw new Error('token network error');
      if (tokenFail) return { ok: false, status: 401 };
      return { ok: true, json: async () => TOKEN_RESPONSE };
    }

    // listing endpoint
    return { ok: true, json: async () => listingPayload };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Set up credentials before each test; tear down after.
beforeEach(setCredentials);
afterEach(clearCredentials);

// --- OAuth token request assertions ---

test('fetchReddit POSTs token with Basic auth, grant_type, and User-Agent', async () => {
  const reqs = [];
  await fetchReddit({}, makeFetch({ captureReqs: reqs }));

  const tokenReq = reqs.find((r) => r.url.includes('/api/v1/access_token'));
  assert.ok(tokenReq, 'should POST to access_token endpoint');
  assert.equal(tokenReq.opts.method, 'POST');
  assert.equal(
    tokenReq.opts.headers.Authorization,
    `Basic ${EXPECTED_BASIC}`,
    'Authorization header must be Basic base64(id:secret)',
  );
  assert.equal(tokenReq.opts.body, 'grant_type=client_credentials');
  assert.ok(
    typeof tokenReq.opts.headers['User-Agent'] === 'string' &&
      tokenReq.opts.headers['User-Agent'].startsWith('job-radar/'),
    'token request must include User-Agent',
  );
});

// --- Listing request assertions ---

test('fetchReddit fetches listings from oauth.reddit.com with Bearer token', async () => {
  const reqs = [];
  await fetchReddit({}, makeFetch({ captureReqs: reqs }));

  const listingReq = reqs.find((r) => r.url.includes('oauth.reddit.com'));
  assert.ok(listingReq, 'should fetch from oauth.reddit.com');
  assert.equal(listingReq.opts.headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(
    typeof listingReq.opts.headers['User-Agent'] === 'string' &&
      listingReq.opts.headers['User-Agent'].startsWith('job-radar/'),
    'listing request must include User-Agent',
  );
});

// --- No-credentials guard ---

test('fetchReddit returns [] and makes NO fetch when REDDIT_CLIENT_ID is missing', async () => {
  delete process.env.REDDIT_CLIENT_ID;
  let called = false;
  const spy = async () => {
    called = true;
    return { ok: true, json: async () => TOKEN_RESPONSE };
  };
  const result = await fetchReddit({}, spy);
  assert.deepEqual(result, []);
  assert.equal(called, false, 'fetch must not be called with no client id');
});

test('fetchReddit returns [] and makes NO fetch when REDDIT_CLIENT_SECRET is missing', async () => {
  delete process.env.REDDIT_CLIENT_SECRET;
  let called = false;
  const spy = async () => {
    called = true;
    return { ok: true, json: async () => TOKEN_RESPONSE };
  };
  const result = await fetchReddit({}, spy);
  assert.deepEqual(result, []);
  assert.equal(called, false, 'fetch must not be called with no client secret');
});

test('fetchReddit returns [] and makes NO fetch when both credentials are missing', async () => {
  clearCredentials();
  let called = false;
  const spy = async () => {
    called = true;
  };
  const result = await fetchReddit({}, spy);
  assert.deepEqual(result, []);
  assert.equal(called, false);
});

// --- Token failure tolerance ---

test('fetchReddit returns [] when token request returns non-ok', async () => {
  const result = await fetchReddit({}, makeFetch({ tokenFail: true }));
  assert.deepEqual(result, []);
});

test('fetchReddit returns [] when token request throws', async () => {
  const result = await fetchReddit({}, makeFetch({ tokenThrow: true }));
  assert.deepEqual(result, []);
});

test('fetchReddit returns [] when token response has no access_token field', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/api/v1/access_token')) {
      return { ok: true, json: async () => ({ error: 'invalid_client' }) };
    }
    return { ok: true, json: async () => LISTING };
  };
  const result = await fetchReddit({}, fetchImpl);
  assert.deepEqual(result, []);
});

// --- Filtering ---

test('fetchReddit includes [Hiring] tag posts and flair-Hiring posts', async () => {
  const jobs = await fetchReddit({}, makeFetch());
  const ids = jobs.map((j) => j.externalId);
  assert.ok(ids.includes('a1b2c3'), 'should include [Hiring] tag post');
  assert.ok(ids.includes('f3g4h5'), 'should include flair-Hiring post');
  assert.ok(ids.includes('r9s8t7'), 'should include [HIRING] (uppercase) post');
});

test('fetchReddit excludes [For Hire] posts', async () => {
  const jobs = await fetchReddit({}, makeFetch());
  const ids = jobs.map((j) => j.externalId);
  assert.ok(!ids.includes('x9y8z7'), 'should exclude [For Hire] tag post');
  assert.ok(!ids.includes('p0q1r2'), 'should exclude For Hire flair post');
  assert.equal(jobs.length, 3);
});

// --- Field mapping ---

test('fetchReddit strips [Hiring] tag from title', async () => {
  const jobs = await fetchReddit({}, makeFetch());
  const a = jobs.find((j) => j.externalId === 'a1b2c3');
  assert.equal(a.title, 'Senior Backend Engineer | $150k | NYC');
  // HIRING uppercase stripped too
  const r = jobs.find((j) => j.externalId === 'r9s8t7');
  assert.equal(r.title, 'Remote Senior Data Scientist');
});

test('fetchReddit builds URL from Reddit permalink', async () => {
  const jobs = await fetchReddit({}, makeFetch());
  const a = jobs.find((j) => j.externalId === 'a1b2c3');
  assert.equal(
    a.url,
    'https://www.reddit.com/r/forhire/comments/a1b2c3/hiring_senior_backend_engineer/',
  );
});

test('fetchReddit detects remote from title and selftext', async () => {
  const jobs = await fetchReddit({}, makeFetch());
  // post f3g4h5 has "remote" in selftext
  const f = jobs.find((j) => j.externalId === 'f3g4h5');
  assert.equal(f.remote, true);
  // post a1b2c3 has neither title remote nor selftext remote
  const a = jobs.find((j) => j.externalId === 'a1b2c3');
  assert.equal(a.remote, false);
  // post r9s8t7 has "Remote" in title (after stripping [HIRING])
  const r = jobs.find((j) => j.externalId === 'r9s8t7');
  assert.equal(r.remote, true);
});

test('fetchReddit sets correct CanonicalJob fields', async () => {
  const jobs = await fetchReddit({}, makeFetch());
  const j = jobs.find((j) => j.externalId === 'a1b2c3');
  assert.equal(j.source, 'reddit');
  assert.equal(j.company, null);
  assert.equal(j.market, 'global');
  assert.deepEqual(j.tags, []);
  assert.equal(j.postedAt, new Date(1750000000 * 1000).toISOString());
});

// --- Network resilience ---

test('fetchReddit returns [] on listing network failure (per-sub tolerance)', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/api/v1/access_token'))
      return { ok: true, json: async () => TOKEN_RESPONSE };
    throw new Error('network error');
  };
  const jobs = await fetchReddit({}, fetchImpl);
  assert.deepEqual(jobs, []);
});

test('fetchReddit continues on non-ok listing response', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/api/v1/access_token'))
      return { ok: true, json: async () => TOKEN_RESPONSE };
    return { ok: false, status: 429 };
  };
  assert.deepEqual(await fetchReddit({}, fetchImpl), []);
});

test('fetchReddit tolerates a subreddit failure and continues with others', async () => {
  const saved = process.env.JOBRADAR_REDDIT_SUBS;
  process.env.JOBRADAR_REDDIT_SUBS = 'forhire,othersub';
  const fetchImpl = async (url) => {
    if (url.includes('/api/v1/access_token'))
      return { ok: true, json: async () => TOKEN_RESPONSE };
    if (url.includes('forhire')) return { ok: true, json: async () => LISTING };
    throw new Error('othersub is down');
  };
  const jobs = await fetchReddit({}, fetchImpl);
  process.env.JOBRADAR_REDDIT_SUBS = saved;
  // forhire contributed 3 valid jobs; othersub threw → []
  assert.equal(jobs.length, 3);
});

test('fetchReddit reads subreddits from JOBRADAR_REDDIT_SUBS', async () => {
  const saved = process.env.JOBRADAR_REDDIT_SUBS;
  process.env.JOBRADAR_REDDIT_SUBS = 'cscareerquestions, techjobs';
  const fetched = [];
  const fetchImpl = async (url) => {
    if (url.includes('/api/v1/access_token'))
      return { ok: true, json: async () => TOKEN_RESPONSE };
    fetched.push(url);
    return { ok: true, json: async () => ({ data: { children: [] } }) };
  };
  await fetchReddit({}, fetchImpl);
  process.env.JOBRADAR_REDDIT_SUBS = saved;
  assert.equal(fetched.length, 2);
  assert.ok(fetched[0].includes('cscareerquestions'));
  assert.ok(fetched[1].includes('techjobs'));
});
