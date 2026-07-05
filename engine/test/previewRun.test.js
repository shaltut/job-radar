/**
 * T3 tests: runPreview — previews one capped source with filter flags, no DB writes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPreview } from '../src/previewRun.js';

// --- Sample jobs ---
// 13 "good" jobs (match keyword + pass quality), 1 red-flag (quality fails), 1 off-keyword (profile fails)
function makeSampleJobs() {
  const good = Array.from({ length: 13 }, (_, i) => ({
    source: 'upwork',
    externalId: String(i),
    title: `Backend Engineer ${i}`,
    company: `Co ${i}`,
    location: 'Remote',
    remote: true,
    url: `https://example.com/job/${i}`,
    description: 'build backend services',
    tags: ['backend', 'node'],
    market: 'global',
    postedAt: '2026-06-01T00:00:00.000Z',
  }));

  const redFlag = {
    source: 'upwork',
    externalId: 'rf',
    title: 'Sales Representative',
    company: 'Pyramid Co',
    location: 'Remote',
    remote: true,
    url: 'https://example.com/redflag',
    description: '100% commission only — unlimited earning potential!',
    tags: ['sales'],
    market: 'global',
    postedAt: '2026-06-01T00:00:00.000Z',
  };

  const offKeyword = {
    source: 'upwork',
    externalId: 'off',
    title: 'Graphic Designer',
    company: 'Design Co',
    location: 'Remote',
    remote: true,
    url: 'https://example.com/designer',
    description: 'create beautiful designs with Adobe tools',
    tags: ['design', 'photoshop'],
    market: 'global',
    postedAt: '2026-06-01T00:00:00.000Z',
  };

  return [...good, redFlag, offKeyword]; // 15 total
}

// --- Fake infrastructure ---

const fakeProfile = {
  includeKeywords: ['backend'],
  requireKeywords: [],
  excludeKeywords: [],
  remoteOnly: true,
};

const fakeCfg = { sources: null, countries: null, excludes: null };

function fakeLoadProfile() { return Promise.resolve(fakeProfile); }
function fakeLoadConfig() { return Promise.resolve(fakeCfg); }

function fakeSources(name, jobs) {
  return async (_env, _client, _opts) => [
    { name, market: 'global', fetch: async () => jobs },
  ];
}

// A client whose query throws on any INSERT (proves no DB write happens)
const noWriteClient = {
  async query(text) {
    if (/INSERT/i.test(text)) throw new Error('TEST FAIL: unexpected INSERT into jobs');
    // Return empty for any SELECT (config tables, etc.)
    return { rows: [] };
  },
};

// ---- Tests ----

test('runPreview slices to limit and returns correct shape', async () => {
  const jobs15 = makeSampleJobs(); // 15 jobs
  const getSources = fakeSources('upwork', jobs15);
  const r = await runPreview({
    client: noWriteClient,
    sourceName: 'upwork',
    limit: 10,
    env: {},
    loadProfileFn: fakeLoadProfile,
    loadConfigFn: fakeLoadConfig,
    getSources,
  });
  assert.equal(r.fetched, 10, 'fetched should be sliced to limit=10');
  assert.ok(Array.isArray(r.jobs), 'jobs should be an array');
  assert.equal(r.jobs.length, 10, 'jobs array should have 10 entries');
});

test('runPreview sets passesProfile correctly (off-keyword job fails)', async () => {
  const jobs15 = makeSampleJobs();
  // limit=15 so we get all jobs
  const getSources = fakeSources('upwork', jobs15);
  const r = await runPreview({
    client: noWriteClient,
    sourceName: 'upwork',
    limit: 15,
    env: {},
    loadProfileFn: fakeLoadProfile,
    loadConfigFn: fakeLoadConfig,
    getSources,
  });
  // the off-keyword job (Graphic Designer) should fail passesProfile
  const offJob = r.jobs.find((j) => j.url === 'https://example.com/designer');
  assert.ok(offJob, 'off-keyword job must be in results');
  assert.equal(offJob.passesProfile, false, 'graphic designer must NOT pass profile keyword filter');
  // a good job should pass
  const goodJob = r.jobs.find((j) => j.url === 'https://example.com/job/0');
  assert.ok(goodJob, 'good backend job must be in results');
  assert.equal(goodJob.passesProfile, true, 'backend engineer job must pass profile filter');
});

test('runPreview sets passesQuality + qualityReason correctly (red-flag job fails)', async () => {
  const jobs15 = makeSampleJobs();
  const getSources = fakeSources('upwork', jobs15);
  const r = await runPreview({
    client: noWriteClient,
    sourceName: 'upwork',
    limit: 15,
    env: {},
    loadProfileFn: fakeLoadProfile,
    loadConfigFn: fakeLoadConfig,
    getSources,
  });
  const rfJob = r.jobs.find((j) => j.url === 'https://example.com/redflag');
  assert.ok(rfJob, 'red-flag job must be in results');
  assert.equal(rfJob.passesQuality, false, 'commission-only job must fail quality');
  assert.ok(rfJob.qualityReason != null, 'qualityReason must be set on failed quality job');
  assert.match(rfJob.qualityReason, /commission/i, 'qualityReason should mention commission');
  // a good job should have passesQuality=true and qualityReason=null
  const goodJob = r.jobs.find((j) => j.url === 'https://example.com/job/0');
  assert.equal(goodJob.passesQuality, true);
  assert.equal(goodJob.qualityReason, null, 'qualityReason must be null when quality passes');
});

test('runPreview returns correct kept count', async () => {
  const jobs15 = makeSampleJobs();
  const getSources = fakeSources('upwork', jobs15);
  const r = await runPreview({
    client: noWriteClient,
    sourceName: 'upwork',
    limit: 15,
    env: {},
    loadProfileFn: fakeLoadProfile,
    loadConfigFn: fakeLoadConfig,
    getSources,
  });
  // 13 good (pass both) + 1 red-flag (fails quality) + 1 off-keyword (fails profile)
  // Sliced to 15 → all 15 present. kept = 13 (only the "good" ones)
  assert.equal(r.kept, 13, 'kept should be 13 (only jobs passing both filters)');
});

test('runPreview result shape has all required fields per job', async () => {
  const getSources = fakeSources('upwork', makeSampleJobs());
  const r = await runPreview({
    client: noWriteClient,
    sourceName: 'upwork',
    limit: 3,
    env: {},
    loadProfileFn: fakeLoadProfile,
    loadConfigFn: fakeLoadConfig,
    getSources,
  });
  for (const j of r.jobs) {
    assert.ok('title' in j, 'job must have title');
    assert.ok('company' in j, 'job must have company');
    assert.ok('location' in j, 'job must have location');
    assert.ok('url' in j, 'job must have url');
    assert.ok('postedAt' in j, 'job must have postedAt');
    assert.ok('tags' in j, 'job must have tags');
    assert.ok('passesProfile' in j, 'job must have passesProfile');
    assert.ok('passesQuality' in j, 'job must have passesQuality');
    assert.ok('qualityReason' in j, 'job must have qualityReason');
    assert.equal(typeof j.passesProfile, 'boolean');
    assert.equal(typeof j.passesQuality, 'boolean');
  }
});

test('runPreview falls back to family match when exact name absent', async () => {
  // Source is named 'bayt-uae' but sourceName is 'bayt' (family match via MENA suffix strip)
  const getSources = async (_env, _client, _opts) => [
    { name: 'bayt-uae', market: 'mena', fetch: async () => [makeSampleJobs()[0]] },
  ];
  const r = await runPreview({
    client: noWriteClient,
    sourceName: 'bayt',
    limit: 10,
    env: {},
    loadProfileFn: fakeLoadProfile,
    loadConfigFn: fakeLoadConfig,
    getSources,
  });
  assert.equal(r.fetched, 1, 'should pick the bayt-uae source via family match');
});

test('runPreview throws when source not active', async () => {
  const getSources = fakeSources('remotive', []);
  await assert.rejects(
    () => runPreview({
      client: noWriteClient,
      sourceName: 'nonexistent',
      limit: 10,
      env: {},
      loadProfileFn: fakeLoadProfile,
      loadConfigFn: fakeLoadConfig,
      getSources,
    }),
    /source not active: nonexistent/,
  );
});

test('runPreview does not write to jobs table (client INSERT throws)', async () => {
  // noWriteClient throws on INSERT — if upsertJobs were called, this test would fail
  const getSources = fakeSources('upwork', makeSampleJobs().slice(0, 5));
  // Should not throw (no INSERT attempted)
  const r = await runPreview({
    client: noWriteClient,
    sourceName: 'upwork',
    limit: 5,
    env: {},
    loadProfileFn: fakeLoadProfile,
    loadConfigFn: fakeLoadConfig,
    getSources,
  });
  assert.equal(r.fetched, 5, 'preview should complete without writing to DB');
});
