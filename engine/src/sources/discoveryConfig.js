// Pure merge helpers for the UI-controlled discovery config.
// Zero DB / zero env dependencies — tested with plain inputs (no live DB).

// The MENA per-country suffixes a registry source name can carry. Kept here as a
// literal set so familyOf strips ONLY known GCC country suffixes — a name like
// 'remoteok' must never be mistaken for remote + 'ok'.
const COUNTRY_SUFFIXES = ['uae', 'ksa', 'qatar', 'kuwait', 'bahrain', 'oman'];

/**
 * The toggle "family" of a registry source name: its name with any trailing
 * -<menaCountryKey> suffix stripped.
 *   familyOf('bayt-uae')      === 'bayt'
 *   familyOf('wuzzuf-ksa')    === 'wuzzuf'
 *   familyOf('linkedin')      === 'linkedin'
 *   familyOf('remotive')      === 'remotive'
 */
export function familyOf(name) {
  const s = String(name || '');
  for (const suffix of COUNTRY_SUFFIXES) {
    if (s.endsWith(`-${suffix}`)) return s.slice(0, -(suffix.length + 1));
  }
  return s;
}

/**
 * Given the env-built source list and a Map family->enabled (from DB families),
 * return only sources whose FAMILY is not explicitly disabled.
 *  - dbSourcesMap null/undefined → input returned unchanged (P2: DB absent).
 *  - a family absent from the map is KEPT (unknown source defaults visible —
 *    safer than hiding; matches "empty present table = no override").
 *  - only an explicit `false` drops a source.
 */
export function applySourceToggles(sources, dbSourcesMap) {
  if (!dbSourcesMap) return sources;
  return sources.filter((s) => dbSourcesMap.get(familyOf(s.name)) !== false);
}

/**
 * Check if a source family row is due for a run.
 *
 * @param {{ run_interval_hours?: number|null, last_run_at?: Date|string|null }} row
 * @param {Date|number} now - injectable for deterministic tests (Date or ms number)
 * @returns {boolean} true if the source should run (never ran, or interval elapsed)
 */
export function isSourceDue(row, now) {
  const intervalHours = (row && row.run_interval_hours != null) ? Number(row.run_interval_hours) : 24;
  if (!row || row.last_run_at == null) return true;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const lastMs = new Date(row.last_run_at).getTime();
  if (!Number.isFinite(lastMs)) return true; // unparseable → treat as never ran
  return (nowMs - lastMs) >= intervalHours * 3_600_000;
}

/**
 * Merge profile.excludeKeywords with DB exclude terms (set union, case-insensitive
 * dedupe). Profile order is preserved; DB-only terms are appended in order.
 *  - dbExcludes null/[] → profile list unchanged (P2).
 */
export function mergeExcludes(profileExcludes, dbExcludes) {
  const base = Array.isArray(profileExcludes) ? profileExcludes : [];
  if (!dbExcludes || dbExcludes.length === 0) return base;
  const seen = new Set(base.map((t) => String(t).toLowerCase()));
  const out = [...base];
  for (const t of dbExcludes) {
    const key = String(t).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}
