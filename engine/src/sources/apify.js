import { mapValid } from '../normalize.js';

const url = (actorId, token, timeoutSecs) =>
  `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${token}&timeout=${timeoutSecs}`;

/** Build an Apify-actor-backed source. Runs the actor synchronously and maps its dataset items. */
export function makeApifySource({
  name, market, actorId, token, buildInput, map, fetchImpl = fetch,
  timeoutMs = Number(process.env.JOBRADAR_APIFY_TIMEOUT_MS) || 330_000,
  runTimeoutSecs = Number(process.env.JOBRADAR_APIFY_RUN_TIMEOUT_SECS) || 300,
  previewLimit = null, countKey = null,
}) {
  return {
    name,
    market,
    async fetch(profile) {
      // Throw (rather than return []) on a non-OK response, network error, abort/hang, or
      // non-array body so a misconfigured or hung paid actor surfaces as a SOURCE ERROR in
      // runDiscover + the health alerts instead of silently looking "dry". The client-side
      // AbortSignal bounds a network-level hang (no response ever) — without it a single stuck
      // actor freezes the whole serial discover indefinitely; the URL &timeout caps the run
      // server-side. The free fetch-sources stay tolerant (return []); a paid actor failing is
      // worth knowing.
      const input = buildInput(profile);
      if (previewLimit != null && countKey) input[countKey] = previewLimit;
      const res = await fetchImpl(url(actorId, token, runTimeoutSecs), {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`apify ${actorId}: HTTP ${res.status}`);
      const items = await res.json();
      if (!Array.isArray(items)) throw new Error(`apify ${actorId}: non-array response`);
      return mapValid(items, map);
    },
  };
}
