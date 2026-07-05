import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Mark a job applied (only after a confirmed live submit). */
export async function markApplied(client, id) {
  await client.query(`UPDATE jobs SET status = 'applied', applied_at = now(), status_changed_at = now() WHERE id = $1`, [id]);
}

/** Count one more apply attempt (for skipped/failed jobs, to bound retries). */
export async function bumpApplyAttempt(client, id) {
  await client.query(`UPDATE jobs SET apply_attempts = apply_attempts + 1 WHERE id = $1`, [id]);
}

const RESULTS = ['submitted', 'dry-run', 'skipped', 'failed'];

/** Coerce a job id (pg returns bigint columns as strings) to a positive integer; throws if invalid. */
export function coerceJobId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error('apply-record: job_id (positive integer) required');
  return id;
}

/** Validate + normalize an apply record into a one-line JSON string. Throws on bad input. */
export function buildAuditLine(record, nowIso) {
  if (!record || typeof record !== 'object') throw new Error('apply-record: record must be an object');
  const jobId = coerceJobId(record.job_id);
  if (!RESULTS.includes(record.result)) throw new Error(`apply-record: result must be one of ${RESULTS.join('|')}`);
  return JSON.stringify({
    ts: nowIso,
    job_id: jobId,
    company: record.company ?? null,
    title: record.title ?? null,
    url: record.url ?? null,
    apply_url: record.apply_url ?? null,
    mode: record.mode === 'live' ? 'live' : 'dry-run',
    result: record.result,
    reason: record.reason ?? null,
    screenshot: record.screenshot ?? null,
  });
}

/** Append one audit line to <dir>/applies.jsonl. */
export async function appendAudit(line, { dir, appendImpl = appendFile } = {}) {
  await appendImpl(join(dir, 'applies.jsonl'), line + '\n', 'utf8');
}

/** Record one apply outcome: always audit; mark applied on live submit; bump attempt on skipped/failed. */
export async function recordApply(client, record, {
  dir, nowIso, mark = markApplied, bump = bumpApplyAttempt, append = appendAudit,
} = {}) {
  const line = buildAuditLine(record, nowIso);
  const jobId = coerceJobId(record.job_id);
  await append(line, { dir });
  if (record.result === 'submitted' && record.mode === 'live') { await mark(client, jobId); return { marked: true, bumped: false }; }
  if (record.result === 'skipped' || record.result === 'failed') { await bump(client, jobId); return { marked: false, bumped: true }; }
  return { marked: false, bumped: false };
}
