import { test } from 'node:test';
import assert from 'node:assert/strict';
import { norm } from '../src/norm.js';

test('norm lowercases, trims, collapses whitespace', () => {
  assert.equal(norm('  DevOps   Engineer  '), 'devops engineer');
});

test('norm strips punctuation', () => {
  assert.equal(norm('Sr. Back-End (Node.js)!'), 'sr backend nodejs');
});

test('norm handles null/undefined as empty string', () => {
  assert.equal(norm(null), '');
  assert.equal(norm(undefined), '');
});
