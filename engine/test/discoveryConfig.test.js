import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  familyOf,
  applySourceToggles,
  mergeExcludes,
  isSourceDue,
} from '../src/sources/discoveryConfig.js';

// ---- familyOf ----------------------------------------------------------------

test('familyOf strips -<country> suffixes but NOT -mena; leaves base names intact', () => {
  assert.equal(familyOf('bayt-uae'), 'bayt');
  assert.equal(familyOf('bayt-ksa'), 'bayt');
  assert.equal(familyOf('naukrigulf-oman'), 'naukrigulf');
  assert.equal(familyOf('gulftalent-qatar'), 'gulftalent');
  // -mena is no longer stripped: these are distinct families from their global legs
  assert.equal(familyOf('linkedin-mena'), 'linkedin-mena');
  assert.equal(familyOf('indeed-mena'), 'indeed-mena');
  assert.equal(familyOf('linkedin'), 'linkedin');
  assert.equal(familyOf('remotive'), 'remotive');
  assert.equal(familyOf('remoteok'), 'remoteok');
  assert.equal(familyOf('jobicy'), 'jobicy');
  assert.equal(familyOf('arbeitnow'), 'arbeitnow');
});

test('familyOf does not strip a non-country suffix', () => {
  // 'remoteok' must NOT be confused as remote + 'ok' country; only known MENA keys/-mena strip
  assert.equal(familyOf('remoteok'), 'remoteok');
  assert.equal(familyOf('some-source'), 'some-source');
});

// ---- applySourceToggles ------------------------------------------------------

const sampleSources = [
  { name: 'remotive', market: 'global', fetch() {} },
  { name: 'remoteok', market: 'global', fetch() {} },
  { name: 'jobicy', market: 'global', fetch() {} },
  { name: 'bayt-uae', market: 'mena', fetch() {} },
  { name: 'bayt-ksa', market: 'mena', fetch() {} },
  { name: 'naukrigulf-uae', market: 'mena', fetch() {} },
  { name: 'linkedin', market: 'global', fetch() {} },
  { name: 'linkedin-mena', market: 'mena', fetch() {} },
];

test('applySourceToggles: null map returns input unchanged (P2)', () => {
  assert.equal(applySourceToggles(sampleSources, null), sampleSources);
  assert.equal(applySourceToggles(sampleSources, undefined), sampleSources);
});

test('applySourceToggles: drops only families set false', () => {
  const map = new Map([['bayt', false], ['linkedin', false]]);
  const names = applySourceToggles(sampleSources, map).map((s) => s.name);
  // bayt-* and the global linkedin gone; linkedin-mena is its OWN family (not toggled), kept
  // naukrigulf-uae kept (not in map)
  assert.deepEqual(names, ['remotive', 'remoteok', 'jobicy', 'naukrigulf-uae', 'linkedin-mena']);
});

test('applySourceToggles: a family absent from the map is kept (unknown defaults visible)', () => {
  const map = new Map([['remotive', true]]); // only remotive listed; everything else absent
  const names = applySourceToggles(sampleSources, map).map((s) => s.name);
  assert.deepEqual(names, sampleSources.map((s) => s.name)); // nothing dropped
});

test('applySourceToggles: empty map drops nothing (no override)', () => {
  const names = applySourceToggles(sampleSources, new Map()).map((s) => s.name);
  assert.deepEqual(names, sampleSources.map((s) => s.name));
});

// ---- mergeExcludes -----------------------------------------------------------

test('mergeExcludes: null/[] DB leaves the profile list unchanged (P2)', () => {
  const prof = ['junior', 'intern'];
  assert.deepEqual(mergeExcludes(prof, null), prof);
  assert.deepEqual(mergeExcludes(prof, []), prof);
});

test('mergeExcludes: set-union adds DB-only terms', () => {
  const out = mergeExcludes(['junior', 'intern'], ['ios developer', 'sales']);
  assert.deepEqual(out, ['junior', 'intern', 'ios developer', 'sales']);
});

test('mergeExcludes: dedupes case-insensitively (profile term wins position)', () => {
  const out = mergeExcludes(['Junior', 'Intern'], ['junior', 'sales', 'INTERN']);
  // 'junior'/'INTERN' already present (case-insensitive) → only 'sales' added
  assert.equal(out.filter((t) => t.toLowerCase() === 'junior').length, 1);
  assert.equal(out.filter((t) => t.toLowerCase() === 'intern').length, 1);
  assert.ok(out.some((t) => t === 'sales'));
});

test('mergeExcludes: handles a missing/empty profile list', () => {
  assert.deepEqual(mergeExcludes(undefined, ['sales']), ['sales']);
  assert.deepEqual(mergeExcludes([], ['sales']), ['sales']);
  assert.deepEqual(mergeExcludes(undefined, null), []);
});

// ---- isSourceDue ----------------------------------------------------------------

// Fixed reference point: 2026-06-20T12:00:00Z
const FIXED_NOW = new Date('2026-06-20T12:00:00Z');

test('isSourceDue: null last_run_at → always due', () => {
  assert.equal(isSourceDue({ run_interval_hours: 24, last_run_at: null }, FIXED_NOW), true);
});

test('isSourceDue: undefined last_run_at → always due', () => {
  assert.equal(isSourceDue({ run_interval_hours: 24 }, FIXED_NOW), true);
});

test('isSourceDue: last_run_at 25h ago with interval 24 → due', () => {
  const lastRun = new Date(FIXED_NOW.getTime() - 25 * 3_600_000);
  assert.equal(isSourceDue({ run_interval_hours: 24, last_run_at: lastRun }, FIXED_NOW), true);
});

test('isSourceDue: last_run_at 2h ago with interval 6 → NOT due', () => {
  const lastRun = new Date(FIXED_NOW.getTime() - 2 * 3_600_000);
  assert.equal(isSourceDue({ run_interval_hours: 6, last_run_at: lastRun }, FIXED_NOW), false);
});

test('isSourceDue: exactly at interval boundary → due', () => {
  const lastRun = new Date(FIXED_NOW.getTime() - 24 * 3_600_000);
  assert.equal(isSourceDue({ run_interval_hours: 24, last_run_at: lastRun }, FIXED_NOW), true);
});

test('isSourceDue: null run_interval_hours defaults to 24', () => {
  // 23h ago with default interval 24 → NOT due
  const lastRun23h = new Date(FIXED_NOW.getTime() - 23 * 3_600_000);
  assert.equal(isSourceDue({ run_interval_hours: null, last_run_at: lastRun23h }, FIXED_NOW), false);
  // 25h ago with default interval 24 → due
  const lastRun25h = new Date(FIXED_NOW.getTime() - 25 * 3_600_000);
  assert.equal(isSourceDue({ run_interval_hours: null, last_run_at: lastRun25h }, FIXED_NOW), true);
});

test('isSourceDue: accepts ms number as now', () => {
  const lastRun = new Date(FIXED_NOW.getTime() - 25 * 3_600_000);
  assert.equal(isSourceDue({ run_interval_hours: 24, last_run_at: lastRun }, FIXED_NOW.getTime()), true);
});

test('isSourceDue: empty row (no fields) → due (treated as never ran)', () => {
  assert.equal(isSourceDue({}, FIXED_NOW), true);
});
