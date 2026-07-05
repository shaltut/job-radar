import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSourceHealth, recordSourceRuns, getRecentSourceRuns } from '../src/sourceRuns.js';

const NOW = Date.parse('2026-06-18T08:00:00Z');
const ago = (h) => new Date(NOW - h * 3600_000).toISOString();

test('summarizeSourceHealth returns [] for no rows', () => {
  assert.deepEqual(summarizeSourceHealth([], { nowMs: NOW }), []);
});

test('summarizeSourceHealth: a healthy recent source has zero consecutive dry/errors and is not stale', () => {
  const rows = [{ source: 'remotive', family: 'remotive', fetched: 14, errored: false, error: null, created_at: ago(5) }];
  const [s] = summarizeSourceHealth(rows, { nowMs: NOW });
  assert.equal(s.source, 'remotive');
  assert.equal(s.lastFetched, 14);
  assert.equal(s.lastErrored, false);
  assert.equal(s.consecutiveErrors, 0);
  assert.equal(s.consecutiveDry, 0);
  assert.equal(s.stale, false);
});

test('summarizeSourceHealth counts consecutive errors and dry from most-recent', () => {
  // unsorted input; two recent errors then an ok run
  const rows = [
    { source: 'bayt-uae', family: 'bayt', fetched: 9, errored: false, error: null, created_at: ago(30) },
    { source: 'bayt-uae', family: 'bayt', fetched: 0, errored: true, error: '403', created_at: ago(5) },
    { source: 'bayt-uae', family: 'bayt', fetched: 0, errored: true, error: '403', created_at: ago(10) },
  ];
  const [s] = summarizeSourceHealth(rows, { nowMs: NOW });
  assert.equal(s.consecutiveErrors, 2);
  assert.equal(s.consecutiveDry, 2);
  assert.equal(s.lastError, '403');
});

test('summarizeSourceHealth: dry but not errored counts as dry, not error', () => {
  const rows = [
    { source: 'linkedin', family: 'linkedin', fetched: 0, errored: false, error: null, created_at: ago(2) },
    { source: 'linkedin', family: 'linkedin', fetched: 0, errored: false, error: null, created_at: ago(8) },
    { source: 'linkedin', family: 'linkedin', fetched: 3, errored: false, error: null, created_at: ago(14) },
  ];
  const [s] = summarizeSourceHealth(rows, { nowMs: NOW });
  assert.equal(s.consecutiveErrors, 0);
  assert.equal(s.consecutiveDry, 2);
});

test('summarizeSourceHealth marks a source stale when its last run is older than staleHours', () => {
  const rows = [{ source: 'remoteok', family: 'remoteok', fetched: 5, errored: false, error: null, created_at: ago(72) }];
  const [s] = summarizeSourceHealth(rows, { nowMs: NOW, staleHours: 48 });
  assert.equal(s.stale, true);
});

test('summarizeSourceHealth groups multiple sources', () => {
  const rows = [
    { source: 'a', family: 'a', fetched: 1, errored: false, error: null, created_at: ago(1) },
    { source: 'b', family: 'b', fetched: 0, errored: true, error: 'x', created_at: ago(1) },
  ];
  const out = summarizeSourceHealth(rows, { nowMs: NOW });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((s) => s.source).sort(), ['a', 'b']);
});

function fakeClient(rows = []) {
  const calls = [];
  return { calls, async query(text, params) { calls.push({ text, params }); return { rows }; } };
}

test('recordSourceRuns is a no-op on empty input', async () => {
  const c = fakeClient();
  await recordSourceRuns(c, 5, []);
  assert.equal(c.calls.length, 0);
});

test('recordSourceRuns inserts one row per source with familyOf() and run id', async () => {
  const c = fakeClient();
  await recordSourceRuns(c, 5, [
    { source: 'bayt-uae', fetched: 9, matched: 2, errored: false, error: null },
    { source: 'remotive', fetched: 0, matched: 0, errored: true, error: 'boom' },
  ]);
  assert.equal(c.calls.length, 2);
  assert.match(c.calls[0].text, /INSERT INTO source_runs \(discovery_run_id, source, family, fetched, matched, errored, error\)/);
  assert.deepEqual(c.calls[0].params, [5, 'bayt-uae', 'bayt', 9, 2, false, null]);
  assert.deepEqual(c.calls[1].params, [5, 'remotive', 'remotive', 0, 0, true, 'boom']);
});

test('recordSourceRuns passes null discovery_run_id through (manual run)', async () => {
  const c = fakeClient();
  await recordSourceRuns(c, null, [{ source: 'remoteok', fetched: 3, matched: 1, errored: false, error: null }]);
  assert.equal(c.calls[0].params[0], null);
});

test('getRecentSourceRuns selects last N per source via row_number window', async () => {
  const c = fakeClient([{ source: 'a', family: 'a', fetched: 1, errored: false, error: null, created_at: 'x' }]);
  const rows = await getRecentSourceRuns(c, { perSource: 20 });
  assert.match(c.calls[0].text, /row_number\(\) OVER \(PARTITION BY source ORDER BY created_at DESC\)/);
  assert.match(c.calls[0].text, /WHERE rn <= \$1/);
  assert.deepEqual(c.calls[0].params, [20]);
  assert.equal(rows.length, 1);
});

test('getRecentSourceRuns defaults perSource to 20', async () => {
  const c = fakeClient([]);
  await getRecentSourceRuns(c);
  assert.deepEqual(c.calls[0].params, [20]);
});
