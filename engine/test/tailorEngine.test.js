import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapHtml, buildTailorMessages, parseTailorResult, generateTailoredDocs, normalizeAnswers, buildFacts, ANSWER_KEYS } from '../src/tailorEngine.js';

test('wrapHtml produces a full styled document containing the body (cv gets a rule after header)', () => {
  const out = wrapHtml('<header><h1>Ahmed</h1></header><section><h2>X</h2></section>', { kind: 'cv' });
  assert.match(out, /<!doctype html>/i);
  assert.match(out, /<style>/);
  assert.match(out, /Ahmed/);
  assert.match(out, /class="page cv"/);
  assert.match(out, /class="rule"/);
});

test('wrapHtml cover kind has no rule', () => {
  const out = wrapHtml('<p>Dear team</p>', { kind: 'cover' });
  assert.match(out, /class="page cover"/);
  assert.doesNotMatch(out, /class="rule"/);
  assert.match(out, /Dear team/);
});

test('buildTailorMessages includes the CV and the job description', () => {
  const msgs = buildTailorMessages('MY CV TEXT', { title: 'SRE', company: 'Acme', description: 'Need K8s' });
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[1].content, /MY CV TEXT/);
  assert.match(msgs[1].content, /SRE/);
  assert.match(msgs[1].content, /Acme/);
  assert.match(msgs[1].content, /Need K8s/);
});

test('parseTailorResult returns body fragments and rejects bad input', () => {
  const ok = parseTailorResult('{"cv_html":"<h1>x</h1>","cover_html":"<p>y</p>"}');
  assert.equal(ok.cvHtml, '<h1>x</h1>');
  assert.equal(ok.coverHtml, '<p>y</p>');
  assert.throws(() => parseTailorResult('not json'), /valid JSON/);
  assert.throws(() => parseTailorResult('{"cover_html":"<p>y</p>"}'), /missing cv_html/);
  assert.throws(() => parseTailorResult('{"cv_html":"<h1>x</h1>"}'), /missing cover_html/);
});

test('generateTailoredDocs calls OpenAI and returns wrapped HTML docs', async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"cv_html":"<header><h1>Ahmed</h1></header>","cover_html":"<p>Hi</p>"}' } }] }) };
  };
  const docs = await generateTailoredDocs(
    { title: 'SRE', company: 'Acme', description: 'd' },
    { cvText: 'CV', apiKey: 'k', model: 'gpt-5.5', effort: 'high', fetchImpl: fakeFetch },
  );
  assert.match(captured.url, /openai\.com/);
  assert.equal(captured.body.model, 'gpt-5.5');
  assert.equal(captured.body.reasoning_effort, 'high');
  assert.equal(captured.body.response_format.type, 'json_object');
  assert.match(docs.cvHtml, /<!doctype html>/i);
  assert.match(docs.cvHtml, /Ahmed/);
  assert.match(docs.coverHtml, /Hi/);
});

test('generateTailoredDocs throws on non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });
  await assert.rejects(
    () => generateTailoredDocs({ title: 'x' }, { cvText: 'CV', apiKey: 'k', model: 'm', fetchImpl: fakeFetch }),
    /OpenAI HTTP 429/,
  );
});

test('generateTailoredDocs requires api key and cv text', async () => {
  await assert.rejects(() => generateTailoredDocs({}, { cvText: 'CV', fetchImpl: async () => ({}) }), /API key/);
  await assert.rejects(() => generateTailoredDocs({}, { apiKey: 'k', fetchImpl: async () => ({}) }), /base CV/);
});

test('normalizeAnswers returns exactly the 7 keys, missing -> empty string', () => {
  const a = normalizeAnswers({ summary: ' hi ', why_role: 'x', bogus: 'drop' });
  assert.deepEqual(Object.keys(a).sort(), [...ANSWER_KEYS].sort());
  assert.equal(a.summary, 'hi');
  assert.equal(a.why_role, 'x');
  assert.equal(a.salary, '');
  assert.equal(a.bogus, undefined);
});

test('normalizeAnswers tolerates non-object input', () => {
  for (const k of ANSWER_KEYS) assert.equal(normalizeAnswers(null)[k], '');
  assert.equal(normalizeAnswers('nope').summary, '');
});

test('buildFacts includes notice/work_auth/years/location and the open-salary phrasing when blank', () => {
  const f = buildFacts({ notice_period_days: '30', work_authorization: 'visa needed', years_experience: '9', location_city: 'Riyadh', location_country: 'Saudi Arabia', salary_expectation: '' });
  assert.match(f, /Notice period: 30 days/);
  assert.match(f, /visa needed/);
  assert.match(f, /Years of experience: 9/);
  assert.match(f, /Riyadh, Saudi Arabia/);
  assert.match(f, /open \/ negotiable/);
});

test('buildTailorMessages embeds the facts block and asks for apply_answers', () => {
  const msgs = buildTailorMessages('CV', { title: 'SRE', description: 'd' }, 'APPLICANT FACTS:\n- Notice period: 30 days');
  assert.match(msgs[0].content, /apply_answers/);
  assert.match(msgs[1].content, /APPLICANT FACTS/);
});

test('parseTailorResult returns normalized answers (and {} when apply_answers absent)', () => {
  const withA = parseTailorResult('{"cv_html":"<h1>x</h1>","cover_html":"<p>y</p>","apply_answers":{"summary":"s","salary":"open"}}');
  assert.equal(withA.answers.summary, 's');
  assert.equal(withA.answers.salary, 'open');
  assert.equal(withA.answers.why_role, '');
  const noA = parseTailorResult('{"cv_html":"<h1>x</h1>","cover_html":"<p>y</p>"}');
  assert.deepEqual(Object.keys(noA.answers).sort(), [...ANSWER_KEYS].sort());
  assert.equal(noA.answers.summary, '');
});

test('generateTailoredDocs returns normalized answers from the model', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"cv_html":"<header><h1>A</h1></header>","cover_html":"<p>c</p>","apply_answers":{"summary":"hi","notice":"30 days"}}' } }] }) });
  const docs = await generateTailoredDocs({ title: 'SRE' }, { cvText: 'CV', facts: 'F', apiKey: 'k', model: 'm', fetchImpl: fakeFetch });
  assert.equal(docs.answers.summary, 'hi');
  assert.equal(docs.answers.notice, '30 days');
  assert.equal(docs.answers.why_role, '');
});

test('buildFacts uses profile.salary_expectation, else job.salary_ask, else generic', () => {
  assert.match(buildFacts({ salary_expectation: '$160k' }, { salary_ask: '$145k' }), /Salary expectation: \$160k/);
  assert.match(buildFacts({}, { salary_ask: '$145k' }), /Salary expectation: \$145k/);
  assert.match(buildFacts({}, {}), /open \/ negotiable/);
});
