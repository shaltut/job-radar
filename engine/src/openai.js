const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const SYSTEM = [
  'You score how well a single job posting fits a candidate, based on the candidate profile provided.',
  'Return ONLY a JSON object with exactly these keys:',
  '{"score": <integer 0-100>, "reason": "<one sentence, max ~160 chars>", "seniority_fit": "low|medium|high", "domain_fit": "low|medium|high", "remote_fit": "low|medium|high", "matched_skills": [<up to 8 short skill names the candidate already has that this job wants>], "missing_skills": [<up to 8 short skill names this job wants that the candidate profile does NOT show>], "clean_title": "<readable role line; if the posting lists multiple roles include them all, e.g. \'Backend / Frontend @ Acme\'>", "tech_stack": [<up to 8 short tech names mentioned, e.g. \'Go\', \'Postgres\'>], "work_mode": "remote|onsite|hybrid", "locations": [<human-readable locations, e.g. \'US (remote)\', \'Berlin\'>], "eligibility": "<work restriction such as \'US citizens only\' if stated, else null>", "eligibility_std": "us_citizen_only|us_work_authorization|eu_work_authorization|uk_work_authorization|gcc_residency|security_clearance|none|other", "category": "Technology & IT|Healthcare|Engineering|Finance & Accounting|Business & Management|Sales & Marketing|Human Resources|Legal & Compliance|Education|Creative & Design|Administration|Logistics & Supply Chain|Construction & Real Estate|Hospitality & Tourism|Manufacturing & Skilled Trades|Government & Public Sector|Other", "salary_range": "<expected pay incl. currency+period, e.g. \'$120k–$150k/yr\' or \'SAR 30–40k/mo\'; the posting\'s stated pay if given, else your market estimate; null if no basis>", "salary_source": "listed|estimated|null", "salary_usd_min": <integer yearly total comp in USD, low end, else null>, "salary_usd_max": <integer yearly total comp in USD, high end, else null>, "salary_ask": "<a figure/range for the candidate to request, anchored to salary_range and seniority; null if no range>"}',
  'clean_title/tech_stack/work_mode/locations: extract from the posting text (often unstructured); use null / [] when not stated. eligibility: null unless the posting restricts who may apply.',
  'eligibility_std: map the free-form eligibility to exactly ONE of the listed canonical values — "none" when the posting states no restriction (default), "other" when a restriction is stated but doesn\'t fit the other values.',
  'category: classify the job into exactly ONE of the listed categories based on its primary function/field, regardless of tech stack — "Other" only when none of the 16 named categories fit.',
  'salary_range: use the posting\'s stated pay when present (salary_source "listed"); else estimate the market rate for the role/seniority/location (salary_source "estimated"); null when you cannot estimate (set salary_source null too). salary_ask: anchored to salary_range; null if no range.',
  'salary_usd_min/salary_usd_max: the same salary basis as salary_range, but normalized as the estimated YEARLY total compensation converted to USD, expressed as plain integers (no currency symbols, no commas, no abbreviations like "k"). Convert from the local currency/period to a USD-per-year figure using your best market exchange rate. If only a single figure is available, set both equal. Null when there is no basis (i.e. whenever salary_range is null).',
  'score = overall fit to the candidate\'s experience, skills, and seniority (100 = ideal, 0 = irrelevant).',
  'matched_skills / missing_skills: judge against the candidate profile; each entry a short noun phrase (e.g. "Kubernetes", "Go", "team leadership"); [] if none.',
  'Judge by the candidate profile, not by how prestigious the company is. Output valid json only — no prose, no markdown.',
].join('\n');

/** Build the chat messages for scoring one job against the candidate profile. */
export function buildScoreMessages(profileText, job) {
  const jobText = [
    `Title: ${job.title || ''}`,
    `Company: ${job.company || ''}`,
    `Location: ${job.location || ''}`,
    `Market: ${job.market || ''}`,
    `Description: ${(job.description || '').slice(0, 4000)}`,
  ].join('\n');
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `CANDIDATE PROFILE:\n${profileText}\n\nJOB POSTING:\n${jobText}\n\nReturn the JSON score now.` },
  ];
}

/** Parse + validate the model's JSON content. Throws on unusable output. */
export function parseScoreResult(content) {
  let obj;
  try { obj = JSON.parse(content); } catch { throw new Error('score response was not valid JSON'); }
  const n = Number(obj.score);
  if (!Number.isFinite(n)) throw new Error('score response missing numeric score');
  const score = Math.max(0, Math.min(100, Math.round(n)));
  const reason = typeof obj.reason === 'string' ? obj.reason.slice(0, 200) : null;
  const fit = (v) => (['low', 'medium', 'high'].includes(v) ? v : null);
  const skills = (v) => {
    if (!Array.isArray(v)) return [];
    const out = [];
    const seen = new Set();
    for (const s of v) {
      if (typeof s !== 'string') continue;
      const t = s.trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
      if (out.length >= 8) break;
    }
    return out;
  };
  const cleanStr = (v, n = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
  const mode = (v) => (['remote', 'onsite', 'hybrid'].includes(v) ? v : null);
  const ELIGIBILITY_STD = ['us_citizen_only', 'us_work_authorization', 'eu_work_authorization', 'uk_work_authorization', 'gcc_residency', 'security_clearance', 'none', 'other'];
  const eligibilityStd = (v) => (ELIGIBILITY_STD.includes(v) ? v : 'none');
  const CATEGORIES = ['Technology & IT', 'Healthcare', 'Engineering', 'Finance & Accounting', 'Business & Management', 'Sales & Marketing', 'Human Resources', 'Legal & Compliance', 'Education', 'Creative & Design', 'Administration', 'Logistics & Supply Chain', 'Construction & Real Estate', 'Hospitality & Tourism', 'Manufacturing & Skilled Trades', 'Government & Public Sector', 'Other'];
  const category = (v) => (CATEGORIES.includes(v) ? v : 'Other');
  const salarySource = (v) => (['listed', 'estimated'].includes(v) ? v : null);
  const usd = (v) => {
    if (v === null || v === undefined) return null; // Number(null)===0 would store a sticky $0
    const num = Number(v);
    return Number.isFinite(num) && num >= 0 ? Math.round(num) : null;
  };
  let salaryUsdMin = usd(obj.salary_usd_min);
  let salaryUsdMax = usd(obj.salary_usd_max);
  if (salaryUsdMin !== null && salaryUsdMax !== null && salaryUsdMin > salaryUsdMax) {
    [salaryUsdMin, salaryUsdMax] = [salaryUsdMax, salaryUsdMin];
  }
  return {
    score, reason,
    seniorityFit: fit(obj.seniority_fit), domainFit: fit(obj.domain_fit), remoteFit: fit(obj.remote_fit),
    matchedSkills: skills(obj.matched_skills), missingSkills: skills(obj.missing_skills),
    cleanTitle: cleanStr(obj.clean_title), techStack: skills(obj.tech_stack),
    workMode: mode(obj.work_mode), locations: skills(obj.locations), eligibility: cleanStr(obj.eligibility),
    eligibilityStd: eligibilityStd(obj.eligibility_std), category: category(obj.category),
    salaryRange: cleanStr(obj.salary_range), salarySource: salarySource(obj.salary_source), salaryAsk: cleanStr(obj.salary_ask),
    salaryUsdMin, salaryUsdMax,
  };
}

/** Score one job via OpenAI Chat Completions. Returns the parsed result, or null on any failure (never throws). */
export async function scoreJob(job, profileText, { fetchImpl = fetch, apiKey, model, effort, maxTokens = 8000 } = {}) {
  if (!apiKey) return null;
  const body = {
    model,
    messages: buildScoreMessages(profileText, job),
    max_completion_tokens: maxTokens,
    response_format: { type: 'json_object' },
  };
  if (effort) body.reasoning_effort = effort;
  let data;
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
      console.error(`[openai] HTTP ${res.status} ${detail.slice(0, 200)}`);
      return null;
    }
    data = await res.json();
  } catch {
    return null;
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return null;
  try { return parseScoreResult(content); } catch { return null; }
}
