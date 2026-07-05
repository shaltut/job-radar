import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markApplied, bumpApplyAttempt, buildAuditLine, appendAudit, recordApply } from '../src/applied.js';

test('markApplied sets status=applied + applied_at + status_changed_at, leaves attempts alone', async () => {
  let q; const client = { async query(text, params) { q = { text, params }; return {}; } };
  await markApplied(client, 13);
  assert.match(q.text, /status\s*=\s*'applied'/);
  assert.match(q.text, /applied_at\s*=\s*now\(\)/);
  assert.match(q.text, /status_changed_at\s*=\s*now\(\)/);
  assert.doesNotMatch(q.text, /apply_attempts/);
  assert.deepEqual(q.params, [13]);
});

test('bumpApplyAttempt increments apply_attempts by id', async () => {
  let q; const client = { async query(text, params) { q = { text, params }; return {}; } };
  await bumpApplyAttempt(client, 9);
  assert.match(q.text, /apply_attempts\s*=\s*apply_attempts\s*\+\s*1/);
  assert.deepEqual(q.params, [9]);
});

test('buildAuditLine normalizes a valid record', () => {
  const o = JSON.parse(buildAuditLine({ job_id: 13, company: 'Acme', result: 'submitted', mode: 'live', screenshot: '/s.png' }, '2026-06-17T00:00:00Z'));
  assert.equal(o.ts, '2026-06-17T00:00:00Z');
  assert.equal(o.job_id, 13);
  assert.equal(o.mode, 'live');
  assert.equal(o.result, 'submitted');
  assert.equal(o.screenshot, '/s.png');
  assert.equal(o.reason, null);
});

test('buildAuditLine defaults mode to dry-run and rejects bad result/job_id', () => {
  assert.equal(JSON.parse(buildAuditLine({ job_id: 1, result: 'dry-run' }, 'T')).mode, 'dry-run');
  assert.throws(() => buildAuditLine({ result: 'submitted' }, 'T'), /job_id/);
  assert.throws(() => buildAuditLine({ job_id: 1, result: 'bogus' }, 'T'), /result must be/);
});

test('appendAudit writes one line to applies.jsonl in the dir', async () => {
  let captured;
  await appendAudit('{"x":1}', { dir: '/d', appendImpl: async (p, data) => { captured = { p, data }; } });
  assert.equal(captured.p, '/d/applies.jsonl');
  assert.equal(captured.data, '{"x":1}\n');
});

test('recordApply: submitted+live marks applied and appends, no bump', async () => {
  const calls = { mark: [], bump: [], append: [] };
  const r = await recordApply({}, { job_id: 13, result: 'submitted', mode: 'live' }, {
    dir: '/tmp', nowIso: 'T',
    mark: async (c, id) => calls.mark.push(id),
    bump: async (c, id) => calls.bump.push(id),
    append: async (line) => calls.append.push(line),
  });
  assert.deepEqual(calls.mark, [13]);
  assert.deepEqual(calls.bump, []);
  assert.equal(calls.append.length, 1);
  assert.deepEqual(r, { marked: true, bumped: false });
});

test('recordApply: skipped bumps attempt, no mark', async () => {
  const calls = { mark: [], bump: [], append: [] };
  const r = await recordApply({}, { job_id: 7, result: 'skipped', mode: 'dry-run' }, {
    dir: '/tmp', nowIso: 'T',
    mark: async (c, id) => calls.mark.push(id),
    bump: async (c, id) => calls.bump.push(id),
    append: async (line) => calls.append.push(line),
  });
  assert.deepEqual(calls.mark, []);
  assert.deepEqual(calls.bump, [7]);
  assert.deepEqual(r, { marked: false, bumped: true });
});

test('recordApply: dry-run appends only (no mark, no bump)', async () => {
  const calls = { mark: [], bump: [], append: [] };
  const r = await recordApply({}, { job_id: 7, result: 'dry-run', mode: 'dry-run' }, {
    dir: '/tmp', nowIso: 'T',
    mark: async (c, id) => calls.mark.push(id),
    bump: async (c, id) => calls.bump.push(id),
    append: async (line) => calls.append.push(line),
  });
  assert.deepEqual(calls.mark, []);
  assert.deepEqual(calls.bump, []);
  assert.equal(calls.append.length, 1);
  assert.deepEqual(r, { marked: false, bumped: false });
});

test('recordApply: failed bumps attempt, no mark', async () => {
  const calls = { mark: [], bump: [], append: [] };
  const r = await recordApply({}, { job_id: 5, result: 'failed', mode: 'live' }, {
    dir: '/tmp', nowIso: 'T',
    mark: async (c, id) => calls.mark.push(id),
    bump: async (c, id) => calls.bump.push(id),
    append: async (line) => calls.append.push(line),
  });
  assert.deepEqual(calls.mark, []);
  assert.deepEqual(calls.bump, [5]);
  assert.deepEqual(r, { marked: false, bumped: true });
});

test('buildAuditLine coerces a string job_id (pg returns bigint as string) to a number', () => {
  const o = JSON.parse(buildAuditLine({ job_id: '13', result: 'dry-run' }, 'T'));
  assert.strictEqual(o.job_id, 13);
});

test('buildAuditLine rejects non-numeric / non-positive job_id', () => {
  assert.throws(() => buildAuditLine({ job_id: 'abc', result: 'dry-run' }, 'T'), /job_id/);
  assert.throws(() => buildAuditLine({ job_id: 0, result: 'dry-run' }, 'T'), /job_id/);
});

test('recordApply passes a numeric job_id to mark even when given a string', async () => {
  const calls = { mark: [] };
  await recordApply({}, { job_id: '13', result: 'submitted', mode: 'live' }, {
    dir: '/tmp', nowIso: 'T',
    mark: async (c, id) => calls.mark.push(id),
    bump: async () => {},
    append: async () => {},
  });
  assert.deepEqual(calls.mark, [13]);
  assert.strictEqual(calls.mark[0], 13);
});
