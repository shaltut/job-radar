import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApifySource } from '../src/sources/apify.js';

const base = {
  name: 'x', market: 'global', actorId: 'acme~act', token: 'tok',
  buildInput: () => ({ q: 'eng' }), map: (r) => ({ source: 'x', title: r.t, url: r.u, market: 'global' }),
};

test('apify fetch passes an AbortSignal and a server-side &timeout on the url', async () => {
  let url, opts;
  const fetchImpl = async (u, o) => { url = u; opts = o; return { ok: true, json: async () => [] }; };
  const src = makeApifySource({ ...base, fetchImpl, timeoutMs: 120_000 });
  await src.fetch({});
  assert.ok(opts.signal instanceof AbortSignal, 'fetch opts must include an AbortSignal');
  assert.match(url, /[?&]timeout=\d+/, 'run-sync url must carry a server-side timeout');
});

test('apify fetch surfaces an AbortError (hang) as a thrown source error, not []', async () => {
  const fetchImpl = async () => { throw new DOMException('The operation was aborted', 'AbortError'); };
  const src = makeApifySource({ ...base, fetchImpl });
  await assert.rejects(() => src.fetch({}), /aborted/i);
});
