import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTailor } from '../src/tailorRun.js';

const client = { async query() { return { rows: [] }; } };

test('runTailor tailors each job, writes basenames + answers, notifies, counts', async () => {
  const jobs = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }];
  const writes = []; const notified = [];
  const r = await runTailor({
    client,
    getJobs: async () => jobs,
    tailor: async (job) => ({ cvPdf: `/o/cv-${job.id}.pdf`, coverPdf: `/o/cover-${job.id}.pdf`, reportMd: null, answers: { summary: `s${job.id}` } }),
    write: async (c, id, cv, cover, answers) => writes.push([id, cv, cover, answers]),
    fail: async () => { throw new Error('should not be called'); },
    notifyReady: async (job) => notified.push(job.id),
    notifyError: async () => {},
  });
  assert.deepEqual(r, { tailored: 2, failed: 0 });
  assert.deepEqual(writes, [[1, 'cv-1.pdf', 'cover-1.pdf', { summary: 's1' }], [2, 'cv-2.pdf', 'cover-2.pdf', { summary: 's2' }]]);
  assert.deepEqual(notified, [1, 2]);
});

test('runTailor builds per-job facts from applyProfile + job.salary_ask and forwards them to tailor', async () => {
  let seenFacts;
  await runTailor({
    client, applyProfile: { notice_period_days: '30' },
    getJobs: async () => [{ id: 1, salary_ask: '$120k' }],
    tailor: async (job, opts) => { seenFacts = opts.facts; return { cvPdf: '/o/c.pdf', coverPdf: '/o/cl.pdf', reportMd: null, answers: {} }; },
    write: async () => {}, fail: async () => {}, notifyReady: async () => {}, notifyError: async () => {},
  });
  assert.match(seenFacts, /Notice period: 30 days/);
  assert.match(seenFacts, /Salary expectation: \$120k/);
});

test('runTailor records errors and continues when one job fails', async () => {
  const jobs = [{ id: 1 }, { id: 2 }];
  const failed = [];
  const r = await runTailor({
    client,
    getJobs: async () => jobs,
    tailor: async (job) => { if (job.id === 1) throw new Error('boom'); return { cvPdf: '/o/c.pdf', coverPdf: '/o/cl.pdf', reportMd: null }; },
    write: async () => {},
    fail: async (c, id, msg) => failed.push([id, msg]),
    notifyReady: async () => {},
    notifyError: async () => {},
  });
  assert.equal(r.tailored, 1);
  assert.equal(r.failed, 1);
  assert.equal(failed[0][0], 1);
  assert.match(failed[0][1], /boom/);
});

test('runTailor counts a job tailored even if notifyReady throws after a successful write (no fail())', async () => {
  const failCalled = [];
  const r = await runTailor({
    client,
    getJobs: async () => [{ id: 1, title: 'A' }],
    tailor: async () => ({ cvPdf: '/o/cv.pdf', coverPdf: '/o/cl.pdf', reportMd: null }),
    write: async () => {},
    fail: async (c, id) => failCalled.push(id),
    notifyReady: async () => { throw new Error('telegram down'); },
    notifyError: async () => {},
  });
  assert.equal(r.tailored, 1);
  assert.equal(r.failed, 0);
  assert.deepEqual(failCalled, []);
});

test('runTailor still counts a failure when notifyError itself throws', async () => {
  const r = await runTailor({
    client,
    getJobs: async () => [{ id: 1 }],
    tailor: async () => { throw new Error('boom'); },
    write: async () => {},
    fail: async () => {},
    notifyReady: async () => {},
    notifyError: async () => { throw new Error('also down'); },
  });
  assert.equal(r.failed, 1);
});

test('runTailor forwards limit to getJobs', async () => {
  let seenLimit;
  await runTailor({
    client,
    limit: 9,
    getJobs: async (c, opts) => { seenLimit = opts.limit; return []; },
    tailor: async () => ({ cvPdf: '/o/cv.pdf', coverPdf: '/o/cl.pdf', reportMd: null }),
    write: async () => {}, fail: async () => {}, notifyReady: async () => {}, notifyError: async () => {},
  });
  assert.equal(seenLimit, 9);
});
