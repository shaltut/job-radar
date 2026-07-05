const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const SYSTEM = [
  'You are an expert technical résumé writer and career coach.',
  "You tailor a candidate's CV, write a cover letter, and answer common application questions for ONE specific job — truthfully.",
  'NEVER invent employers, titles, dates, degrees, certifications, or skills the candidate does not have.',
  'You MAY reorder, re-emphasize, rephrase, and select the most relevant real experience and bullets to match the job.',
  'Return ONLY a JSON object with exactly these keys: {"cv_html": "...", "cover_html": "...", "apply_answers": {...}}.',
  'cv_html: a tailored résumé as an HTML BODY FRAGMENT — NO <html>, <head>, <style>, or <body> tags.',
  '  Structure: a <header> with <h1>Full Name</h1> and a <p class="contact"> line (location · email · phone · links);',
  '  then <section> blocks, each starting with an <h2> title (e.g. SUMMARY, EXPERIENCE, SKILLS, EDUCATION).',
  '  Render each role as <h3>Title — Company</h3><p class="meta">dates · location</p><ul><li>…</li></ul>.',
  '  Keep it concise (one to two pages), factual, and ATS-friendly. Lead with what matters most for THIS job.',
  'cover_html: a tailored cover letter as an HTML BODY FRAGMENT — <p> paragraphs only, 250–380 words,',
  '  first-person, specific to this role and the real company name (no bracket placeholders).',
  'apply_answers: an object with exactly these keys, each a concise PLAIN-TEXT answer (no HTML):',
  '  "summary" (2–3 sentence professional summary / "tell us about yourself", tailored to the job),',
  '  "why_role" (why this role and company, 2–4 sentences),',
  '  "relevant_experience" (the most relevant real experience for this job, 2–4 sentences),',
  '  "salary", "notice", "work_auth", "years" — for these four use the APPLICANT FACTS provided; do not guess.',
  'Output valid JSON only — no prose, no markdown, no code fences.',
].join('\n');

const SHELL_CSS = `
* { margin:0; padding:0; box-sizing:border-box; }
html { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
body { font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11px; line-height:1.5; color:#1a1a2e; background:#fff; }
.page { max-width:760px; margin:0 auto; padding:30px 38px; }
h1 { font-size:26px; font-weight:700; letter-spacing:-0.02em; margin-bottom:4px; }
.contact { font-size:10.5px; color:#555; margin-bottom:2px; }
.contact a { color:#555; text-decoration:none; }
.rule { height:2px; background:linear-gradient(to right,#1f7a8c,#6b3fa0); border-radius:1px; margin:10px 0 16px; }
h2 { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#1f7a8c; border-bottom:1.5px solid #e2e2e2; padding-bottom:3px; margin:16px 0 8px; }
h3 { font-size:12.5px; font-weight:700; margin-top:10px; }
.meta { font-size:10px; color:#666; margin-bottom:3px; }
ul { margin:4px 0 6px 16px; }
li { margin-bottom:3px; }
p { margin-bottom:9px; }
section { margin-bottom:6px; }
a { color:#1f7a8c; text-decoration:none; }
`.trim();

export const ANSWER_KEYS = ['summary', 'why_role', 'relevant_experience', 'salary', 'notice', 'work_auth', 'years'];

/** Normalize the model's apply_answers into an object with exactly the 7 keys (trimmed strings, '' for missing). */
export function normalizeAnswers(raw) {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const out = {};
  for (const k of ANSWER_KEYS) out[k] = typeof src[k] === 'string' ? src[k].trim() : '';
  return out;
}

/** Build a compact "applicant facts" block so the factual answers use real values, not guesses. */
export function buildFacts(profile = {}, job = {}) {
  const salary = profile.salary_expectation
    ? profile.salary_expectation
    : (job.salary_ask
      ? job.salary_ask
      : 'not specified — answer "open / negotiable, aligned to role and market"');
  const loc = [profile.location_city, profile.location_country].filter(Boolean).join(', ');
  return [
    'APPLICANT FACTS (use these for the factual answers — do not invent):',
    `- Notice period: ${profile.notice_period_days ? `${profile.notice_period_days} days` : 'not specified'}`,
    `- Work authorization: ${profile.work_authorization || 'not specified'}`,
    `- Salary expectation: ${salary}`,
    `- Years of experience: ${profile.years_experience || 'not specified'}`,
    `- Location: ${loc || 'not specified'}`,
    `- Willing to relocate: ${profile.willing_to_relocate || 'not specified'}`,
  ].join('\n');
}

/** Wrap an HTML body fragment in a styled, self-contained document. */
export function wrapHtml(bodyHtml, { kind = 'cv' } = {}) {
  const rule = kind === 'cv' ? '<div class="rule"></div>' : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${SHELL_CSS}</style></head>`
    + `<body><div class="page ${kind}">${bodyHtml.includes('class="rule"') ? bodyHtml : insertRuleAfterHeader(bodyHtml, rule)}</div></body></html>`;
}

/** Place the gradient rule right after the header block (CV only); fall back to prepending. */
function insertRuleAfterHeader(body, rule) {
  if (!rule) return body;
  const idx = body.indexOf('</header>');
  if (idx !== -1) return body.slice(0, idx + '</header>'.length) + rule + body.slice(idx + '</header>'.length);
  return rule + body;
}

/** Build the chat messages for tailoring one job against the base CV. */
export function buildTailorMessages(cvText, job, facts = '') {
  const jobText = [
    `Title: ${job.title || ''}`,
    `Company: ${job.company || ''}`,
    `Location: ${job.location || ''}`,
    `Market: ${job.market || ''}`,
    `Description:\n${(job.description || '').slice(0, 6000)}`,
  ].join('\n');
  const factsBlock = facts ? `\n\n${facts}` : '';
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `CANDIDATE BASE CV (Markdown):\n${cvText}${factsBlock}\n\nJOB POSTING:\n${jobText}\n\nReturn the JSON now.` },
  ];
}

/** Parse + validate the model's JSON. Returns body fragments. Throws on unusable output. */
export function parseTailorResult(content) {
  let obj;
  try { obj = JSON.parse(content); } catch { throw new Error('tailor: response was not valid JSON'); }
  const cv = typeof obj.cv_html === 'string' ? obj.cv_html.trim() : '';
  const cover = typeof obj.cover_html === 'string' ? obj.cover_html.trim() : '';
  if (!cv) throw new Error('tailor: response missing cv_html');
  if (!cover) throw new Error('tailor: response missing cover_html');
  return { cvHtml: cv, coverHtml: cover, answers: normalizeAnswers(obj.apply_answers) };
}

/** Generate tailored CV + cover-letter HTML documents via OpenAI. Throws on failure. */
export async function generateTailoredDocs(job, { cvText, facts = '', apiKey, model, effort, maxTokens = 16000, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('tailor: missing OpenAI API key');
  if (!cvText) throw new Error('tailor: missing base CV text');
  const body = {
    model,
    messages: buildTailorMessages(cvText, job, facts),
    max_completion_tokens: maxTokens,
    response_format: { type: 'json_object' },
  };
  if (effort) body.reasoning_effort = effort;
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
    throw new Error(`tailor: OpenAI HTTP ${res.status} ${String(detail).slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('tailor: OpenAI returned no content');
  const { cvHtml, coverHtml, answers } = parseTailorResult(content);
  return { cvHtml: wrapHtml(cvHtml, { kind: 'cv' }), coverHtml: wrapHtml(coverHtml, { kind: 'cover' }), answers };
}
