import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScoreMessages, parseScoreResult, scoreJob } from '../src/openai.js';

const job = { title: 'Senior Backend Engineer', company: 'Acme', location: 'Remote', market: 'global', description: 'Build APIs in .NET' };

test('buildScoreMessages returns system+user with profile and job', () => {
  const msgs = buildScoreMessages('PROFILE TEXT', job);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content.toLowerCase(), /json/); // required by json_object mode
  assert.equal(msgs[1].role, 'user');
  assert.match(msgs[1].content, /PROFILE TEXT/);
  assert.match(msgs[1].content, /Senior Backend Engineer/);
});

test('parseScoreResult clamps score and validates fits', () => {
  const r = parseScoreResult('{"score": 150, "reason": "great", "seniority_fit": "high", "domain_fit": "bogus", "remote_fit": "low"}');
  assert.equal(r.score, 100);
  assert.equal(r.reason, 'great');
  assert.equal(r.seniorityFit, 'high');
  assert.equal(r.domainFit, null);     // invalid enum → null
  assert.equal(r.remoteFit, 'low');
  assert.equal(parseScoreResult('{"score": -5}').score, 0);
});

test('parseScoreResult throws on bad JSON or missing score', () => {
  assert.throws(() => parseScoreResult('not json'), /JSON/);
  assert.throws(() => parseScoreResult('{"reason":"x"}'), /score/);
});

test('scoreJob calls OpenAI and returns parsed result; includes reasoning_effort only when set', async () => {
  let body;
  const fakeFetch = async (_url, opts) => {
    body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"score":82,"reason":"strong .NET fit","seniority_fit":"high","domain_fit":"medium","remote_fit":"high"}' } }] }) };
  };
  const r = await scoreJob(job, 'PROFILE', { fetchImpl: fakeFetch, apiKey: 'sk-x', model: 'gpt-5.5', effort: 'high', maxTokens: 8000 });
  assert.equal(r.score, 82);
  assert.equal(r.reason, 'strong .NET fit');
  assert.equal(body.model, 'gpt-5.5');
  assert.equal(body.reasoning_effort, 'high');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.max_completion_tokens, 8000);

  // no effort → param omitted
  let body2;
  const f2 = async (_u, o) => { body2 = JSON.parse(o.body); return { ok: true, json: async () => ({ choices: [{ message: { content: '{"score":50}' } }] }) }; };
  await scoreJob(job, 'P', { fetchImpl: f2, apiKey: 'k', model: 'm' });
  assert.equal('reasoning_effort' in body2, false);
});

test('scoreJob returns null on missing key, non-ok, throw, or garbage content', async () => {
  assert.equal(await scoreJob(job, 'P', { apiKey: '' }), null);
  assert.equal(await scoreJob(job, 'P', { apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 400 }) }), null);
  assert.equal(await scoreJob(job, 'P', { apiKey: 'k', fetchImpl: async () => { throw new Error('net'); } }), null);
  assert.equal(await scoreJob(job, 'P', { apiKey: 'k', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) }) }), null);
});

test('parseScoreResult extracts, trims, dedupes (case-insensitive), and caps skills at 8', () => {
  const r = parseScoreResult(JSON.stringify({
    score: 80, reason: 'ok',
    matched_skills: [' Go ', 'go', 'Kubernetes', '', 42, 'Docker'],
    missing_skills: ['Rust', 'rust', 'Terraform', 'AWS', 'GCP', 'Azure', 'Kafka', 'Redis', 'Postgres'],
  }));
  assert.deepEqual(r.matchedSkills, ['Go', 'Kubernetes', 'Docker']); // trimmed, deduped, non-strings/empties dropped
  assert.equal(r.missingSkills.length, 8);                            // capped at 8
  assert.equal(r.missingSkills[0], 'Rust');
});

test('parseScoreResult defaults skills to [] when absent or not arrays', () => {
  const r = parseScoreResult('{"score": 50}');
  assert.deepEqual(r.matchedSkills, []);
  assert.deepEqual(r.missingSkills, []);
  const r2 = parseScoreResult('{"score": 50, "matched_skills": "Go", "missing_skills": null}');
  assert.deepEqual(r2.matchedSkills, []);
  assert.deepEqual(r2.missingSkills, []);
});

test('parseScoreResult extracts summary fields', () => {
  const r = parseScoreResult(JSON.stringify({
    score: 70,
    clean_title: '  Backend / Frontend @ Acme  ',
    tech_stack: [' Go ', 'go', 'Postgres', 'K8s', 'AWS', 'Redis', 'Kafka', 'gRPC', 'Terraform'],
    work_mode: 'remote',
    locations: ['US (remote)', 'Berlin', 'US (remote)'],
    eligibility: 'US citizens only',
  }));
  assert.equal(r.cleanTitle, 'Backend / Frontend @ Acme'); // trimmed
  assert.deepEqual(r.techStack, ['Go', 'Postgres', 'K8s', 'AWS', 'Redis', 'Kafka', 'gRPC', 'Terraform']); // deduped, capped 8
  assert.equal(r.workMode, 'remote');
  assert.deepEqual(r.locations, ['US (remote)', 'Berlin']); // deduped
  assert.equal(r.eligibility, 'US citizens only');
});

test('parseScoreResult defaults/sanitizes summary fields', () => {
  const r = parseScoreResult('{"score": 50}');
  assert.equal(r.cleanTitle, null);
  assert.deepEqual(r.techStack, []);
  assert.equal(r.workMode, null);
  assert.deepEqual(r.locations, []);
  assert.equal(r.eligibility, null);
  const r2 = parseScoreResult('{"score": 50, "work_mode": "anywhere", "clean_title": "   "}');
  assert.equal(r2.workMode, null);   // invalid enum → null
  assert.equal(r2.cleanTitle, null); // blank → null
});

test('parseScoreResult extracts salary fields', () => {
  const r = parseScoreResult(JSON.stringify({
    score: 80, salary_range: '$120k–$150k/yr', salary_source: 'listed', salary_ask: '$145k',
  }));
  assert.equal(r.salaryRange, '$120k–$150k/yr');
  assert.equal(r.salarySource, 'listed');
  assert.equal(r.salaryAsk, '$145k');
});
test('parseScoreResult salary defaults/validates', () => {
  const r = parseScoreResult('{"score": 50}');
  assert.equal(r.salaryRange, null); assert.equal(r.salarySource, null); assert.equal(r.salaryAsk, null);
  assert.equal(parseScoreResult('{"score":50,"salary_source":"bogus"}').salarySource, null); // invalid enum → null
});

test('parseScoreResult extracts USD yearly salary as integers', () => {
  const r = parseScoreResult(JSON.stringify({ score: 80, salary_usd_min: 120000, salary_usd_max: 150000.7 }));
  assert.equal(r.salaryUsdMin, 120000);
  assert.equal(r.salaryUsdMax, 150001); // rounds
});

test('parseScoreResult USD salary defaults to null when absent', () => {
  const r = parseScoreResult('{"score": 50}');
  assert.equal(r.salaryUsdMin, null);
  assert.equal(r.salaryUsdMax, null);
});

test('parseScoreResult USD salary: explicit JSON null stays null (not 0)', () => {
  const r = parseScoreResult(JSON.stringify({ score: 50, salary_range: null, salary_usd_min: null, salary_usd_max: null }));
  assert.equal(r.salaryUsdMin, null);
  assert.equal(r.salaryUsdMax, null);
});

test('parseScoreResult USD salary rejects non-numbers and negatives → null', () => {
  const r = parseScoreResult(JSON.stringify({ score: 50, salary_usd_min: 'a lot', salary_usd_max: -100 }));
  assert.equal(r.salaryUsdMin, null);
  assert.equal(r.salaryUsdMax, null);
});

test('parseScoreResult swaps USD min/max when min > max', () => {
  const r = parseScoreResult(JSON.stringify({ score: 50, salary_usd_min: 150000, salary_usd_max: 120000 }));
  assert.equal(r.salaryUsdMin, 120000);
  assert.equal(r.salaryUsdMax, 150000);
});

test('parseScoreResult USD salary treats a single figure as both min and max when set equal by caller', () => {
  const r = parseScoreResult(JSON.stringify({ score: 50, salary_usd_min: 100000, salary_usd_max: 100000 }));
  assert.equal(r.salaryUsdMin, 100000);
  assert.equal(r.salaryUsdMax, 100000);
});

test('parseScoreResult category: valid value passes through', () => {
  const r = parseScoreResult(JSON.stringify({ score: 50, category: 'Finance & Accounting' }));
  assert.equal(r.category, 'Finance & Accounting');
});

test('parseScoreResult category: invalid or missing defaults to "Other"', () => {
  assert.equal(parseScoreResult('{"score": 50}').category, 'Other');
  assert.equal(parseScoreResult(JSON.stringify({ score: 50, category: 'Astrology' })).category, 'Other');
  assert.equal(parseScoreResult(JSON.stringify({ score: 50, category: null })).category, 'Other');
  assert.equal(parseScoreResult(JSON.stringify({ score: 50, category: 42 })).category, 'Other');
});

test('parseScoreResult category: "Other" itself passes through', () => {
  assert.equal(parseScoreResult(JSON.stringify({ score: 50, category: 'Other' })).category, 'Other');
});

test('parseScoreResult eligibility_std: valid value passes through', () => {
  const r = parseScoreResult(JSON.stringify({ score: 50, eligibility_std: 'us_work_authorization' }));
  assert.equal(r.eligibilityStd, 'us_work_authorization');
  for (const v of ['us_citizen_only', 'us_work_authorization', 'eu_work_authorization', 'uk_work_authorization', 'gcc_residency', 'security_clearance', 'none', 'other']) {
    assert.equal(parseScoreResult(JSON.stringify({ score: 50, eligibility_std: v })).eligibilityStd, v);
  }
});

test('parseScoreResult eligibility_std: invalid or missing defaults to "none"', () => {
  assert.equal(parseScoreResult('{"score": 50}').eligibilityStd, 'none');
  assert.equal(parseScoreResult(JSON.stringify({ score: 50, eligibility_std: 'bogus' })).eligibilityStd, 'none');
  assert.equal(parseScoreResult(JSON.stringify({ score: 50, eligibility_std: null })).eligibilityStd, 'none');
  assert.equal(parseScoreResult(JSON.stringify({ score: 50, eligibility_std: 7 })).eligibilityStd, 'none');
});
