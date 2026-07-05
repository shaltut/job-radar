import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDiscover } from '../src/discover.js';

test('runDiscover fetches all sources, filters, and upserts; returns counts', async () => {
  const sources = [
    { name: 'a', market: 'global', fetch: async () => ([
      { source: 'a', title: 'DevOps Engineer', url: 'https://x/1', market: 'global', tags: ['devops'], company: 'C', location: 'R', remote: true, externalId: '1', description: '', postedAt: null },
      { source: 'a', title: 'Chef', url: 'https://x/2', market: 'global', tags: [], company: 'C', location: 'R', remote: true, externalId: '2', description: 'cooking', postedAt: null },
    ]) },
  ];
  const upserted = [];
  const fakeClient = { async query() { return { rows: [] }; } };
  const result = await runDiscover({
    sources,
    profile: { includeKeywords: ['devops'], excludeKeywords: [], remoteOnly: false },
    client: fakeClient,
    upsert: async (_c, jobs) => { upserted.push(...jobs); return jobs.map((j, i) => ({ id: i })); },
  });
  assert.equal(result.fetched, 2);
  assert.equal(result.matched, 1);          // only the DevOps job passes the filter
  assert.equal(result.inserted, 1);
  assert.equal(upserted[0].title, 'DevOps Engineer');
});

test('runDiscover isolates a failing source and continues', async () => {
  const sources = [
    { name: 'bad', market: 'global', fetch: async () => { throw new Error('boom'); } },
    { name: 'good', market: 'global', fetch: async () => ([{ source: 'good', title: 'SRE', url: 'u', market: 'global', tags: ['sre'], company: null, location: null, remote: true, externalId: null, description: null, postedAt: null }]) },
  ];
  const result = await runDiscover({
    sources,
    profile: { includeKeywords: ['sre'], excludeKeywords: [], remoteOnly: false },
    client: { async query() { return { rows: [] }; } },
    upsert: async (_c, jobs) => jobs.map((j, i) => ({ id: i })),
  });
  assert.equal(result.fetched, 1);
  assert.equal(result.inserted, 1);
  assert.deepEqual(result.errors, ['bad']);
});

test('runDiscover treats a non-array source return as a source error (no count corruption)', async () => {
  const sources = [{ name: 'weird', market: 'global', fetch: async () => 'not-an-array' }];
  const result = await runDiscover({
    sources,
    profile: { includeKeywords: ['x'], excludeKeywords: [], remoteOnly: false },
    client: { async query() { return { rows: [] }; } },
    upsert: async (_c, jobs) => jobs.map((j, i) => ({ id: i })),
  });
  assert.equal(result.fetched, 0);
  assert.deepEqual(result.errors, ['weird']);
});

test('runDiscover returns a per-source breakdown (fetched/matched/errored)', async () => {
  const sources = [
    { name: 'good', market: 'global', fetch: async () => ([
      { title: 'DevOps Engineer', tags: ['devops'], remote: true, description: '' },
      { title: 'Chef', tags: [], remote: true, description: 'cooking' },
    ]) },
    { name: 'bad', market: 'global', fetch: async () => { throw new Error('boom'); } },
  ];
  const result = await runDiscover({
    sources,
    profile: { includeKeywords: ['devops'], excludeKeywords: [], remoteOnly: false },
    client: { async query() { return { rows: [] }; } },
    upsert: async (_c, jobs) => jobs.map((j, i) => ({ id: i })),
  });
  assert.deepEqual(result.sources, [
    { source: 'good', fetched: 2, matched: 1, qualityDropped: 0, errored: false, error: null },
    { source: 'bad', fetched: 0, matched: 0, qualityDropped: 0, errored: true, error: 'boom' },
  ]);
  // aggregates unchanged
  assert.equal(result.fetched, 2);
  assert.equal(result.matched, 1);
  assert.equal(result.inserted, 1);
  assert.deepEqual(result.errors, ['bad']);
});

test('runDiscover excludes red-flag jobs from insert and counts them in qualityDropped', async () => {
  const sources = [
    { name: 'src', market: 'global', fetch: async () => ([
      { source: 'src', title: 'DevOps Engineer', url: 'https://x/1', market: 'global', tags: ['devops'], company: 'Acme', location: 'Remote', remote: true, externalId: '1', description: 'Great role at Acme', postedAt: null },
      { source: 'src', title: 'Unpaid DevOps Intern', url: 'https://x/2', market: 'global', tags: ['devops'], company: 'Scam', location: 'Remote', remote: true, externalId: '2', description: 'This is unpaid work.', postedAt: null },
    ]) },
  ];
  const upserted = [];
  const result = await runDiscover({
    sources,
    profile: { includeKeywords: ['devops'], excludeKeywords: [], remoteOnly: false },
    client: { async query() { return { rows: [] }; } },
    upsert: async (_c, jobs) => { upserted.push(...jobs); return jobs.map((j, i) => ({ id: i })); },
  });
  // Only the clean job reaches the DB
  assert.equal(upserted.length, 1);
  assert.equal(upserted[0].title, 'DevOps Engineer');
  // The red-flag job is counted
  assert.equal(result.sources[0].qualityDropped, 1);
  assert.equal(result.qualityDropped, 1);
  assert.equal(result.inserted, 1);
});
