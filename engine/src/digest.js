export const DIGEST_MAX = 25;
const MAX = DIGEST_MAX;

/** Compact "stack · mode · location" line for a job; falls back to job.location. */
export function jobSummaryLine(j) {
  const stackArr = Array.isArray(j.tech_stack) ? j.tech_stack : [];
  const stack = stackArr.slice(0, 4).join(' · ');
  const overflow = stackArr.length > 4 ? ` +${stackArr.length - 4}` : '';
  const locs = Array.isArray(j.locations) && j.locations.length ? j.locations.join(', ') : (j.location || '');
  return [stack ? stack + overflow : null, j.work_mode || null, locs || null].filter(Boolean).join(' · ');
}

/** Render a Telegram digest (HTML parse mode) for newly discovered jobs. */
export function formatDigest(jobs) {
  if (!jobs.length) return '📭 <b>Job Radar</b>\nNo new jobs in the last run.';
  const shown = jobs.slice(0, MAX);
  const lines = shown.map((j, i) => {
    const heading = j.clean_title || j.title;
    const co = j.company ? ` @ ${esc(j.company)}` : '';
    const when = fmtDate(j.posted_at);
    const datePart = when ? ` · 🗓 ${when}` : '';
    const scorePart = Number.isFinite(j.score) ? ` · 🎯 ${j.score}` : '';
    const summary = jobSummaryLine(j) || (j.location || (j.market === 'mena' ? 'MENA' : 'Remote'));
    return `${i + 1}. <a href="${esc(j.url)}">${esc(heading)}</a>${co}\n    <i>${esc(summary)} · ${esc(j.market)}${datePart}${scorePart}</i>`;
  });
  const overflow = jobs.length > MAX ? `\n\n…and +${jobs.length - MAX} more` : '';
  return `📡 <b>Job Radar — ${jobs.length} new</b>\n\n${lines.join('\n')}${overflow}`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Format a posted date (Date or ISO string) to YYYY-MM-DD, or null if absent/unparseable. */
function fmtDate(d) {
  if (!d) return null;
  const iso = (d instanceof Date) ? d.toISOString() : String(d);
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;
}

/** Render the "follow up" section for applied/interviewing jobs that have gone quiet. */
export function formatFollowups(jobs) {
  const shown = jobs.slice(0, MAX);
  const lines = shown.map((j, i) => {
    const co = j.company ? ` @ ${esc(j.company)}` : '';
    const d = Number.isFinite(j.days_since) ? `${j.days_since}d` : '';
    return `${i + 1}. <a href="${esc(j.url)}">${esc(j.title)}</a>${co}\n    <i>${esc(j.status)} · ${d} ago</i>`;
  });
  const overflow = jobs.length > MAX ? `\n\n…and +${jobs.length - MAX} more` : '';
  return `⏰ <b>Follow up — ${jobs.length}</b>\n\n${lines.join('\n')}${overflow}`;
}

/** One-line health footer for the digest. All-stale → muted idle line (no warnings). */
export function formatHealthFooter(summary, { dryRuns = 3, nowMs = Date.now() } = {}) {
  if (!summary.length) return '🩺 <i>no source runs recorded yet</i>';
  if (summary.every((s) => s.stale)) {
    const freshest = summary.reduce((a, b) => (new Date(b.lastAt) > new Date(a.lastAt) ? b : a));
    return `🩺 <i>last discover run ${ago(freshest.lastAt, nowMs)}</i>`;
  }
  const live = summary.filter((s) => !s.stale);
  const ok = live.filter((s) => !s.lastErrored && s.consecutiveDry < dryRuns).length;
  const warns = [];
  for (const s of live) {
    if (s.lastErrored) warns.push(`❌ ${esc(s.source)}: ${esc(trunc(s.lastError, 60))}`);
    else if (s.consecutiveDry >= dryRuns) warns.push(`⚠️ ${esc(s.source)} dry ${s.consecutiveDry} runs`);
  }
  return `🩺 ${ok} ok${warns.length ? ' · ' + warns.join(' · ') : ''}`;
}

/** Telegram alert listing sources that errored in a run. Returns null when none errored. */
export function formatSourceAlert(perSource) {
  const list = (perSource || []).filter((s) => s.errored);
  if (!list.length) return null;
  const lines = list.map((s) => `• ${esc(s.source)}: <i>${esc(trunc(s.error, 120))}</i>`);
  return `⚠️ <b>Job Radar — source errors (${list.length})</b>\n${lines.join('\n')}`;
}

/** Telegram alert for a whole-step catastrophe (discover/score/tailor threw). */
export function formatCatastrophe(kind, err) {
  return `🚨 <b>Job Radar — ${esc(kind)} run failed</b>\n<i>${esc(trunc(String(err?.message ?? err), 200))}</i>`;
}

function trunc(s, n) { const t = String(s ?? ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
function ago(iso, nowMs = Date.now()) {
  const ms = Math.max(0, nowMs - new Date(iso).getTime());
  const d = Math.floor(ms / 86400_000);
  if (d >= 1) return `${d}d ago`;
  return `${Math.max(0, Math.floor(ms / 3600_000))}h ago`;
}

/** A single actionable job "card" (HTML) for the Telegram digest. */
export function formatJobCard(j) {
  const heading = j.clean_title || j.title;
  const co = j.company ? ` @ ${esc(j.company)}` : '';
  const where = j.location || (j.market === 'mena' ? 'MENA' : 'Remote');
  const when = fmtDate(j.posted_at);
  const score = Number.isFinite(j.score) ? `🎯 ${j.score} · ` : '';
  const lines = [
    `📡 <b>${score}<a href="${esc(j.url)}">${esc(heading)}</a></b>${co}`,
    `<i>${esc(jobSummaryLine(j) || where)} · ${esc(j.market)}${when ? ` · 🗓 ${when}` : ''}</i>`,
  ];
  if (j.eligibility) lines.push(`⚠️ ${esc(j.eligibility)}`);
  if (j.score_reason) lines.push(esc(j.score_reason));
  const fit = [['seniority', j.seniority_fit], ['domain', j.domain_fit], ['remote', j.remote_fit]]
    .filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(' · ');
  if (fit) lines.push(`<i>${esc(fit)}</i>`);
  const matched = Array.isArray(j.matched_skills) ? j.matched_skills.slice(0, 5) : [];
  const missing = Array.isArray(j.missing_skills) ? j.missing_skills.slice(0, 5) : [];
  if (matched.length) lines.push(`✅ ${esc(matched.join(', '))}`);
  if (missing.length) lines.push(`❌ ${esc(missing.join(', '))}`);
  return lines.join('\n');
}

/** Inline-keyboard shortlist/dismiss buttons for a job id (callback_data ≤64 bytes). */
export function jobButtons(id) {
  return { inline_keyboard: [[
    { text: '✅ Shortlist', callback_data: `sl:${id}` },
    { text: '✖ Dismiss', callback_data: `ds:${id}` },
  ]] };
}
