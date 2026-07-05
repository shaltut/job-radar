import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupCredentials, loadCredentials } from '../src/credentials.js';

const creds = { 'wuzzuf.com': { username: 'a', password: 'b' }, 'bayt.com': { username: 'c', password: 'd' } };

test('lookupCredentials matches exact host, parent domain, and strips www', () => {
  assert.deepEqual(lookupCredentials(creds, 'https://wuzzuf.com/jobs/123'), { username: 'a', password: 'b' });
  assert.deepEqual(lookupCredentials(creds, 'https://www.wuzzuf.com/apply'), { username: 'a', password: 'b' });
  assert.deepEqual(lookupCredentials(creds, 'https://jobs.bayt.com/x'), { username: 'c', password: 'd' });
});

test('lookupCredentials returns null on no match or bad input', () => {
  assert.equal(lookupCredentials(creds, 'https://greenhouse.io/x'), null);
  assert.equal(lookupCredentials(creds, ''), null);
  assert.equal(lookupCredentials(null, 'https://wuzzuf.com'), null);
});

test('lookupCredentials accepts a bare host too', () => {
  assert.deepEqual(lookupCredentials(creds, 'wuzzuf.com'), { username: 'a', password: 'b' });
});

test('loadCredentials returns {} when the file is missing', async () => {
  assert.deepEqual(await loadCredentials('/no/such/file.json', { readImpl: async () => { throw new Error('nope'); } }), {});
});

test('loadCredentials parses valid JSON', async () => {
  const r = await loadCredentials('/x', { readImpl: async () => '{"a":1}' });
  assert.deepEqual(r, { a: 1 });
});
