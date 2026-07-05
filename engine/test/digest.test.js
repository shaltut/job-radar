import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDigest, formatFollowups, formatHealthFooter, formatSourceAlert, formatCatastrophe, formatJobCard, jobButtons, jobSummaryLine } from '../src/digest.js';

test('empty list yields a friendly no-jobs message', () => {
  assert.match(formatDigest([]), /no new jobs/i);
});

test('formats one job with title, company, market and url', () => {
  const out = formatDigest([{ title: 'SRE', company: 'Globex', location: 'Remote', market: 'global', url: 'https://x/1' }]);
  assert.match(out, /SRE/);
  assert.match(out, /Globex/);
  assert.match(out, /https:\/\/x\/1/);
});

test('header reports the count', () => {
  const jobs = [1, 2, 3].map((i) => ({ title: `J${i}`, company: 'C', location: 'Cairo', market: 'mena', url: `https://x/${i}` }));
  assert.match(formatDigest(jobs), /3 new/);
});

test('caps at 25 and notes the overflow', () => {
  const jobs = Array.from({ length: 30 }, (_, i) => ({ title: `J${i}`, company: 'C', location: 'R', market: 'global', url: `https://x/${i}` }));
  const out = formatDigest(jobs);
  assert.match(out, /\+5 more/);
  assert.equal((out.match(/^\d+\./gm) || []).length, 25);
});

test('shows posted date (YYYY-MM-DD) when posted_at present, omits when absent', () => {
  const withDate = formatDigest([{ title: 'Backend', company: 'C', location: 'Remote', market: 'global', url: 'https://x/1', posted_at: '2026-06-15T10:00:00.000Z' }]);
  assert.match(withDate, /2026-06-15/);
  const noDate = formatDigest([{ title: 'Backend', company: 'C', location: 'Remote', market: 'global', url: 'https://x/1' }]);
  assert.doesNotMatch(noDate, /\d{4}-\d{2}-\d{2}/);
});

test('accepts a Date object for posted_at', () => {
  const out = formatDigest([{ title: 'Backend', company: 'C', location: 'Remote', market: 'global', url: 'https://x/1', posted_at: new Date('2026-06-15T10:00:00Z') }]);
  assert.match(out, /2026-06-15/);
});

test('formatDigest shows the fit score when present', () => {
  const out = formatDigest([{ title: 'SRE', company: 'C', location: 'Remote', market: 'global', url: 'https://x/1', score: 88 }]);
  assert.match(out, /88/);
});

test('formatFollowups lists jobs with status + days-since', () => {
  const out = formatFollowups([{ title: 'Backend', company: 'Acme', url: 'https://x/9', status: 'applied', days_since: 9 }]);
  assert.match(out, /Follow up/);
  assert.match(out, /Backend/);
  assert.match(out, /Acme/);
  assert.match(out, /9d/);
  assert.match(out, /applied/);
});

const NOW = Date.parse('2026-06-18T08:00:00Z');
const ago = (h) => new Date(NOW - h * 3600_000).toISOString();
const ok = (source, over = {}) => ({ source, family: source, lastFetched: 5, lastErrored: false, lastError: null, lastAt: ago(3), consecutiveErrors: 0, consecutiveDry: 0, stale: false, ...over });

test('formatHealthFooter: empty summary', () => {
  assert.match(formatHealthFooter([], { nowMs: NOW }), /no source runs recorded yet/);
});

test('formatHealthFooter: all healthy shows ok count only', () => {
  const s = formatHealthFooter([ok('remotive'), ok('remoteok')], { nowMs: NOW });
  assert.equal(s, '🩺 2 ok');
});

test('formatHealthFooter: errored source shown with ❌ and excluded from ok count', () => {
  const s = formatHealthFooter([ok('remotive'), ok('bayt-uae', { lastErrored: true, lastError: '403 Forbidden', consecutiveErrors: 1, consecutiveDry: 1 })], { nowMs: NOW });
  assert.match(s, /🩺 1 ok/);
  assert.match(s, /❌ bayt-uae: 403 Forbidden/);
});

test('formatHealthFooter: dry source past threshold shown with ⚠️', () => {
  const s = formatHealthFooter([ok('linkedin', { lastFetched: 0, consecutiveDry: 3 })], { dryRuns: 3, nowMs: NOW });
  assert.match(s, /⚠️ linkedin dry 3 runs/);
});

test('formatHealthFooter: all stale renders muted idle line, no warnings', () => {
  const s = formatHealthFooter([ok('remotive', { stale: true, lastAt: ago(72) })], { nowMs: NOW });
  assert.match(s, /last discover run 3d ago/);
  assert.doesNotMatch(s, /❌|⚠️/);
});

test('formatHealthFooter escapes HTML in source/error', () => {
  const s = formatHealthFooter([ok('a&b', { lastErrored: true, lastError: '<x>', consecutiveErrors: 1 })], { nowMs: NOW });
  assert.match(s, /a&amp;b/);
  assert.match(s, /&lt;x&gt;/);
});

test('formatSourceAlert: null when nothing errored', () => {
  assert.equal(formatSourceAlert([{ source: 'a', errored: false, error: null }]), null);
  assert.equal(formatSourceAlert([]), null);
});

test('formatSourceAlert: lists errored sources with count and escapes', () => {
  const s = formatSourceAlert([
    { source: 'bayt-uae', errored: true, error: '403' },
    { source: 'x&y', errored: false, error: null },
    { source: 'linkedin', errored: true, error: '<timeout>' },
  ]);
  assert.match(s, /source errors \(2\)/);
  assert.match(s, /• bayt-uae: <i>403<\/i>/);
  assert.match(s, /• linkedin: <i>&lt;timeout&gt;<\/i>/);
});

test('formatCatastrophe renders the kind and message, escaped', () => {
  const s = formatCatastrophe('discover', new Error('DB <down>'));
  assert.match(s, /discover run failed/);
  assert.match(s, /DB &lt;down&gt;/);
});

test('formatJobCard renders score, title link, reason, fit and skills; omits null fits; escapes', () => {
  const j = {
    id: 7, title: 'Senior <Backend>', company: 'Acme & Co', location: 'Dubai', market: 'mena',
    url: 'https://x/7', posted_at: '2026-06-10', score: 88, score_reason: 'strong .NET fit',
    seniority_fit: 'high', domain_fit: 'medium', remote_fit: null,
    matched_skills: ['Go', 'Kubernetes'], missing_skills: ['Rust'],
  };
  const s = formatJobCard(j);
  assert.match(s, /🎯 88/);
  assert.match(s, /<a href="https:\/\/x\/7">Senior &lt;Backend&gt;<\/a>/);
  assert.match(s, /Acme &amp; Co/);
  assert.match(s, /strong \.NET fit/);
  assert.match(s, /seniority:high · domain:medium/);
  assert.doesNotMatch(s, /remote:/);            // null fit omitted
  assert.match(s, /✅ Go, Kubernetes/);
  assert.match(s, /❌ Rust/);
});

test('formatJobCard tolerates a minimal job (no fits/skills/reason)', () => {
  const s = formatJobCard({ id: 1, title: 'SRE', market: 'global', url: 'u' });
  assert.match(s, /SRE/);
  assert.doesNotMatch(s, /✅|❌|seniority:/);
});

test('jobButtons builds the shortlist/dismiss inline keyboard', () => {
  assert.deepEqual(jobButtons(13), { inline_keyboard: [[
    { text: '✅ Shortlist', callback_data: 'sl:13' },
    { text: '✖ Dismiss', callback_data: 'ds:13' },
  ]] });
});

test('jobSummaryLine renders stack/mode/location with +N overflow', () => {
  const line = jobSummaryLine({
    tech_stack: ['Go', 'Postgres', 'K8s', 'AWS', 'Redis'], work_mode: 'remote', locations: ['US (remote)'],
  });
  assert.equal(line, 'Go · Postgres · K8s · AWS +1 · remote · US (remote)');
});

test('jobSummaryLine falls back to location and tolerates empties', () => {
  assert.equal(jobSummaryLine({ location: 'Cairo' }), 'Cairo');
  assert.equal(jobSummaryLine({}), '');
});

test('formatDigest uses clean_title when present, raw title otherwise', () => {
  const out = formatDigest([
    { title: 'raw line', clean_title: 'Backend @ Acme', url: 'http://x', market: 'global' },
    { title: 'only raw', url: 'http://y', market: 'global' },
  ]);
  assert.match(out, /Backend @ Acme/);
  assert.match(out, /only raw/);
  assert.doesNotMatch(out, /raw line/);
});
