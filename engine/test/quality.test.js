import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkQuality } from '../src/quality.js';

// Helpers
const base = {
  source: 'test', title: 'Software Engineer', company: 'Acme', location: 'Remote',
  remote: true, url: 'https://example.com/1', description: 'We build cool stuff with Node.js',
  tags: ['javascript', 'node'], market: 'global', postedAt: new Date('2025-01-01'),
};

// --- Rule 1: Empty/unjudgeable ---

test('checkQuality rejects job with missing title', () => {
  const { ok, reason } = checkQuality({ ...base, title: undefined, description: 'great job', tags: ['js'] });
  assert.equal(ok, false);
  assert.equal(reason, 'empty');
});

test('checkQuality rejects job with blank title (spaces only)', () => {
  const { ok, reason } = checkQuality({ ...base, title: '   ', description: 'great job', tags: ['js'] });
  assert.equal(ok, false);
  assert.equal(reason, 'empty');
});

test('checkQuality rejects job with null title', () => {
  const { ok, reason } = checkQuality({ ...base, title: null, description: 'great job', tags: [] });
  assert.equal(ok, false);
  assert.equal(reason, 'empty');
});

test('checkQuality rejects job with title but null description AND empty tags', () => {
  const { ok, reason } = checkQuality({ ...base, description: null, tags: [] });
  assert.equal(ok, false);
  assert.equal(reason, 'empty');
});

test('checkQuality rejects job with title but blank description AND empty tags', () => {
  const { ok, reason } = checkQuality({ ...base, description: '   ', tags: [] });
  assert.equal(ok, false);
  assert.equal(reason, 'empty');
});

test('checkQuality passes job with title and tags (no description needed)', () => {
  const { ok } = checkQuality({ ...base, description: null, tags: ['node', 'backend'] });
  assert.equal(ok, true);
});

test('checkQuality passes job with title and description (no tags needed)', () => {
  const { ok } = checkQuality({ ...base, description: 'We build cool things', tags: [] });
  assert.equal(ok, true);
});

// --- Rule 2: Red-flag terms ---

test('checkQuality rejects job with "unpaid" in title', () => {
  const { ok, reason } = checkQuality({ ...base, title: 'Unpaid Internship' });
  assert.equal(ok, false);
  assert.match(reason, /^red-flag:/);
  assert.ok(reason.includes('unpaid'));
});

test('checkQuality rejects job with "equity only" in description', () => {
  const { ok, reason } = checkQuality({ ...base, description: 'Compensation is equity only, no salary.' });
  assert.equal(ok, false);
  assert.match(reason, /^red-flag:/);
});

test('checkQuality rejects job with "equity-only" in description', () => {
  const { ok, reason } = checkQuality({ ...base, description: 'This is an equity-only position.' });
  assert.equal(ok, false);
  assert.match(reason, /^red-flag:/);
});

test('checkQuality rejects job with "100% commission" in description', () => {
  const { ok, reason } = checkQuality({ ...base, description: 'Earn 100% commission on sales.' });
  assert.equal(ok, false);
  assert.match(reason, /^red-flag:/);
});

test('checkQuality rejects job with "commission only" in description', () => {
  const { ok, reason } = checkQuality({ ...base, description: 'This role is commission only.' });
  assert.equal(ok, false);
  assert.match(reason, /^red-flag:/);
});

test('checkQuality rejects job with "commission-only" in description', () => {
  const { ok, reason } = checkQuality({ ...base, description: 'commission-only sales position.' });
  assert.equal(ok, false);
  assert.match(reason, /^red-flag:/);
});

test('checkQuality rejects job with "no salary" in description', () => {
  const { ok, reason } = checkQuality({ ...base, description: 'No salary offered, equity only.' });
  assert.equal(ok, false);
  assert.match(reason, /^red-flag:/);
});

test('checkQuality rejects job with "volunteer" in title', () => {
  const { ok, reason } = checkQuality({ ...base, title: 'Volunteer Developer' });
  assert.equal(ok, false);
  assert.match(reason, /^red-flag:/);
});

test('checkQuality rejects job with "pay to apply" in description', () => {
  const { ok, reason } = checkQuality({ ...base, description: 'Please pay to apply for this role.' });
  assert.equal(ok, false);
  assert.match(reason, /^red-flag:/);
});

test('checkQuality rejects job with "pay-to-apply" in description', () => {
  const { ok, reason } = checkQuality({ ...base, description: 'pay-to-apply scheme.' });
  assert.equal(ok, false);
  assert.match(reason, /^red-flag:/);
});

test('checkQuality rejects job with "registration fee" in description', () => {
  const { ok, reason } = checkQuality({ ...base, description: 'There is a registration fee to get started.' });
  assert.equal(ok, false);
  assert.match(reason, /^red-flag:/);
});

test('checkQuality rejects job with "training fee" in description', () => {
  const { ok, reason } = checkQuality({ ...base, description: 'A training fee is required.' });
  assert.equal(ok, false);
  assert.match(reason, /^red-flag:/);
});

test('checkQuality rejects job with "mlm" in description', () => {
  const { ok, reason } = checkQuality({ ...base, description: 'Join our MLM network.' });
  assert.equal(ok, false);
  assert.match(reason, /^red-flag:/);
});

test('checkQuality red-flag check is case-insensitive', () => {
  const { ok, reason } = checkQuality({ ...base, title: 'UNPAID Intern', description: 'something' });
  assert.equal(ok, false);
  assert.match(reason, /^red-flag:/);
});

// --- Rule 3: Stale (OFF by default) ---

test('checkQuality does NOT reject old job when maxAgeDays not set', () => {
  const oldDate = new Date('2000-01-01');
  const { ok } = checkQuality({ ...base, postedAt: oldDate });
  assert.equal(ok, true);
});

test('checkQuality does NOT reject old job when maxAgeDays is 0', () => {
  const oldDate = new Date('2000-01-01');
  const { ok } = checkQuality({ ...base, postedAt: oldDate }, { maxAgeDays: 0 });
  assert.equal(ok, true);
});

test('checkQuality rejects job older than maxAgeDays when enabled', () => {
  const nowMs = new Date('2025-06-01').getTime();
  const oldDate = new Date('2025-01-01'); // ~150 days before nowMs
  const { ok, reason } = checkQuality({ ...base, postedAt: oldDate }, { maxAgeDays: 30, nowMs });
  assert.equal(ok, false);
  assert.equal(reason, 'stale');
});

test('checkQuality passes a recent job when maxAgeDays is set', () => {
  const nowMs = new Date('2025-06-01').getTime();
  const recentDate = new Date('2025-05-25'); // 7 days before nowMs
  const { ok } = checkQuality({ ...base, postedAt: recentDate }, { maxAgeDays: 30, nowMs });
  assert.equal(ok, true);
});

test('checkQuality does NOT reject when postedAt is null and maxAgeDays is set', () => {
  const nowMs = new Date('2025-06-01').getTime();
  const { ok } = checkQuality({ ...base, postedAt: null }, { maxAgeDays: 30, nowMs });
  assert.equal(ok, true);
});

test('checkQuality does NOT reject when postedAt is invalid and maxAgeDays is set', () => {
  const nowMs = new Date('2025-06-01').getTime();
  const { ok } = checkQuality({ ...base, postedAt: new Date('not-a-date') }, { maxAgeDays: 30, nowMs });
  assert.equal(ok, true);
});

// --- Rule 4: Clean job passes ---

test('checkQuality passes a clean job with all fields present', () => {
  const { ok, reason } = checkQuality(base);
  assert.equal(ok, true);
  assert.equal(reason, null);
});
