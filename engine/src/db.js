import pg from 'pg';
import { dedupeHash } from './dedupe.js';

/**
 * Create a connection pool. Prefers JOBRADAR_DB_URL; if unset, pg reads the standard
 * PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE env vars (avoids URL-encoding a password with @ : /).
 */
export function makePool(url = process.env.JOBRADAR_DB_URL) {
  return url ? new pg.Pool({ connectionString: url, max: 4 }) : new pg.Pool({ max: 4 });
}

/** Insert jobs, skipping duplicates by (tenant_id, dedupe_hash). Returns the rows actually inserted. */
export async function upsertJobs(client, jobs) {
  const tenantId = Number(process.env.JOBRADAR_TENANT_ID);
  if (!tenantId) throw new Error('JOBRADAR_TENANT_ID unset');
  const inserted = [];
  for (const j of jobs) {
    const hash = dedupeHash(j);
    const res = await client.query(
      `INSERT INTO jobs
         (dedupe_hash, source, external_id, title, company, location, remote, url, description, tags, market, posted_at, raw, tenant_id)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
       WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE source = $2 AND external_id = $3 AND $3 IS NOT NULL)
       ON CONFLICT (tenant_id, dedupe_hash) DO NOTHING
       RETURNING id, dedupe_hash`,
      [hash, j.source, j.externalId, j.title, j.company, j.location, j.remote, j.url,
       j.description, j.tags, j.market, j.postedAt, JSON.stringify(j), tenantId],
    );
    if (res.rows.length) inserted.push(res.rows[0]);
  }
  return inserted;
}

/** Return status='new' jobs in the last `hours` that pass the score gate (>= threshold OR unscored). */
export async function getJobsToNotify(client, hours = 24, threshold = 70) {
  const res = await client.query(
    `SELECT id, title, company, location, market, url, posted_at, score, score_reason,
            seniority_fit, domain_fit, remote_fit, matched_skills, missing_skills,
            clean_title, tech_stack, work_mode, locations, eligibility,
            salary_range, salary_source, salary_ask, salary_usd_min, salary_usd_max,
            category, eligibility_std
       FROM jobs
      WHERE status = 'new'
        AND discovered_at > now() - ($1 || ' hours')::interval
        AND (score >= $2 OR score IS NULL)
      ORDER BY score DESC NULLS LAST, posted_at DESC NULLS LAST, discovered_at DESC`,
    [String(hours), threshold],
  );
  return res.rows;
}

/** Jobs needing a score: unscored (or all when all=true) and still actionable. */
export async function getJobsToScore(client, { all = false, backfill = false, threshold = 70, limit = 200, maxAttempts = 3 } = {}) {
  if (backfill) {
    const res = await client.query(
      `SELECT id, title, company, location, market, description
         FROM jobs
        WHERE score >= $1 AND status IN ('new','notified','shortlisted') AND category IS NULL
        ORDER BY discovered_at ASC
        LIMIT $2`,
      [threshold, limit],
    );
    return res.rows;
  }
  if (all) {
    const res = await client.query(
      `SELECT id, title, company, location, market, description
         FROM jobs
        WHERE status IN ('new','notified','shortlisted')
        ORDER BY discovered_at ASC
        LIMIT $1`,
      [limit],
    );
    return res.rows;
  }
  const res = await client.query(
    `SELECT id, title, company, location, market, description
       FROM jobs
      WHERE score IS NULL AND score_attempts < $2 AND status IN ('new','notified','shortlisted')
      ORDER BY discovered_at ASC
      LIMIT $1`,
    [limit, maxAttempts],
  );
  return res.rows;
}

/** Record a failed scoring attempt (bumps the counter so un-scoreable jobs aren't retried forever). */
export async function setScoreError(client, id) {
  await client.query(`UPDATE jobs SET score_attempts = score_attempts + 1 WHERE id = $1`, [id]);
}

/** Write a job's fit score + explainer fields (seniority/domain/remote fit + skill arrays). */
export async function setScore(client, id, result) {
  const { score, reason = null, seniorityFit = null, domainFit = null, remoteFit = null, matchedSkills = null, missingSkills = null,
          cleanTitle = null, techStack = null, workMode = null, locations = null, eligibility = null,
          salaryRange = null, salarySource = null, salaryAsk = null, salaryUsdMin = null, salaryUsdMax = null,
          category = null, eligibilityStd = null } = result || {};
  await client.query(
    `UPDATE jobs SET score = $1, score_reason = $2, seniority_fit = $3, domain_fit = $4, remote_fit = $5, matched_skills = $6, missing_skills = $7, clean_title = $8, tech_stack = $9, work_mode = $10, locations = $11, eligibility = $12, salary_range = $13, salary_source = $14, salary_ask = $15, salary_usd_min = $16, salary_usd_max = $17, category = $18, eligibility_std = $19 WHERE id = $20`,
    [score, reason, seniorityFit, domainFit, remoteFit, matchedSkills, missingSkills, cleanTitle, techStack, workMode, locations, eligibility, salaryRange, salarySource, salaryAsk, salaryUsdMin, salaryUsdMax, category, eligibilityStd, id],
  );
}

/** Flip the given job ids to status='notified'. Returns the count updated. */
export async function markNotified(client, ids) {
  if (!ids || ids.length === 0) return 0;
  const res = await client.query(`UPDATE jobs SET status = 'notified', status_changed_at = now() WHERE id = ANY($1)`, [ids]);
  return res.rowCount;
}

/** Shortlisted jobs that still need materials (or failed under the retry cap). */
export async function getJobsToTailor(client, { limit = 5 } = {}) {
  const res = await client.query(
    `SELECT id, title, company, location, url, market, description, salary_ask
       FROM jobs
      WHERE status = 'shortlisted'
        AND (materials_status IS NULL OR (materials_status = 'error' AND tailor_attempts < 3))
      ORDER BY score DESC NULLS LAST, discovered_at DESC
      LIMIT $1`,
    [limit],
  );
  return res.rows;
}

/** Mark a job's materials ready, storing the PDF basenames + tailored apply answers. */
export async function setMaterials(client, id, cvPdf, coverPdf, answers) {
  await client.query(
    `UPDATE jobs
        SET cv_pdf = $1, cover_pdf = $2, apply_answers = $3, materials_status = 'ready',
            materials_at = now(), tailor_error = NULL, tailor_attempts = tailor_attempts + 1
      WHERE id = $4`,
    [cvPdf, coverPdf, JSON.stringify(answers ?? {}), id],
  );
}

/** Record a tailoring failure for a job. */
export async function setTailorError(client, id, msg) {
  await client.query(
    `UPDATE jobs
        SET materials_status = 'error', tailor_error = $1, tailor_attempts = tailor_attempts + 1
      WHERE id = $2`,
    [msg, id],
  );
}

/** Applied/interviewing jobs that have gone quiet — for the digest follow-up section. */
export async function getFollowUps(client, { appliedDays = 7, interviewingDays = 5 } = {}) {
  const res = await client.query(
    `SELECT id, title, company, url, status,
            floor(extract(epoch from (now() - status_changed_at)) / 86400)::int AS days_since
       FROM jobs
      WHERE (status = 'applied' AND status_changed_at < now() - ($1 || ' days')::interval)
         OR (status = 'interviewing' AND status_changed_at < now() - ($2 || ' days')::interval)
      ORDER BY status_changed_at ASC`,
    [String(appliedDays), String(interviewingDays)],
  );
  return res.rows;
}

/** Dismiss active (new/notified) jobs older than `days` by posted_at (fallback discovered_at). Returns dismissed ids. */
export async function dismissStaleJobs(client, { days = 60 } = {}) {
  const res = await client.query(
    `UPDATE jobs SET status = 'dismissed', status_changed_at = now()
      WHERE status IN ('new','notified')
        AND coalesce(posted_at, discovered_at) < now() - ($1 || ' days')::interval
      RETURNING id`,
    [String(days)],
  );
  return res.rows.map((r) => r.id);
}
