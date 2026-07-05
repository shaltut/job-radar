import { familyOf } from './sources/discoveryConfig.js';

/** Reduce recent source_runs rows into a per-source health summary.
 *  Pure: inject nowMs in tests. Input rows may be in any order. */
export function summarizeSourceHealth(rows, { staleHours = 48, nowMs = Date.now() } = {}) {
  const bySource = new Map();
  for (const r of rows) {
    if (!bySource.has(r.source)) bySource.set(r.source, []);
    bySource.get(r.source).push(r);
  }
  const out = [];
  for (const [source, list] of bySource) {
    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); // most-recent first
    const latest = list[0];
    let consecutiveErrors = 0;
    for (const r of list) { if (r.errored) consecutiveErrors++; else break; }
    let consecutiveDry = 0;
    for (const r of list) { if (r.errored || Number(r.fetched) === 0) consecutiveDry++; else break; }
    const lastAtMs = new Date(latest.created_at).getTime();
    out.push({
      source,
      family: latest.family,
      lastFetched: Number(latest.fetched) || 0,
      lastErrored: !!latest.errored,
      lastError: latest.error ?? null,
      lastAt: latest.created_at,
      consecutiveErrors,
      consecutiveDry,
      stale: Number.isFinite(lastAtMs) ? (nowMs - lastAtMs) > staleHours * 3600_000 : true,
    });
  }
  return out;
}

/** Insert one source_runs row per source for a discover run. No-op on empty. Best-effort caller. */
export async function recordSourceRuns(client, discoveryRunId, perSource = []) {
  if (!Array.isArray(perSource) || perSource.length === 0) return;
  for (const s of perSource) {
    await client.query(
      `INSERT INTO source_runs (discovery_run_id, source, family, fetched, matched, errored, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [discoveryRunId ?? null, s.source, familyOf(s.source), Number(s.fetched) || 0, Number(s.matched) || 0, !!s.errored, s.error ?? null],
    );
  }
}

/** Last `perSource` source_runs rows per source (most-recent first), for health summaries. */
export async function getRecentSourceRuns(client, { perSource = 20 } = {}) {
  const res = await client.query(
    `SELECT source, family, fetched, errored, error, created_at FROM (
       SELECT source, family, fetched, errored, error, created_at,
              row_number() OVER (PARTITION BY source ORDER BY created_at DESC) AS rn
         FROM source_runs
     ) t WHERE rn <= $1 ORDER BY source, created_at DESC`,
    [perSource],
  );
  return res.rows;
}
