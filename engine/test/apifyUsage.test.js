import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apifyMonthlyUsage, checkApifySpend } from '../src/apifyUsage.js';

const fakeFetch = (monthly, limit) => async () => ({ ok: true, json: async () => ({ data: { current: { monthlyUsageUsd: monthly }, limits: { maxMonthlyUsageUsd: limit } } }) });

test('apifyMonthlyUsage parses usage + pct', async () => {
  const u = await apifyMonthlyUsage('t', { fetchImpl: fakeFetch(7.25, 29) });
  assert.equal(u.monthlyUsd, 7.25); assert.equal(u.limitUsd, 29); assert.equal(u.pct, 25);
});

test('checkApifySpend notifies at/over threshold, deduped per month', async () => {
  const rows = new Set();
  const client = { async query(text, params) {
    if (/insert into apify_alerts/i.test(text)) { if (rows.has(params[0])) return { rowCount: 0 }; rows.add(params[0]); return { rowCount: 1 }; }
    return { rows: [] };
  } };
  let sent = 0; const notify = async () => { sent++; };
  const r1 = await checkApifySpend(client, { token: 't', pct: 80, fetchImpl: fakeFetch(26, 29), notify }); // 90% ≥ 80
  assert.equal(r1.alerted, true); assert.equal(sent, 1);
  const r2 = await checkApifySpend(client, { token: 't', pct: 80, fetchImpl: fakeFetch(27, 29), notify }); // same month → deduped
  assert.equal(r2.alerted, false); assert.equal(sent, 1);
});

test('checkApifySpend no-op below threshold / no token', async () => {
  let sent = 0; const notify = async () => { sent++; };
  const client = { async query() { return { rowCount: 1, rows: [] }; } };
  assert.equal((await checkApifySpend(client, { token: 't', pct: 80, fetchImpl: fakeFetch(5, 29), notify })).alerted, false);
  assert.equal((await checkApifySpend(client, { token: '', pct: 80, notify })).alerted, false);
  assert.equal(sent, 0);
});
