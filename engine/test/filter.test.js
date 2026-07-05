import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesProfile } from '../src/filter.js';

const profile = { includeKeywords: ['devops', 'sre'], excludeKeywords: ['director'], remoteOnly: false };
const job = (over) => ({ title: 'DevOps Engineer', tags: [], description: '', remote: true, ...over });

test('matches when an include keyword is in the title', () => {
  assert.equal(matchesProfile(job(), profile), true);
});

test('matches when an include keyword is only in tags', () => {
  assert.equal(matchesProfile(job({ title: 'Engineer', tags: ['sre'] }), profile), true);
});

test('rejects when no include keyword present', () => {
  assert.equal(matchesProfile(job({ title: 'Accountant', tags: [], description: 'ledgers' }), profile), false);
});

test('rejects when an exclude keyword is present, even if include matches', () => {
  assert.equal(matchesProfile(job({ title: 'DevOps Director' }), profile), false);
});

test('remoteOnly drops non-remote jobs', () => {
  const p = { ...profile, remoteOnly: true };
  assert.equal(matchesProfile(job({ remote: false }), p), false);
  assert.equal(matchesProfile(job({ remote: true }), p), true);
});

test('requireKeywords ANDs a second group (e.g. role AND seniority)', () => {
  const p = { includeKeywords: ['backend'], requireKeywords: ['senior', 'lead', 'staff'], excludeKeywords: [] };
  assert.equal(matchesProfile(job({ title: 'Senior Backend Engineer' }), p), true);
  assert.equal(matchesProfile(job({ title: 'Staff Backend Engineer' }), p), true);
  assert.equal(matchesProfile(job({ title: 'Backend Engineer' }), p), false); // role but no seniority
  assert.equal(matchesProfile(job({ title: 'Senior Designer' }), p), false);   // seniority but no role
});

test('requireKeywords absent/empty imposes no extra constraint', () => {
  const p = { includeKeywords: ['backend'], excludeKeywords: [] };
  assert.equal(matchesProfile(job({ title: 'Backend Engineer' }), p), true);
});

test('requireKeywords can be satisfied via description text', () => {
  const p = { includeKeywords: ['backend'], requireKeywords: ['senior'], excludeKeywords: [] };
  assert.equal(matchesProfile(job({ title: 'Backend Engineer', description: 'We want a senior-level hire' }), p), true);
});
