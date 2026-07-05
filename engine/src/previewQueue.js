/**
 * Queue helpers for the source_previews table.
 * The engine claims, runs, and finishes/fails a preview request.
 * Finance inserts the request (SELECT + INSERT only — no UPDATE).
 */

/**
 * Claim the oldest pending preview request (status='requested') atomically.
 * Returns the row { id, source, lim } or null if nothing is pending.
 */
export async function claimPreview(client) {
  const { rows } = await client.query(
    `UPDATE source_previews
        SET status = 'running'
      WHERE id = (
        SELECT id FROM source_previews
         WHERE status = 'requested'
         ORDER BY requested_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, source, lim`,
  );
  return rows[0] ?? null;
}

/**
 * Mark a preview as done and store the result JSON.
 */
export async function finishPreview(client, id, result) {
  await client.query(
    `UPDATE source_previews
        SET status = 'done', result = $2, finished_at = now()
      WHERE id = $1`,
    [id, result],
  );
}

/**
 * Mark a preview as errored and store the error message.
 */
export async function failPreview(client, id, msg) {
  await client.query(
    `UPDATE source_previews
        SET status = 'error', error = $2, finished_at = now()
      WHERE id = $1`,
    [id, String(msg ?? '').slice(0, 500)],
  );
}
