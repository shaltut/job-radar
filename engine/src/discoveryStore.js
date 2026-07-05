// Best-effort reader for the UI-controlled discovery config tables, plus the
// registry-driven seed-SQL generator used by the migration runner (not at
// discover time). The reader NEVER throws — any DB/table problem degrades to
// "today's behavior" (P2).

/**
 * Read the config tables, scoped to `tenantId` (C2: per-tenant config; the engine
 * itself stays single-tenant — the caller always passes JOBRADAR_TENANT_ID, the owner).
 * Returns { sources: Map<name,bool>|null, excludes: string[]|null, sourceConfigs: object|undefined }.
 *
 * A nullish tenantId (engine not yet configured for a tenant) short-circuits to
 * {sources:null, excludes:null} WITHOUT ever querying — same P2 "degrade to today's
 * behavior" contract as the error path below, just triggered before any query runs.
 *
 * Any error (table missing = Postgres 42P01 undefined_table, or a connection
 * error) → all-null so callers fall back to env/profile (P2). Never throws.
 *
 * Note: a *present but empty* table yields an empty Map / empty array (not null);
 * callers treat empty as "no override" so a partial seed can't blank the pipeline.
 * Only an *absent* table (or DB error) yields null → full fallback.
 *
 * The `discovery_countries` table is left in place but no longer read here — per-source
 * country filtering is now handled via each MENA source's own `config.country` field.
 *
 * Per-tenant enablement/interval/filter-config lives in `tenant_source_config` (the
 * jobs-app writes there, not the global `sources` columns, as of C2) — LEFT JOINed
 * against `sources` here, COALESCE-defaulting to "off"/{}/24h when this tenant has no
 * row yet. `last_run_at` stays on the global `sources` table (cadence is engine-wide
 * while the engine itself is single-tenant; revisit in Phase 4).
 */
export async function loadDiscoveryConfig(client, tenantId) {
  if (tenantId == null) return { sources: null, excludes: null };
  try {
    const [s, e] = await Promise.all([
      client.query(
        `SELECT s.name, COALESCE(tsc.enabled, false) AS enabled, COALESCE(tsc.config, '{}'::jsonb) AS config,
                COALESCE(tsc.run_interval_hours, 24) AS run_interval_hours, s.last_run_at
           FROM sources s
           LEFT JOIN tenant_source_config tsc ON tsc.source_name = s.name AND tsc.tenant_id = $1`,
        [tenantId],
      ),
      client.query('SELECT term FROM discovery_excludes WHERE tenant_id = $1', [tenantId]),
    ]);
    const sourceConfigs = {};
    for (const r of s.rows) {
      sourceConfigs[r.name] = r.config && typeof r.config === 'object' ? r.config : {};
    }
    // sourceRows: name → { run_interval_hours, last_run_at } for cadence checks
    const sourceRows = new Map(s.rows.map((r) => [r.name, {
      run_interval_hours: r.run_interval_hours ?? null,
      last_run_at: r.last_run_at ?? null,
    }]));
    return {
      sources: new Map(s.rows.map((r) => [r.name, r.enabled])),
      excludes: e.rows.map((r) => r.term),
      sourceConfigs,
      sourceRows,
    };
  } catch {
    return { sources: null, excludes: null };
  }
}

/**
 * Record that a discover run touched these source families, by updating last_run_at.
 * Idempotent: re-running the same families just refreshes the timestamp.
 * Best-effort callers should catch errors themselves.
 *
 * @param {object} client - pg Pool/Client
 * @param {string[]} familyNames - deduplicated source family names that ran
 */
export async function recordCadenceRuns(client, familyNames) {
  if (!Array.isArray(familyNames) || familyNames.length === 0) return;
  await client.query(
    'UPDATE sources SET last_run_at = now() WHERE name = ANY($1)',
    [familyNames],
  );
}

const sqlBool = (b) => (b ? 'true' : 'false');
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Emit the registry-driven seed VALUES for the `sources` toggle table, one row
 * per FAMILY, with enabled = enable_by_default (paid families seed OFF — P3).
 * ON CONFLICT (name) DO NOTHING so re-seeding never clobbers a user's choice.
 *
 * @param {{name:string, market:string, enableByDefault:boolean}[]} registryFamilies
 * @returns {string} a self-contained INSERT statement (or a comment when empty)
 */
export function seedSourcesSql(registryFamilies) {
  const fams = Array.isArray(registryFamilies) ? registryFamilies : [];
  if (fams.length === 0) return '-- no source families to seed';
  const rows = fams
    .map((f) => `  (${sqlStr(f.name)},${sqlStr(f.market)}, ${sqlBool(f.enableByDefault)}, ${sqlBool(f.enableByDefault)})`)
    .join(',\n');
  return (
    'INSERT INTO sources (name, market, enabled, enable_by_default) VALUES\n' +
    rows +
    '\nON CONFLICT (name) DO NOTHING;'
  );
}
