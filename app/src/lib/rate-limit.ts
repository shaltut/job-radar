/**
 * In-memory sliding-window rate limiter (#126).
 *
 * A module-level Map keyed by caller-supplied string (e.g. `signup:<ip>`)
 * holds hit timestamps; each call prunes entries older than `windowMs` before
 * counting. `now` is injectable so tests don't depend on wall-clock time.
 *
 * Single-container app: this is process-local, not distributed. Fine for
 * jobs-app's current deployment (see plan's Self-Review / Deferred).
 */
const hits = new Map<string, number[]>()

/** Returns true if this hit is allowed (under `max` within `windowMs`), false if over the limit. */
export function rateLimit(key: string, max: number, windowMs: number, now: number = Date.now()): boolean {
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  if (arr.length >= max) {
    hits.set(key, arr)
    return false
  }
  arr.push(now)
  hits.set(key, arr)
  return true
}
