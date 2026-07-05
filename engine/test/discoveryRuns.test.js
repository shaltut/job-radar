import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimRuns, finishRuns, failRuns, enqueueRun } from '../src/discoveryRuns.js';

function fakeClient(rows = []) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      if (/UPDATE discovery_runs SET status = 'running'/.test(text)) return { rows };
      return { rows: [] };
    },
  };
}

test('claimRuns claims requested rows of the given kind and returns numeric ids', async () => {
  const c = fakeClient([{ id: '5' }, { id: '6' }]); // pg returns bigint as string
  const ids = await claimRuns(c, 'score');
  assert.deepEqual(ids, [5, 6]);
  assert.match(c.calls[0].text, /WHERE status = 'requested' AND kind = \$1 RETURNING id/);
  assert.deepEqual(c.calls[0].params, ['score']);
});

test('claimRuns defaults to kind=discover', async () => {
  const c = fakeClient([]);
  await claimRuns(c);
  assert.deepEqual(c.calls[0].params, ['discover']);
});

test('claimRuns returns [] when nothing is pending', async () => {
  assert.deepEqual(await claimRuns(fakeClient([]), 'tailor'), []);
});

test('finishRuns updates claimed ids with stats + note; no-op on empty', async () => {
  const c = fakeClient();
  await finishRuns(c, [], { note: 'x' });
  assert.equal(c.calls.length, 0); // empty → no query
  await finishRuns(c, [5, 6], { fetched: 10, matched: 4, inserted: 2, note: '2 new' });
  assert.match(c.calls[0].text, /status = 'done'.*fetched = \$2, matched = \$3, inserted = \$4, note = \$5 WHERE id = ANY\(\$1\)/s);
  assert.deepEqual(c.calls[0].params, [[5, 6], 10, 4, 2, '2 new']);
});

test('finishRuns null-fills missing stats (e.g. score/tailor only set inserted+note)', async () => {
  const c = fakeClient();
  await finishRuns(c, [7], { inserted: 41, note: 'scored 41' });
  assert.deepEqual(c.calls[0].params, [[7], null, null, 41, 'scored 41']);
});

test('failRuns records a truncated error; no-op on empty', async () => {
  const c = fakeClient();
  await failRuns(c, [], 'boom');
  assert.equal(c.calls.length, 0);
  await failRuns(c, [7], 'x'.repeat(900));
  assert.match(c.calls[0].text, /status = 'error'.*error = \$2 WHERE id = ANY\(\$1\)/s);
  assert.equal(c.calls[0].params[0].length, 1);
  assert.equal(c.calls[0].params[1].length, 500); // truncated
});

test('enqueueRun stamps tenant_id from JOBRADAR_TENANT_ID', async () => {
  process.env.JOBRADAR_TENANT_ID = '4';
  const c = fakeClient();
  await enqueueRun(c, 'score', 'auto');
  assert.match(c.calls[0].text, /INSERT INTO discovery_runs \(tenant_id, kind, source\)/);
  assert.match(c.calls[0].text, /WHERE NOT EXISTS/);
  assert.match(c.calls[0].text, /tenant_id = \$1 AND kind = \$2 AND status IN \('requested','running'\)/);
  assert.deepEqual(c.calls[0].params, [4, 'score', 'auto']);
});

test('enqueueRun defaults source to auto', async () => {
  process.env.JOBRADAR_TENANT_ID = '4';
  const c = fakeClient();
  await enqueueRun(c, 'score');
  assert.deepEqual(c.calls[0].params, [4, 'score', 'auto']);
});

test('enqueueRun throws when JOBRADAR_TENANT_ID is unset', async () => {
  delete process.env.JOBRADAR_TENANT_ID;
  await assert.rejects(enqueueRun(fakeClient(), 'score'));
});
