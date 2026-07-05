import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCanonical, stripHtml, mapValid, toISOOrNull, relativeToISO, dmyToISO } from '../src/normalize.js';

const good = {
  source: 'remotive', externalId: '1', title: 'DevOps', company: 'Acme',
  location: 'Remote', remote: true, url: 'https://x/y', description: 'd',
  tags: ['devops'], market: 'global', postedAt: '2026-06-17T00:00:00Z',
};

test('valid job passes through unchanged', () => {
  assert.deepEqual(validateCanonical(good), good);
});

test('missing required field throws', () => {
  assert.throws(() => validateCanonical({ ...good, title: '' }), /title/);
  assert.throws(() => validateCanonical({ ...good, url: undefined }), /url/);
  assert.throws(() => validateCanonical({ ...good, source: '' }), /source/);
});

test('bad market throws', () => {
  assert.throws(() => validateCanonical({ ...good, market: 'moon' }), /market/);
});

test('tags defaults to [] and optional fields default to null', () => {
  const r = validateCanonical({ source: 's', title: 't', url: 'u', market: 'mena' });
  assert.deepEqual(r.tags, []);
  assert.equal(r.company, null);
  assert.equal(r.remote, null);
  assert.equal(r.externalId, null);
});

test('stripHtml removes tags and decodes basic entities', () => {
  assert.equal(stripHtml('<p>do &amp; ops</p>'), 'do & ops');
  assert.equal(stripHtml('a<br/>b'), 'a b');
  assert.equal(stripHtml(null), null);
});

test('mapValid keeps valid rows and silently drops invalid ones', () => {
  const rows = [{ t: 'A', u: 'ua' }, { t: '', u: 'ub' }, { t: 'C', u: '' }];
  const out = mapValid(rows, (r) => ({ source: 's', title: r.t, url: r.u, market: 'global' }));
  assert.equal(out.length, 1);              // only the first row is valid
  assert.equal(out[0].title, 'A');
});

test('mapValid rethrows non-validation errors (a bug in mapFn must not be silently swallowed)', () => {
  assert.throws(() => mapValid([{}], () => { throw new TypeError('boom'); }), /boom/);
});

test('stripHtml decodes &quot; and &apos;', () => {
  assert.equal(stripHtml('Senior &quot;Engineer&quot; &apos;x&apos;'), 'Senior "Engineer" \'x\'');
});

test('toISOOrNull handles valid, invalid, and empty inputs', () => {
  assert.equal(toISOOrNull('2026-06-16T10:00:00Z'), '2026-06-16T10:00:00.000Z');
  assert.equal(toISOOrNull('TBD'), null);
  assert.equal(toISOOrNull(null), null);
  assert.equal(toISOOrNull(''), null);
});

test('relativeToISO converts relative time back from a base timestamp', () => {
  const base = '2026-06-17T12:00:00.000Z';
  assert.equal(relativeToISO('3 days ago', base), '2026-06-14T12:00:00.000Z');
  assert.equal(relativeToISO('2 hours ago', base), '2026-06-17T10:00:00.000Z');
  assert.equal(relativeToISO('12 minutes ago', base), '2026-06-17T11:48:00.000Z');
  assert.equal(relativeToISO('just now', base), base);
});

test('relativeToISO handles yesterday, "a/an X ago", and "N+ X ago"', () => {
  const base = '2026-06-17T12:00:00.000Z';
  assert.equal(relativeToISO('yesterday', base), '2026-06-16T12:00:00.000Z');
  assert.equal(relativeToISO('a day ago', base), '2026-06-16T12:00:00.000Z');
  assert.equal(relativeToISO('an hour ago', base), '2026-06-17T11:00:00.000Z');
  assert.equal(relativeToISO('30+ days ago', base), '2026-05-18T12:00:00.000Z');
});

test('relativeToISO returns null on unparseable input or missing base', () => {
  assert.equal(relativeToISO('whenever', '2026-06-17T12:00:00Z'), null);
  assert.equal(relativeToISO('3 days ago', null), null);
  assert.equal(relativeToISO(null, '2026-06-17T12:00:00Z'), null);
});

test('dmyToISO returns null for out-of-range day/month/time instead of rolling over', () => {
  assert.equal(dmyToISO('32/01/2025'), null);          // was → 2025-02-01
  assert.equal(dmyToISO('00/01/2025'), null);          // was → 2024-12-31
  assert.equal(dmyToISO('09/13/2025'), null);          // month 13 (was → 2026-01-09, year shift)
  assert.equal(dmyToISO('09/00/2025'), null);          // month 0 (was → 2024-12-09)
  assert.equal(dmyToISO('10/10/2025 25:00:00'), null); // hour 25
  // valid cases still parse (incl. day>12, which is the whole reason this fn exists):
  assert.equal(dmyToISO('25/10/2025 00:00:00'), '2025-10-25T00:00:00.000Z');
  assert.equal(dmyToISO('09/10/2025 15:18:30'), '2025-10-09T15:18:30.000Z');
});
