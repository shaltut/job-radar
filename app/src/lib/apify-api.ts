import "server-only"

const API = "https://api.apify.com/v2"
const TTL_MS = 60_000

export interface ApifyRun { id: string; actId: string; actor: string; status: string; startedAt: string; finishedAt: string | null; usageTotalUsd: number }
export interface ActorUsage { actId: string; actor: string; runs: number; ok: number; failed: number; totalUsd: number; lastRunAt: string | null }

export function maskToken(t?: string): string {
  if (!t || t.length < 4) return "••••"
  return `apify_api_••••${t.slice(-4)}`
}

export function usagePct(monthlyUsd: number, limitUsd: number | null): number | null {
  if (!limitUsd || limitUsd <= 0) return null
  return Math.round((monthlyUsd / limitUsd) * 100)
}

export function aggregateActorUsage(runs: ApifyRun[]): ActorUsage[] {
  const m = new Map<string, ActorUsage>()
  for (const r of runs) {
    const a = m.get(r.actId) || { actId: r.actId, actor: r.actor, runs: 0, ok: 0, failed: 0, totalUsd: 0, lastRunAt: null }
    a.runs++
    if (r.status === "SUCCEEDED") a.ok++
    else if (r.status === "FAILED" || r.status === "ABORTED" || r.status === "TIMED-OUT") a.failed++
    a.totalUsd += r.usageTotalUsd || 0
    if (!a.lastRunAt || (r.startedAt && r.startedAt > a.lastRunAt)) a.lastRunAt = r.startedAt
    m.set(r.actId, a)
  }
  return [...m.values()].sort((x, y) => y.totalUsd - x.totalUsd)
}

type FetchLike = typeof fetch
// Cache is keyed by token+path (not path alone): tokens are now per-tenant (BYO-key),
// so a shared path-only key would leak tenant A's cached Apify data to tenant B.
const cache = new Map<string, { at: number; data: unknown }>()

async function apiGet(path: string, token: string, fetchImpl: FetchLike, nowMs: number): Promise<any> {
  const cacheKey = `${token} ${path}`
  const hit = cache.get(cacheKey)
  if (hit && nowMs - hit.at < TTL_MS) return hit.data
  const res = await fetchImpl(`${API}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`apify HTTP ${res.status}`)
  const data = await res.json()
  cache.set(cacheKey, { at: nowMs, data })
  return data
}

export async function getUsage({ token = "", fetchImpl = fetch, nowMs = Date.now() }: { token?: string; fetchImpl?: FetchLike; nowMs?: number } = {}) {
  if (!token) return { error: "no token" }
  try {
    const d = (await apiGet("/users/me/limits", token, fetchImpl, nowMs)).data
    const monthlyUsd = d.current?.monthlyUsageUsd ?? 0
    const limitUsd = d.limits?.maxMonthlyUsageUsd ?? null
    return { monthlyUsd, limitUsd, pct: usagePct(monthlyUsd, limitUsd), computeUnits: d.current?.monthlyActorComputeUnits ?? 0, computeUnitsLimit: d.limits?.maxMonthlyActorComputeUnits ?? null }
  } catch (e) { return { error: String((e as Error).message || e) } }
}

/** Resolve an actor id to a readable name (title, else username/name), cached; falls back to the id. */
async function getActorName(actId: string, token: string, fetchImpl: FetchLike, nowMs: number): Promise<string> {
  try {
    const d = (await apiGet(`/acts/${actId}`, token, fetchImpl, nowMs)).data || {}
    return d.title || (d.username && d.name ? `${d.username}/${d.name}` : null) || actId
  } catch { return actId }
}

export async function getRuns({ token = "", fetchImpl = fetch, nowMs = Date.now(), limit = 50 }: { token?: string; fetchImpl?: FetchLike; nowMs?: number; limit?: number } = {}) {
  if (!token) return { error: "no token" }
  try {
    const items = (await apiGet(`/actor-runs?desc=1&limit=${limit}`, token, fetchImpl, nowMs)).data?.items ?? []
    // Run items carry only actId; resolve each distinct actor's readable name (cached per /acts/{id}).
    const ids = [...new Set(items.map((r: any) => r.actId).filter(Boolean))] as string[]
    const names = new Map<string, string>()
    await Promise.all(ids.map(async (id) => { names.set(id, await getActorName(id, token, fetchImpl, nowMs)) }))
    const recent: ApifyRun[] = items.map((r: any) => ({ id: r.id, actId: r.actId, actor: names.get(r.actId) || r.actId, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt ?? null, usageTotalUsd: r.usageTotalUsd ?? 0 }))
    return { actors: aggregateActorUsage(recent), recent }
  } catch (e) { return { error: String((e as Error).message || e) } }
}

export async function abortRun(runId: string, { token = "", fetchImpl = fetch }: { token?: string; fetchImpl?: FetchLike } = {}) {
  if (!token) return { error: "no token" }
  try {
    const res = await fetchImpl(`${API}/actor-runs/${encodeURIComponent(runId)}/abort?token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return { error: `apify HTTP ${res.status}` }
    const d = (await res.json()).data
    cache.delete(`${token} /actor-runs?desc=1&limit=50`)
    return { id: d?.id ?? runId, status: d?.status ?? "ABORTING" }
  } catch (e) { return { error: String((e as Error).message || e) } }
}

export async function validateToken({ token = "", fetchImpl = fetch }: { token?: string; fetchImpl?: FetchLike } = {}) {
  if (!token) return { ok: false }
  try {
    const res = await fetchImpl(`${API}/users/me?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return { ok: false }
    const d = (await res.json()).data
    return { ok: true, username: d?.username, plan: d?.plan?.tier || d?.plan?.id }
  } catch { return { ok: false } }
}
