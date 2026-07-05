"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { fetchWithCsrf } from "@/lib/csrf"
import { GlassCard } from "@/components/ui/glass-card"
import { Button } from "@/components/ui/button"
import { ExternalLink, KeyRound } from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UsageData {
  monthlyUsd: number
  limitUsd: number
  pct: number | null
  computeUnits: number
  computeUnitsLimit: number | null
}

interface UsageResponse {
  usage?: UsageData
  masked?: string
  error?: string
  needsKey?: boolean
}

interface ActorStat {
  actId: string
  actor: string
  runs: number
  ok: number
  failed: number
  totalUsd: number
  lastRunAt: string | null
}

interface RecentRun {
  id: string
  actId: string
  actor: string
  status: string
  startedAt: string | null
  finishedAt: string | null
  usageTotalUsd: number
}

interface RunsResponse {
  actors?: ActorStat[]
  recent?: RecentRun[]
  error?: string
  needsKey?: boolean
}

interface ValidateResult {
  ok: boolean
  username?: string
  plan?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

function fmtDate(s: string | null): string {
  if (!s) return "—"
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

function shortId(id: string): string {
  return id.length > 12 ? `…${id.slice(-10)}` : id
}

function statusBadgeClass(status: string): string {
  switch (status.toUpperCase()) {
    case "SUCCEEDED":
      return "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
    case "RUNNING":
      return "bg-sky-500/10 text-sky-300 ring-sky-500/30"
    case "FAILED":
    case "ABORTED":
      return "bg-rose-500/10 text-rose-300 ring-rose-500/30"
    case "TIMED-OUT":
      return "bg-amber-500/10 text-amber-300 ring-amber-500/30"
    default:
      return "bg-slate-800/60 text-slate-400 ring-white/10"
  }
}

// ---------------------------------------------------------------------------
// Section: Needs key (empty state — BYO-key, no Apify token on this tenant)
// ---------------------------------------------------------------------------

function NeedsKeySection() {
  return (
    <GlassCard className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/30">
          <KeyRound className="h-5 w-5 text-emerald-300" />
        </span>
        <div>
          <h2 className="text-lg font-semibold">Add your Apify key</h2>
          <p className="text-xs text-slate-500">
            This panel shows usage, run history, and spend for your own Apify account.
          </p>
        </div>
      </div>
      <p className="text-sm text-slate-400">
        You haven&apos;t connected an Apify API token yet. Add one in Settings to see your usage and actor runs here.
      </p>
      <Link
        href="/settings"
        className="inline-flex w-fit items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
      >
        Go to Settings
      </Link>
    </GlassCard>
  )
}

// ---------------------------------------------------------------------------
// Section: Usage
// ---------------------------------------------------------------------------

function UsageSection({
  usage,
  error,
}: {
  usage: UsageData | null
  error: string | null
}) {
  return (
    <GlassCard className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Usage</h2>
        <p className="text-xs text-slate-500">Current billing period spend vs. limit.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          Couldn&apos;t reach Apify — {error}
        </div>
      )}

      {!error && !usage && (
        <p className="text-sm text-slate-500 animate-pulse">Loading…</p>
      )}

      {usage && (
        <div className="space-y-4">
          {/* Dollar spend */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-sm text-slate-300">
                <span className="text-2xl font-bold text-white tabular-nums">{fmtUsd(usage.monthlyUsd)}</span>
                {" "}of {fmtUsd(usage.limitUsd)}
              </span>
              <span className={`text-sm font-semibold tabular-nums ${(usage.pct ?? 0) >= 100 ? "text-rose-300" : (usage.pct ?? 0) >= 80 ? "text-amber-300" : "text-emerald-300"}`}>
                {usage.pct != null ? `${usage.pct.toFixed(1)}%` : "no limit"}
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full rounded-full transition-all motion-reduce:transition-none ${
                  (usage.pct ?? 0) >= 100 ? "bg-rose-500" : (usage.pct ?? 0) >= 80 ? "bg-amber-500" : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(usage.pct ?? 0, 100)}%` }}
                role="progressbar"
                aria-valuenow={usage.pct ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Monthly spend percentage"
              />
            </div>
          </div>

          {/* Compute units */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Compute units</span>
            <span className="tabular-nums text-slate-200">
              {usage.computeUnits.toLocaleString()} / {usage.computeUnitsLimit != null ? usage.computeUnitsLimit.toLocaleString() : "∞"}
            </span>
          </div>
        </div>
      )}
    </GlassCard>
  )
}

// ---------------------------------------------------------------------------
// Section: Actors + Recent runs
// ---------------------------------------------------------------------------

function ActorsSection({
  actors,
  recent,
  error,
  onAbort,
}: {
  actors: ActorStat[]
  recent: RecentRun[]
  error: string | null
  onAbort: (id: string) => Promise<void>
}) {
  const [aborting, setAborting] = useState<string | null>(null)
  const [abortResult, setAbortResult] = useState<Record<string, string>>({})

  const handleAbort = async (id: string) => {
    if (!confirm(`Abort run ${shortId(id)}?`)) return
    setAborting(id)
    try {
      await onAbort(id)
      setAbortResult((prev) => ({ ...prev, [id]: "Aborted ✓" }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed"
      setAbortResult((prev) => ({ ...prev, [id]: `✗ ${msg}` }))
    } finally {
      setAborting(null)
    }
  }

  return (
    <GlassCard className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Actors usage</h2>
        <p className="text-xs text-slate-500">Per-actor run counts and spend this period.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          Couldn&apos;t reach Apify — {error}
        </div>
      )}

      {!error && actors.length === 0 && (
        <p className="text-sm text-slate-500">No actor runs recorded yet.</p>
      )}

      {actors.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-1.5 pr-4">Actor</th>
                <th className="py-1.5 pr-4 text-right">Runs</th>
                <th className="py-1.5 pr-4 text-right">OK / Fail</th>
                <th className="py-1.5 pr-4 text-right">Spend</th>
                <th className="py-1.5 text-right">Last run</th>
              </tr>
            </thead>
            <tbody>
              {actors.map((a) => (
                <tr key={a.actId} className="border-t border-white/5">
                  <td className="py-2 pr-4 font-medium text-slate-200">{a.actor}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-slate-400">{a.runs}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    <span className="text-emerald-300">{a.ok}</span>
                    <span className="text-slate-600"> / </span>
                    <span className="text-rose-300">{a.failed}</span>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-slate-300">{fmtUsd(a.totalUsd)}</td>
                  <td className="py-2 text-right tabular-nums text-slate-500">{fmtDate(a.lastRunAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent runs */}
      {recent.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-300">Recent runs</h3>
          <div className="space-y-1.5">
            {recent.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg px-3 py-2 bg-white/[0.03] ring-1 ring-white/5"
              >
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="font-mono text-[11px] text-slate-500 shrink-0">{shortId(r.id)}</span>
                  <span className="text-sm text-slate-300 truncate">{r.actor}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${statusBadgeClass(r.status)}`}>
                    {r.status}
                  </span>
                  <span className="tabular-nums text-xs text-slate-400">{fmtUsd(r.usageTotalUsd)}</span>
                  {r.startedAt && (
                    <span className="text-[11px] text-slate-600">{fmtDate(r.startedAt)}</span>
                  )}
                </div>
                {r.status === "RUNNING" && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={aborting === r.id}
                      onClick={() => handleAbort(r.id)}
                      className="h-7 px-2 text-xs text-rose-400 border-rose-500/30 hover:bg-rose-500/10 focus-visible:ring-2 focus-visible:ring-rose-500/60"
                    >
                      {aborting === r.id ? "Aborting…" : "Abort"}
                    </Button>
                    {abortResult[r.id] && (
                      <span className={`text-xs ${abortResult[r.id].startsWith("✗") ? "text-rose-400" : "text-emerald-400"}`}>
                        {abortResult[r.id]}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </GlassCard>
  )
}

// ---------------------------------------------------------------------------
// Section: Alerts
// ---------------------------------------------------------------------------

function AlertsSection({ pct, error }: { pct: number | null; error: string | null }) {
  return (
    <GlassCard className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Alerts</h2>
        <p className="text-xs text-slate-500">Spend thresholds and failure notifications.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          Couldn&apos;t reach Apify — {error}
        </div>
      )}

      {pct !== null && (
        <div className="space-y-2">
          <div
            className={`flex items-center gap-2 rounded-lg px-4 py-3 ring-1 text-sm ${
              pct >= 100
                ? "bg-rose-500/10 ring-rose-500/30 text-rose-300"
                : pct >= 80
                ? "bg-amber-500/10 ring-amber-500/30 text-amber-300"
                : "bg-emerald-500/10 ring-emerald-500/30 text-emerald-300"
            }`}
          >
            <span className="text-base">{pct >= 100 ? "🔴" : pct >= 80 ? "⚠️" : "✓"}</span>
            <span>
              Spend at <span className="font-semibold tabular-nums">{pct.toFixed(1)}%</span> of limit — alert at 80%
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-lg px-4 py-3 ring-1 bg-slate-800/40 ring-white/10 text-sm text-slate-300">
            <span className="text-base">✓</span>
            <span>Failure alerts: <span className="font-medium text-slate-200">on (Telegram)</span></span>
          </div>
        </div>
      )}

      {pct === null && !error && (
        <p className="text-sm text-slate-500 animate-pulse">Loading…</p>
      )}
    </GlassCard>
  )
}

// ---------------------------------------------------------------------------
// Section: API key
// ---------------------------------------------------------------------------

function ApiKeySection({
  masked,
  usageError,
}: {
  masked: string | null
  usageError: string | null
}) {
  const [validating, setValidating] = useState(false)
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null)
  const [validateError, setValidateError] = useState<string | null>(null)

  const handleValidate = async () => {
    setValidating(true)
    setValidateResult(null)
    setValidateError(null)
    try {
      const res = await fetchWithCsrf("/api/apify/validate", { method: "POST" })
      const data = await res.json()
      if (!res.ok || data.error) {
        setValidateError(data.error ?? `HTTP ${res.status}`)
      } else {
        setValidateResult(data as ValidateResult)
      }
    } catch (e) {
      setValidateError(e instanceof Error ? e.message : "Request failed")
    } finally {
      setValidating(false)
    }
  }

  return (
    <GlassCard className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">API key</h2>
        <p className="text-xs text-slate-500">Configured Apify token (masked). Validate to confirm it&apos;s accepted.</p>
      </div>

      {usageError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          Couldn&apos;t reach Apify — {usageError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <code className="rounded-md bg-slate-800/80 px-3 py-1.5 font-mono text-sm text-slate-300 ring-1 ring-white/10">
          {masked ?? "—"}
        </code>
        <Button
          size="sm"
          variant="outline"
          onClick={handleValidate}
          disabled={validating}
          className="focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          {validating ? "Validating…" : "Validate"}
        </Button>
        <a
          href="https://console.apify.com/account/integrations"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-emerald-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 rounded"
        >
          Apify console <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {validateResult && (
        <div className={`rounded-lg px-4 py-3 ring-1 text-sm ${validateResult.ok ? "bg-emerald-500/10 ring-emerald-500/30 text-emerald-300" : "bg-rose-500/10 ring-rose-500/30 text-rose-300"}`}>
          {validateResult.ok ? (
            <span>✓ Valid · <span className="font-medium">{validateResult.username}</span> · {validateResult.plan}</span>
          ) : (
            <span>✗ Invalid token</span>
          )}
        </div>
      )}

      {validateError && (
        <p className="text-sm text-rose-400">{validateError}</p>
      )}
    </GlassCard>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ApifyPageClient() {
  const [usageResponse, setUsageResponse] = useState<UsageResponse | null>(null)
  const [runsResponse, setRunsResponse] = useState<RunsResponse | null>(null)
  const [loadingUsage, setLoadingUsage] = useState(true)
  const [loadingRuns, setLoadingRuns] = useState(true)

  const fetchUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/apify/usage", { credentials: "include" })
      const data: UsageResponse = await res.json()
      setUsageResponse(data)
    } catch {
      setUsageResponse({ error: "Network error" })
    } finally {
      setLoadingUsage(false)
    }
  }, [])

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/apify/runs", { credentials: "include" })
      const data: RunsResponse = await res.json()
      setRunsResponse(data)
    } catch {
      setRunsResponse({ error: "Network error" })
    } finally {
      setLoadingRuns(false)
    }
  }, [])

  useEffect(() => {
    fetchUsage()
    fetchRuns()
  }, [fetchUsage, fetchRuns])

  const handleAbort = async (id: string) => {
    const res = await fetchWithCsrf(`/api/apify/runs/${id}/abort`, { method: "POST" })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
    }
    // Refetch runs after successful abort
    await fetchRuns()
  }

  const usageData = usageResponse?.usage ?? null
  const usageError = usageResponse?.error ?? null
  const masked = usageResponse?.masked ?? null

  const actors = runsResponse?.actors ?? []
  const recent = runsResponse?.recent ?? []
  const runsError = runsResponse?.error ?? null

  const isLoading = loadingUsage || loadingRuns

  // BYO-key (C3): no Apify token stored for this tenant (and, for non-owners, no env
  // fallback either) — the API routes signal this via `needsKey` instead of an error.
  const needsKey = !isLoading && (usageResponse?.needsKey === true || runsResponse?.needsKey === true)

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Apify</h1>
        <p className="text-sm text-slate-400">
          Usage, actor runs, spend alerts, and API key health.
          {isLoading && <span className="ml-2 animate-pulse text-slate-500">Loading…</span>}
        </p>
      </div>

      {needsKey ? (
        <NeedsKeySection />
      ) : (
        <>
          {/* Usage */}
          <UsageSection usage={usageData} error={usageError} />

          {/* Actors + Recent runs */}
          <ActorsSection
            actors={actors}
            recent={recent}
            error={runsError}
            onAbort={handleAbort}
          />

          {/* Alerts */}
          <AlertsSection pct={usageData?.pct ?? null} error={usageError} />

          {/* API key */}
          <ApiKeySection masked={masked} usageError={usageError} />
        </>
      )}
    </div>
  )
}
