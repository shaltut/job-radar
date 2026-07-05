import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertJobs, getJobsToNotify, markNotified, getJobsToScore, setScore, setScoreError, getJobsToTailor, setMaterials, setTailorError, getFollowUps, dismissStaleJobs } from '../src/db.js';
import { dedupeHash } from '../src/dedupe.js';

// Fake pg client: records queries; simulates ON CONFLICT DO NOTHING returning only "new" rows.
function fakeClient(existingHashes = []) {
  const seen = new Set(existingHashes);
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      if (/INSERT INTO jobs/i.test(text)) {
        const hash = params[0];
        if (seen.has(hash)) return { rows: [] };          // conflict → no row returned
        seen.add(hash);
        return { rows: [{ id: seen.size, dedupe_hash: hash }] };
      }
      if (/SELECT/i.test(text)) return { rows: [{ id: 1, title: 'T', company: 'C', location: 'R', market: 'global', url: 'u' }] };
      if (/UPDATE jobs SET status/i.test(text)) return { rowCount: (params[0] || []).length };
      return { rows: [] };
    },
  };
}

test('upsertJobs inserts new jobs and returns the inserted rows only', async () => {
  process.env.JOBRADAR_TENANT_ID = '1';
  const j = { source: 'remotive', externalId: '1', title: 'DevOps', company: 'Acme', location: 'Remote',
    remote: true, url: 'https://x/1', description: 'd', tags: ['devops'], market: 'global', postedAt: null };
  const client = fakeClient();
  const inserted = await upsertJobs(client, [j, j]); // same job twice → second is a conflict
  assert.equal(inserted.length, 1);
  // first param to INSERT must be the dedupe hash
  const insertCall = client.calls.find((c) => /INSERT INTO jobs/i.test(c.text));
  assert.equal(insertCall.params[0], dedupeHash(j));
});

test('upsertJobs skips jobs whose hash already exists', async () => {
  process.env.JOBRADAR_TENANT_ID = '1';
  const j = { source: 's', title: 'T', url: 'u', market: 'global', tags: [], company: null, location: null, remote: null, externalId: null, description: null, postedAt: null };
  const client = fakeClient([dedupeHash(j)]);
  const inserted = await upsertJobs(client, [j]);
  assert.equal(inserted.length, 0);
});

test('upsertJobs stamps tenant_id + per-tenant conflict', async () => {
  process.env.JOBRADAR_TENANT_ID = '4';
  const calls = []; const client = { async query(text, params){ calls.push({text,params}); return { rows: [] }; } };
  await upsertJobs(client, [{ source:'s', externalId:'1', title:'T', company:'C', location:'L', remote:true, url:'u', description:'d', tags:[], market:'global', postedAt:null }]);
  assert.match(calls[0].text, /ON CONFLICT \(tenant_id, dedupe_hash\) DO NOTHING/);
  assert.match(calls[0].text, /tenant_id/);
  assert.ok(calls[0].params.includes(4));
});
test('upsertJobs throws when JOBRADAR_TENANT_ID unset', async () => {
  delete process.env.JOBRADAR_TENANT_ID;
  await assert.rejects(upsertJobs({ query: async()=>({rows:[]}) }, [{ source:'s', title:'T', url:'u', market:'global', tags:[], externalId:null }]));
});

test('getJobsToNotify queries status=new within the window', async () => {
  const client = fakeClient();
  const rows = await getJobsToNotify(client, 24);
  assert.ok(Array.isArray(rows));
  const q = client.calls.at(-1);
  assert.match(q.text, /status\s*=\s*'new'/i);
  assert.match(q.text, /interval/i);
});

test('markNotified updates the given ids to notified + stamps status_changed_at', async () => {
  const client = fakeClient();
  const n = await markNotified(client, [1, 2, 3]);
  assert.equal(n, 3);
  const q = client.calls.at(-1);
  assert.match(q.text, /status\s*=\s*'notified'/i);
  assert.match(q.text, /status_changed_at\s*=\s*now\(\)/i);
});

test('markNotified is a no-op for an empty id list', async () => {
  const client = fakeClient();
  const n = await markNotified(client, []);
  assert.equal(n, 0);
  assert.equal(client.calls.length, 0);
});

test('getJobsToScore selects unscored actionable jobs; --all selects regardless of score', async () => {
  const calls = [];
  const client = { async query(text, params) { calls.push({ text, params }); return { rows: [{ id: 1, title: 'T' }] }; } };
  await getJobsToScore(client, { all: false });
  assert.match(calls[0].text, /score IS NULL/);
  assert.match(calls[0].text, /status IN \('new','notified','shortlisted'\)/);
  await getJobsToScore(client, { all: true });
  assert.doesNotMatch(calls[1].text, /score IS NULL/);
});

test('setScore writes score + reason + fits + skill arrays by id', async () => {
  let q;
  const client = { async query(text, params) { q = { text, params }; return { rowCount: 1 }; } };
  await setScore(client, 7, { score: 88, reason: 'great fit', seniorityFit: 'high', domainFit: 'medium', remoteFit: 'high', matchedSkills: ['Go'], missingSkills: ['Rust'] });
  assert.match(q.text, /UPDATE jobs SET score = \$1, score_reason = \$2, seniority_fit = \$3, domain_fit = \$4, remote_fit = \$5, matched_skills = \$6, missing_skills = \$7, clean_title = \$8, tech_stack = \$9, work_mode = \$10, locations = \$11, eligibility = \$12, salary_range = \$13, salary_source = \$14, salary_ask = \$15, salary_usd_min = \$16, salary_usd_max = \$17, category = \$18, eligibility_std = \$19 WHERE id = \$20/);
  assert.deepEqual(q.params, [88, 'great fit', 'high', 'medium', 'high', ['Go'], ['Rust'], null, null, null, null, null, null, null, null, null, null, null, null, 7]);
});

test('setScore null-fills missing explainer fields', async () => {
  let q;
  const client = { async query(text, params) { q = { text, params }; return { rowCount: 1 }; } };
  await setScore(client, 7, { score: 50 });
  assert.deepEqual(q.params, [50, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 7]);
});

test('getJobsToScore backfill mode targets high-score inbox missing the latest enrichment (category)', async () => {
  const calls = [];
  const client = { async query(text, params) { calls.push({ text, params }); return { rows: [] }; } };
  await getJobsToScore(client, { backfill: true, threshold: 70 });
  assert.match(calls[0].text, /score >= \$1 AND status IN \('new','notified','shortlisted'\) AND category IS NULL/);
  assert.deepEqual(calls[0].params, [70, 200]);
});

test('getJobsToNotify gates on threshold (or unscored) and sorts by score', async () => {
  const calls = [];
  const client = { async query(text, params) { calls.push({ text, params }); return { rows: [] }; } };
  await getJobsToNotify(client, 24, 70);
  const c = calls[0];
  assert.match(c.text, /score >= \$2 OR score IS NULL/);
  assert.match(c.text, /ORDER BY score DESC NULLS LAST/);
  assert.equal(c.params[1], 70); // threshold bound as the 2nd param (number)
});

test('getJobsToTailor selects shortlisted jobs lacking materials (bounded error retry)', async () => {
  const calls = [];
  const client = { async query(text, params) { calls.push({ text, params }); return { rows: [{ id: 1 }] }; } };
  await getJobsToTailor(client, { limit: 5 });
  assert.match(calls[0].text, /status = 'shortlisted'/);
  assert.match(calls[0].text, /materials_status IS NULL OR \(materials_status = 'error' AND tailor_attempts < 3\)/);
  assert.match(calls[0].text, /ORDER BY score DESC NULLS LAST/);
  assert.equal(calls[0].params[0], 5);
});

test('setMaterials writes pdf basenames + apply_answers + ready status + bumps attempts', async () => {
  let q; const client = { async query(text, params) { q = { text, params }; return {}; } };
  await setMaterials(client, 7, 'cv.pdf', 'cover.pdf', { summary: 'x' });
  assert.match(q.text, /materials_status = 'ready'/);
  assert.match(q.text, /apply_answers = \$3/);
  assert.match(q.text, /tailor_attempts = tailor_attempts \+ 1/);
  assert.match(q.text, /tailor_error = NULL/);
  assert.deepEqual(q.params, ['cv.pdf', 'cover.pdf', JSON.stringify({ summary: 'x' }), 7]);
});

test('setMaterials defaults missing answers to {}', async () => {
  let q; const client = { async query(text, params) { q = { text, params }; return {}; } };
  await setMaterials(client, 7, 'cv.pdf', 'cover.pdf');
  assert.equal(q.params[2], '{}');
});

test('setTailorError records the error + error status + bumps attempts', async () => {
  let q; const client = { async query(text, params) { q = { text, params }; return {}; } };
  await setTailorError(client, 9, 'boom');
  assert.match(q.text, /materials_status = 'error'/);
  assert.match(q.text, /tailor_attempts = tailor_attempts \+ 1/);
  assert.deepEqual(q.params, ['boom', 9]);
});

test('getFollowUps queries applied (≥appliedDays) + interviewing (≥interviewingDays), oldest first', async () => {
  const calls = [];
  const client = { async query(text, params) { calls.push({ text, params }); return { rows: [{ id: 1 }] }; } };
  await getFollowUps(client, { appliedDays: 7, interviewingDays: 5 });
  assert.match(calls[0].text, /status = 'applied' AND status_changed_at < now\(\) - \(\$1 \|\| ' days'\)::interval/);
  assert.match(calls[0].text, /status = 'interviewing' AND status_changed_at < now\(\) - \(\$2 \|\| ' days'\)::interval/);
  assert.match(calls[0].text, /ORDER BY status_changed_at ASC/);
  assert.match(calls[0].text, /days_since/);
  assert.deepEqual(calls[0].params, ['7', '5']);
});

test('getJobsToNotify selects the match-explainer columns for the digest cards', async () => {
  const calls = [];
  const client = { async query(text, params) { calls.push({ text, params }); return { rows: [] }; } };
  await getJobsToNotify(client, 24, 70);
  assert.match(calls[0].text, /seniority_fit, domain_fit, remote_fit, matched_skills, missing_skills/);
});

test('getJobsToScore default branch caps by score_attempts', async () => {
  let captured;
  const client = { query: async (sql, params) => { captured = { sql, params }; return { rows: [] }; } };
  await getJobsToScore(client, {}); // defaults: maxAttempts 3
  assert.match(captured.sql, /score IS NULL/);
  assert.match(captured.sql, /score_attempts < \$2/);
  assert.deepEqual(captured.params, [200, 3]); // [limit, maxAttempts]
});

test('getJobsToScore all-mode does NOT filter by score_attempts', async () => {
  let captured;
  const client = { query: async (sql, params) => { captured = { sql, params }; return { rows: [] }; } };
  await getJobsToScore(client, { all: true });
  assert.doesNotMatch(captured.sql, /score_attempts/);
  assert.deepEqual(captured.params, [200]);
});

test('setScoreError bumps the attempt counter for the job', async () => {
  let captured;
  const client = { query: async (sql, params) => { captured = { sql, params }; return { rowCount: 1 }; } };
  await setScoreError(client, 42);
  assert.match(captured.sql, /score_attempts = score_attempts \+ 1/);
  assert.deepEqual(captured.params, [42]);
});

test('setScore writes the AI summary fields', async () => {
  let captured;
  const client = { query: async (text, values) => { captured = { text, values }; return { rows: [] }; } };
  await setScore(client, 99, {
    score: 80, reason: 'ok', cleanTitle: 'Backend @ Acme',
    techStack: ['Go'], workMode: 'remote', locations: ['Berlin'], eligibility: 'US citizens only',
  });
  assert.match(captured.text, /clean_title = \$8/);
  assert.match(captured.text, /eligibility = \$12/);
  assert.match(captured.text, /WHERE id = \$20/);
  assert.deepEqual(captured.values, [80, 'ok', null, null, null, null, null, 'Backend @ Acme', ['Go'], 'remote', ['Berlin'], 'US citizens only', null, null, null, null, null, null, null, 99]);
});

test('setScore writes the salary fields', async () => {
  let q; const client = { async query(text, params) { q = { text, params }; return { rowCount: 1 }; } };
  await setScore(client, 7, { score: 80, salaryRange: '$120k–$150k', salarySource: 'listed', salaryAsk: '$145k' });
  assert.match(q.text, /salary_range = \$13, salary_source = \$14, salary_ask = \$15, salary_usd_min = \$16, salary_usd_max = \$17, category = \$18, eligibility_std = \$19 WHERE id = \$20/);
  assert.equal(q.params[12], '$120k–$150k'); assert.equal(q.params[13], 'listed'); assert.equal(q.params[14], '$145k'); assert.equal(q.params[19], 7);
});
test('setScore writes the USD salary fields', async () => {
  let q; const client = { async query(text, params) { q = { text, params }; return { rowCount: 1 }; } };
  await setScore(client, 7, { score: 80, salaryUsdMin: 120000, salaryUsdMax: 150000 });
  assert.equal(q.params[15], 120000); assert.equal(q.params[16], 150000); assert.equal(q.params[19], 7);
});
test('setScore writes category + eligibility_std', async () => {
  let q; const client = { async query(text, params) { q = { text, params }; return { rowCount: 1 }; } };
  await setScore(client, 7, { score: 80, category: 'Technology & IT', eligibilityStd: 'us_work_authorization' });
  assert.equal(q.params[17], 'Technology & IT'); assert.equal(q.params[18], 'us_work_authorization'); assert.equal(q.params[19], 7);
});
test('getJobsToScore backfill targets category IS NULL', async () => {
  const calls = []; const client = { async query(text, params) { calls.push({ text, params }); return { rows: [] }; } };
  await getJobsToScore(client, { backfill: true, threshold: 70 });
  assert.match(calls[0].text, /category IS NULL/);
});
test('getJobsToNotify selects salary_usd_min/salary_usd_max (digest parity)', async () => {
  const calls = []; const client = { async query(text, params) { calls.push({ text, params }); return { rows: [] }; } };
  await getJobsToNotify(client, 24, 70);
  assert.match(calls[0].text, /salary_range, salary_source, salary_ask, salary_usd_min, salary_usd_max/);
});
test('getJobsToNotify selects category/eligibility_std (digest parity)', async () => {
  const calls = []; const client = { async query(text, params) { calls.push({ text, params }); return { rows: [] }; } };
  await getJobsToNotify(client, 24, 70);
  assert.match(calls[0].text, /category, eligibility_std/);
});
test('getJobsToTailor selects salary_ask', async () => {
  const calls = []; const client = { async query(text, params) { calls.push({ text, params }); return { rows: [{ id: 1 }] }; } };
  await getJobsToTailor(client, { limit: 5 });
  assert.match(calls[0].text, /salary_ask/);
});

test('upsertJobs guards against duplicate (source, external_id) re-fetches', async () => {
  process.env.JOBRADAR_TENANT_ID = '1';
  const calls = [];
  const client = { query: async (text, values) => { calls.push({ text, values }); return { rows: [] }; } };
  await upsertJobs(client, [{ source: 'jobicy', externalId: '144851', title: 'Lead Backend Engineer', company: 'DraftKings Inc.', location: 'Ukraine', remote: true, url: 'u', description: 'd', tags: [], market: 'global', postedAt: null }]);
  const insert = calls[0].text;
  assert.match(insert, /WHERE NOT EXISTS/);
  assert.match(insert, /source = \$2 AND external_id = \$3 AND \$3 IS NOT NULL/);
  assert.match(insert, /ON CONFLICT \(tenant_id, dedupe_hash\) DO NOTHING/);
});

test('dismissStaleJobs dismisses only active jobs past the age threshold (posted_at, fallback discovered_at)', async () => {
  let captured;
  const client = { query: async (text, values) => { captured = { text, values }; return { rows: [{ id: 1 }, { id: 2 }] }; } };
  const ids = await dismissStaleJobs(client, { days: 60 });
  assert.match(captured.text, /UPDATE jobs SET status = 'dismissed', status_changed_at = now\(\)/);
  assert.match(captured.text, /status IN \('new','notified'\)/);
  assert.match(captured.text, /coalesce\(posted_at, discovered_at\) < now\(\) - \(\$1 \|\| ' days'\)::interval/);
  assert.deepEqual(captured.values, ['60']);
  assert.deepEqual(ids, [1, 2]);
});
