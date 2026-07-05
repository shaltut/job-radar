import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScore } from '../src/scoreRun.js';

test('runScore scores each job, writes successes, counts failures, continues past a failure', async () => {
  const writes = [];
  const jobs = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }, { id: 3, title: 'C' }];
  const out = await runScore({
    client: {},
    profileText: 'P',
    openai: { apiKey: 'k', model: 'gpt-5.5' },
    getJobs: async () => jobs,
    score: async (job) => (job.id === 2 ? null : { score: 70 + job.id, reason: `r${job.id}` }),
    write: async (_c, id, result) => writes.push({ id, ...result }),
    fail: async () => {},
  });
  assert.equal(out.scored, 2);
  assert.equal(out.failed, 1);
  assert.deepEqual(writes, [{ id: 1, score: 71, reason: 'r1' }, { id: 3, score: 73, reason: 'r3' }]);
});

test('runScore threads backfill + threshold to getJobs', async () => {
  let opts;
  await runScore({ client: {}, profileText: 'P', backfill: true, threshold: 80, openai: {}, getJobs: async (_c, o) => { opts = o; return []; }, score: async () => null, write: async () => {} });
  assert.equal(opts.backfill, true);
  assert.equal(opts.threshold, 80);
});

test('runScore passes all flag to getJobs', async () => {
  let opts;
  await runScore({ client: {}, profileText: 'P', all: true, openai: {}, getJobs: async (_c, o) => { opts = o; return []; }, score: async () => null, write: async () => {} });
  assert.equal(opts.all, true);
});

test('runScore bumps attempts (fail) for jobs that score null and counts them failed', async () => {
  const calls = [];
  const r = await runScore({
    client: {},
    profileText: 'p',
    getJobs: async () => [{ id: 1 }, { id: 2 }],
    score: async (j) => (j.id === 1 ? { score: 80 } : null),
    write: async (_c, id) => calls.push(['write', id]),
    fail: async (_c, id) => calls.push(['fail', id]),
  });
  assert.deepEqual(r, { scored: 1, failed: 1 });
  assert.deepEqual(calls, [['write', 1], ['fail', 2]]);
});
