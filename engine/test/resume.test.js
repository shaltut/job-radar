import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileText } from '../src/resume.js';

test('buildProfileText renders the key sections', () => {
  const r = {
    name: 'Ada', title: 'Staff Engineer', seniority: 'Staff', years: '10y', location: 'Remote',
    summary: 'Backend systems.', skills: ['Go', 'Postgres'], domains: ['Fintech'],
    experience: [{ title: 'Staff Eng', company: 'Acme', dates: '2020–now', summary: 'led platform' }],
    education: [{ title: 'BSc CS', org: 'Uni', year: '2015' }],
  };
  const t = buildProfileText(r);
  assert.match(t, /Ada/);
  assert.match(t, /Staff Engineer/);
  assert.match(t, /Go, Postgres/);
  assert.match(t, /Fintech/);
  assert.match(t, /Staff Eng \| Acme \| 2020–now — led platform/);
  assert.match(t, /BSc CS \| Uni \| 2015/);
});

test('buildProfileText tolerates missing optional fields', () => {
  const t = buildProfileText({ name: 'X', title: 'Dev' });
  assert.match(t, /X/);
  assert.match(t, /Dev/);
  assert.doesNotMatch(t, /undefined/);
});
