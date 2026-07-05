/**
 * T4 tests: previewQueue SQL shapes.
 * - claimPreview SQL has FOR UPDATE SKIP LOCKED + status='requested'
 * - finishPreview sets status='done' + result + finished_at
 * - failPreview sets status='error' + error message + finished_at
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimPreview, finishPreview, failPreview } from '../src/previewQueue.js';

function fakeClient(rows = []) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      return { rows };
    },
  };
}

// ---- claimPreview ----

test('claimPreview SQL has FOR UPDATE SKIP LOCKED and status=requested', async () => {
  const c = fakeClient([{ id: '1', source: 'upwork', lim: 10 }]);
  await claimPreview(c);
  assert.equal(c.calls.length, 1);
  assert.match(c.calls[0].text, /FOR UPDATE SKIP LOCKED/);
  assert.match(c.calls[0].text, /status = 'requested'/);
  assert.match(c.calls[0].text, /status = 'running'/);
  assert.match(c.calls[0].text, /RETURNING id, source, lim/);
});

test('claimPreview orders by requested_at to claim oldest first', async () => {
  const c = fakeClient([]);
  await claimPreview(c);
  assert.match(c.calls[0].text, /ORDER BY requested_at/);
  assert.match(c.calls[0].text, /LIMIT 1/);
});

test('claimPreview returns the claimed row when one is pending', async () => {
  const c = fakeClient([{ id: '5', source: 'wellfound', lim: 10 }]);
  const row = await claimPreview(c);
  assert.deepEqual(row, { id: '5', source: 'wellfound', lim: 10 });
});

test('claimPreview returns null when no pending request', async () => {
  const c = fakeClient([]);
  const row = await claimPreview(c);
  assert.equal(row, null);
});

// ---- finishPreview ----

test('finishPreview sets status=done, result, finished_at', async () => {
  const c = fakeClient();
  const result = { fetched: 10, kept: 4, jobs: [] };
  await finishPreview(c, 5, result);
  assert.equal(c.calls.length, 1);
  assert.match(c.calls[0].text, /status = 'done'/);
  assert.match(c.calls[0].text, /result = \$2/);
  assert.match(c.calls[0].text, /finished_at = now\(\)/);
  assert.match(c.calls[0].text, /WHERE id = \$1/);
  assert.deepEqual(c.calls[0].params, [5, result]);
});

// ---- failPreview ----

test('failPreview sets status=error, error message, finished_at', async () => {
  const c = fakeClient();
  await failPreview(c, 7, 'source not active: upwork');
  assert.equal(c.calls.length, 1);
  assert.match(c.calls[0].text, /status = 'error'/);
  assert.match(c.calls[0].text, /error = \$2/);
  assert.match(c.calls[0].text, /finished_at = now\(\)/);
  assert.match(c.calls[0].text, /WHERE id = \$1/);
  assert.deepEqual(c.calls[0].params, [7, 'source not active: upwork']);
});

test('failPreview truncates very long messages to 500 chars', async () => {
  const c = fakeClient();
  await failPreview(c, 3, 'x'.repeat(900));
  assert.equal(c.calls[0].params[1].length, 500);
});
