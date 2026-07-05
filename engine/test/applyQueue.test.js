import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getApplyQueue } from '../src/applyQueue.js';

test('getApplyQueue selects shortlisted+ready jobs under the attempt cap', async () => {
  const calls = [];
  const client = { async query(text, params) { calls.push({ text, params }); return { rows: [{ id: 1 }] }; } };
  const rows = await getApplyQueue(client, { limit: 5 });
  assert.deepEqual(rows, [{ id: 1 }]);
  assert.match(calls[0].text, /status = 'shortlisted'/);
  assert.match(calls[0].text, /materials_status = 'ready'/);
  assert.match(calls[0].text, /apply_attempts < 3/);
  assert.match(calls[0].text, /cv_pdf, cover_pdf/);
  assert.match(calls[0].text, /apply_answers/);
  assert.equal(calls[0].params[0], 5);
});
