import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeHash } from '../src/dedupe.js';

const base = { title: 'DevOps Engineer', company: 'Acme', location: 'Cairo', remote: false };

test('same job → same hash', () => {
  assert.equal(dedupeHash(base), dedupeHash({ ...base }));
});

test('punctuation/case/whitespace differences collapse to same hash', () => {
  assert.equal(dedupeHash(base), dedupeHash({ title: ' devops  engineer ', company: 'ACME!', location: 'cairo', remote: false }));
});

test('different company → different hash', () => {
  assert.notEqual(dedupeHash(base), dedupeHash({ ...base, company: 'Globex' }));
});

test('null location falls back to remote flag', () => {
  const a = dedupeHash({ title: 'X', company: 'Y', location: null, remote: true });
  const b = dedupeHash({ title: 'X', company: 'Y', location: null, remote: true });
  assert.equal(a, b);
  assert.equal(typeof a, 'string');
  assert.equal(a.length, 40); // sha1 hex
});

test('missing company is stable (defaults to empty, undefined === absent)', () => {
  const a = dedupeHash({ title: 'X', location: 'Y', remote: false });
  const b = dedupeHash({ title: 'X', company: undefined, location: 'Y', remote: false });
  assert.equal(a, b);
});

// --- Near-duplicate collapsing (decorated reposts of the same role) ---

test('three decorated "Backend Developer" remote reposts collapse to one hash', () => {
  const variants = [
    { title: 'Backend Developer - Fully Remote | Upto $85/hr', company: 'Acme', location: 'United States', remote: true },
    { title: 'Backend Developer | Upto $85/hr - Fully Remote', company: 'Acme', location: 'Remote', remote: true },
    { title: 'Backend Developer (Remote) - $85/hr', company: 'Acme', location: null, remote: true },
  ];
  const hashes = variants.map(dedupeHash);
  assert.equal(hashes[0], hashes[1]);
  assert.equal(hashes[1], hashes[2]);
});

test('two "Node.js Software Engineer - Remote" reposts collapse to one hash', () => {
  const a = dedupeHash({ title: 'Node.js Software Engineer - Remote', company: 'Globex', location: 'Remote', remote: true });
  const b = dedupeHash({ title: 'Node.js Software Engineer - Remote', company: 'Globex', location: 'Worldwide', remote: true });
  assert.equal(a, b);
});

test('Backend vs Frontend Developer (same company) stay distinct', () => {
  const be = dedupeHash({ title: 'Backend Developer', company: 'Acme', location: 'Remote', remote: true });
  const fe = dedupeHash({ title: 'Frontend Developer', company: 'Acme', location: 'Remote', remote: true });
  assert.notEqual(be, fe);
});

test('same title at two different companies stay distinct', () => {
  const a = dedupeHash({ title: 'Backend Developer - Fully Remote | Upto $85/hr', company: 'Acme', location: 'Remote', remote: true });
  const b = dedupeHash({ title: 'Backend Developer - Fully Remote | Upto $85/hr', company: 'Globex', location: 'Remote', remote: true });
  assert.notEqual(a, b);
});

test('non-remote same title in different cities stay distinct', () => {
  const cairo = dedupeHash({ title: 'Backend Developer', company: 'Acme', location: 'Cairo', remote: false });
  const dubai = dedupeHash({ title: 'Backend Developer', company: 'Acme', location: 'Dubai', remote: false });
  assert.notEqual(cairo, dubai);
});
