// On-demand pipeline queue (discover / score / tailor). The host poller claims pending
// requests of a given KIND, runs that step ONCE, and records the result. Multiple pending
// requests of the same kind collapse into a single run (all claimed rows get the outcome).

/** Claim every 'requested' run of `kind` → mark 'running'. Returns claimed ids ([] if none). */
export async function claimRuns(client, kind = 'discover') {
  const res = await client.query(
    "UPDATE discovery_runs SET status = 'running', started_at = now() WHERE status = 'requested' AND kind = $1 RETURNING id",
    [kind],
  );
  return res.rows.map((r) => Number(r.id));
}

/** Mark claimed runs 'done' with stats + a human note. No-op on an empty id list. */
export async function finishRuns(client, ids, stats = {}) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const { fetched = null, matched = null, inserted = null, note = null } = stats;
  await client.query(
    "UPDATE discovery_runs SET status = 'done', finished_at = now(), fetched = $2, matched = $3, inserted = $4, note = $5 WHERE id = ANY($1)",
    [ids, fetched, matched, inserted, note],
  );
}

/** Mark claimed runs 'error' with a (truncated) message. No-op on an empty id list. */
export async function failRuns(client, ids, error) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  await client.query(
    "UPDATE discovery_runs SET status = 'error', finished_at = now(), error = $2 WHERE id = ANY($1)",
    [ids, String(error ?? 'unknown error').slice(0, 500)],
  );
}

/**
 * Queue a 'requested' run of `kind` unless one is already requested/running (dedup-guarded),
 * stamped with the engine's own tenant_id (fail-fast on unset, mirrors db.js's upsertJobs
 * from C1 — the engine is single-tenant, so every row it enqueues must be attributable to
 * the one tenant it runs for).
 */
export async function enqueueRun(client, kind, source = 'auto') {
  const tenantId = Number(process.env.JOBRADAR_TENANT_ID);
  if (!tenantId) throw new Error('JOBRADAR_TENANT_ID unset');
  await client.query(
    "INSERT INTO discovery_runs (tenant_id, kind, source) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM discovery_runs WHERE tenant_id = $1 AND kind = $2 AND status IN ('requested','running'))",
    [tenantId, kind, source],
  );
}
