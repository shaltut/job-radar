import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFilters } from '../src/sources/filters.js';

test('spreads set config keys, skips empty, advanced wins last', () => {
  const out = applyFilters({ query: 'eng', page: 1 }, {
    query: 'backend', experienceLevel: ['expert'], jobType: [], paymentVerified: false,
    note: '', advanced: { page: 3, customFilters: ['x'] },
  });
  assert.equal(out.query, 'backend');                 // overrides base
  assert.deepEqual(out.experienceLevel, ['expert']);
  assert.equal('jobType' in out, false);              // empty array skipped
  assert.equal('note' in out, false);                 // empty string skipped
  assert.equal(out.paymentVerified, false);           // false is a real value, kept
  assert.equal(out.page, 3);                          // advanced last-wins
  assert.deepEqual(out.customFilters, ['x']);
});
test('no config / no advanced is a passthrough copy', () => {
  const base = { query: 'eng', page: 1 };
  const out = applyFilters(base);
  assert.deepEqual(out, base);
  assert.notEqual(out, base);                         // new object
});
