import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDigest } from '../src/digestRun.js';

// Route by query shape; capture EVERY sent message body (runDigest now sends per-job cards + a summary).
function harness({ newJobs = [], followups = [] } = {}) {
  const queries = [];
  const sent = [];
  const client = {
    async query(text, params) {
      queries.push({ text, params });
      if (/UPDATE/i.test(text)) return { rowCount: (params[0] || []).length };
      if (/status = 'new'/.test(text)) return { rows: newJobs };
      if (/status_changed_at/.test(text)) return { rows: followups };
      return { rows: [] };
    },
  };
  const fetchImpl = async (_url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ ok: true }) }; };
  return { client, fetchImpl, queries, sent };
}

const NOW = Date.parse('2026-06-18T08:00:00Z');
const job = (id, over = {}) => ({ id, title: `Job${id}`, company: 'C', location: 'R', market: 'global', url: `u${id}`, score: 90 - id, ...over });
const FOLLOWUP = { id: 99, title: 'Backend', company: 'Acme', url: 'u99', status: 'applied', days_since: 9 };

test('runDigest sends each top job as a carded message with buttons; marks all notified', async () => {
  const h = harness({ newJobs: [job(7)] });
  const r = await runDigest({ client: h.client, token: 'T', chatId: '1', fetchImpl: h.fetchImpl, nowMs: NOW, getRecent: async () => [] });
  assert.deepEqual(r, { sent: 1, followups: 0, warned: false });
  assert.equal(h.sent.length, 1);                       // one card, no summary needed
  assert.match(h.sent[0].text, /Job7/);
  assert.deepEqual(h.sent[0].reply_markup, { inline_keyboard: [[
    { text: '✅ Shortlist', callback_data: 'sl:7' }, { text: '✖ Dismiss', callback_data: 'ds:7' }]] });
  const update = h.queries.find((q) => /UPDATE jobs SET status/i.test(q.text));
  assert.deepEqual(update.params[0], [7]);
});

test('runDigest cards the top 5 and rolls the rest into a summary; marks ALL notified', async () => {
  const newJobs = [1, 2, 3, 4, 5, 6, 7].map((i) => job(i));
  const h = harness({ newJobs });
  const r = await runDigest({ client: h.client, token: 'T', chatId: '1', fetchImpl: h.fetchImpl, nowMs: NOW, getRecent: async () => [] });
  assert.equal(r.sent, 7);
  assert.equal(h.sent.length, 6);                        // 5 cards + 1 summary
  assert.ok(h.sent.slice(0, 5).every((b) => b.reply_markup)); // cards carry buttons
  assert.equal('reply_markup' in h.sent[5], false);     // summary has none
  assert.match(h.sent[5].text, /Job6/);                 // 6th+ in the summary
  const update = h.queries.find((q) => /UPDATE jobs SET status/i.test(q.text));
  assert.deepEqual(update.params[0], [1, 2, 3, 4, 5, 6, 7]); // all marked notified
});

test('runDigest sends a follow-up summary with no new jobs and does NOT mark notified', async () => {
  const h = harness({ followups: [FOLLOWUP] });
  const r = await runDigest({ client: h.client, token: 'T', chatId: '1', fetchImpl: h.fetchImpl, nowMs: NOW, getRecent: async () => [] });
  assert.deepEqual(r, { sent: 0, followups: 1, warned: false });
  assert.equal(h.sent.length, 1);                        // one summary message
  assert.match(h.sent[0].text, /Follow up/);
  assert.match(h.sent[0].text, /Backend/);
  assert.equal(h.queries.find((q) => /UPDATE jobs SET status/i.test(q.text)), undefined);
});

test('runDigest is silent when nothing is new, due, or warning', async () => {
  const h = harness();
  const r = await runDigest({ client: h.client, token: 'T', chatId: '1', fetchImpl: h.fetchImpl, nowMs: NOW, getRecent: async () => [] });
  assert.deepEqual(r, { sent: 0, followups: 0, warned: false });
  assert.equal(h.sent.length, 0);
});

test('runDigest force-sends a health-warning summary even with no jobs/followups', async () => {
  const h = harness();
  const warnRow = { source: 'bayt-uae', family: 'bayt', fetched: 0, errored: true, error: '403', created_at: new Date(NOW - 3 * 3600_000).toISOString() };
  const r = await runDigest({ client: h.client, token: 'T', chatId: '1', fetchImpl: h.fetchImpl, nowMs: NOW, getRecent: async () => [warnRow] });
  assert.deepEqual(r, { sent: 0, followups: 0, warned: true });
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].text, /🩺/);
  assert.match(h.sent[0].text, /❌ bayt-uae/);
});

test('runDigest survives an unavailable source_runs table (getRecent throws)', async () => {
  const h = harness();
  const r = await runDigest({ client: h.client, token: 'T', chatId: '1', fetchImpl: h.fetchImpl, nowMs: NOW, getRecent: async () => { throw new Error('relation "source_runs" does not exist'); } });
  assert.deepEqual(r, { sent: 0, followups: 0, warned: false });
  assert.equal(h.sent.length, 0);
});

test('marks only the cards + the rest actually shown (not jobs beyond cardLimit+DIGEST_MAX)', async () => {
  // 40 qualifying jobs, cardLimit 5, DIGEST_MAX 25 → 30 shown/marked, 10 never marked.
  const jobs = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, score: 100 - i, title: `J${i + 1}`, company: 'C', location: 'R', market: 'global', url: `u${i + 1}` }));
  const marked = [];
  const fetchImpl = async (_u, o) => { JSON.parse(o.body); return { ok: true, json: async () => ({ ok: true }) }; };
  const r = await runDigest({
    client: {}, token: 't', chatId: 'c', fetchImpl,
    getRecent: async () => [], summarize: () => [],
    _getJobs: async () => jobs, _getFollowUps: async () => [], _markNotified: async (_c, ids) => { marked.push(...ids); return ids.length; },
  });
  assert.equal(marked.length, 30);
  assert.deepEqual(marked.slice().sort((a, b) => a - b)[29], 30); // ids 1..30 only
  assert.equal(r.sent, 30);
});

test('a card whose send throws is NOT marked notified', async () => {
  const jobs = [
    { id: 1, score: 90, title: 'J1', company: 'C', location: 'R', market: 'global', url: 'u1' },
    { id: 2, score: 80, title: 'J2', company: 'C', location: 'R', market: 'global', url: 'u2' },
    { id: 3, score: 70, title: 'J3', company: 'C', location: 'R', market: 'global', url: 'u3' },
  ];
  const marked = [];
  let n = 0;
  const fetchImpl = async (_u, o) => {
    n++;
    if (n === 2) throw new Error('429'); // second card fails
    return { ok: true, json: async () => ({ ok: true }) };
  };
  await runDigest({ client: {}, token: 't', chatId: 'c', fetchImpl, getRecent: async () => [], summarize: () => [],
    _getJobs: async () => jobs, _getFollowUps: async () => [], _markNotified: async (_c, ids) => { marked.push(...ids); } });
  assert.ok(!marked.includes(2), 'failed card id must not be marked');
});

test('summary send failure does not abort markNotified for the cards, and does not throw', async () => {
  const jobs = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, score: 100 - i, title: `J${i + 1}`, company: 'C', location: 'R', market: 'global', url: `u${i + 1}` }));
  const marked = [];
  const fetchImpl = async (_u, o) => {
    const body = JSON.parse(o.body);
    if (!body.reply_markup) throw new Error('summary failed'); // the summary message has no buttons
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const r = await runDigest({ client: {}, token: 't', chatId: 'c', fetchImpl, getRecent: async () => [], summarize: () => [],
    _getJobs: async () => jobs, _getFollowUps: async () => [], _markNotified: async (_c, ids) => { marked.push(...ids); } });
  assert.deepEqual(marked.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5]); // 5 cards marked, summary-rest NOT
});
