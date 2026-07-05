/** Jobs vetted + with materials, not over the retry cap — the auto-apply queue. */
export async function getApplyQueue(client, { limit = 5 } = {}) {
  const res = await client.query(
    `SELECT id, title, company, url, market, description, cv_pdf, cover_pdf, apply_answers
       FROM jobs
      WHERE status = 'shortlisted' AND materials_status = 'ready' AND apply_attempts < 3
      ORDER BY score DESC NULLS LAST, discovered_at DESC
      LIMIT $1`,
    [limit],
  );
  return res.rows;
}
