import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertSourceErrors, alertCatastrophe } from '../src/alerts.js';

test('alertSourceErrors does nothing when no source errored', async () => {
  let called = false;
  const sent = await alertSourceErrors([{ source: 'a', errored: false }], { token: 'T', chatId: '1', fetchImpl: async () => { called = true; return { ok: true, json: async () => ({}) }; } });
  assert.equal(sent, false);
  assert.equal(called, false);
});

test('alertSourceErrors sends one message listing errored sources', async () => {
  let body;
  const fetchImpl = async (_u, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => ({ ok: true }) }; };
  const sent = await alertSourceErrors([{ source: 'bayt-uae', errored: true, error: '403' }], { token: 'T', chatId: '1', fetchImpl });
  assert.equal(sent, true);
  assert.match(body.text, /source errors/);
  assert.match(body.text, /bayt-uae/);
});

test('alertSourceErrors skips silently when token/chatId missing', async () => {
  let called = false;
  const sent = await alertSourceErrors([{ source: 'a', errored: true, error: 'x' }], { fetchImpl: async () => { called = true; return { ok: true, json: async () => ({}) }; } });
  assert.equal(sent, false);
  assert.equal(called, false);
});

test('alertSourceErrors swallows a Telegram failure (never throws)', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({ description: 'boom' }) });
  const sent = await alertSourceErrors([{ source: 'a', errored: true, error: 'x' }], { token: 'T', chatId: '1', fetchImpl });
  assert.equal(sent, false); // send attempted but failed → false, no throw
});

test('alertCatastrophe sends the failing-step message', async () => {
  let body;
  const fetchImpl = async (_u, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => ({ ok: true }) }; };
  const sent = await alertCatastrophe('discover', new Error('DB down'), { token: 'T', chatId: '1', fetchImpl });
  assert.equal(sent, true);
  assert.match(body.text, /discover run failed/);
  assert.match(body.text, /DB down/);
});
