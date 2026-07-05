/** Merge a per-source config (from sources.config) into an actor/API input.
 *  Config keys ARE the actor input keys. Empty values are skipped; `advanced` (raw object) wins last. */
export function applyFilters(baseInput, config = {}) {
  const out = { ...baseInput };
  const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
  for (const [k, v] of Object.entries(config || {})) {
    if (k === 'advanced') continue;
    if (isEmpty(v)) continue;
    out[k] = v;
  }
  const adv = config && config.advanced;
  return adv && typeof adv === 'object' && !Array.isArray(adv) ? { ...out, ...adv } : out;
}
