"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { api } from "@/lib/csrf"
import { GlassCard } from "@/components/ui/glass-card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { X, Plus, Radar, ChevronDown, ChevronRight } from "lucide-react"
import { filtersFor, type FilterDef } from "@/lib/source-filters-manifest"

interface DiscoverySource { name: string; market: string; enabled: boolean; enable_by_default: boolean; run_interval_hours: number }
interface DiscoveryConfig {
  sources: DiscoverySource[]
  excludes: string[]
  sourceConfigs: Record<string, Record<string, unknown>>
}
interface DiscoveryRun {
  id: number; status: string; source: string
  requested_at: string; started_at: string | null; finished_at: string | null
  fetched: number | null; matched: number | null; inserted: number | null; error: string | null
}

/**
 * De-slug and title-case a raw option value for display when no explicit
 * `optionLabels` entry is provided. Examples:
 *   "data-science" → "Data Science"
 *   "software-development" → "Software Development"
 *   "entry" → "Entry"
 */
function prettify(s: string): string {
  return s
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// Sources that need a paid Apify token to actually run (informational note only).
// Free sources (remotive, remoteok, jobicy, arbeitnow, weworkremotely, himalayas,
// hackernews, freelancer, careerjet) must NOT appear here.
const PAID_SOURCES = new Set([
  "bayt", "wuzzuf", "naukrigulf", "gulftalent", "indeed",
  "wellfound", "linkedin", "mostaql", "upwork",
])

function normalizeTermClient(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase()
}

function fmtTime(d: string | null): string {
  if (!d) return ""
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? "" : dt.toLocaleString()
}
function runStatusText(run: DiscoveryRun | null): string {
  if (!run) return "Auto-runs every 6h. Click to run now."
  switch (run.status) {
    case "requested": return "Queued — starts within ~1 minute…"
    case "running": return "Running…"
    case "done": return `Last run: ${run.inserted ?? 0} new (${run.fetched ?? 0} fetched, ${run.matched ?? 0} matched) · ${fmtTime(run.finished_at)}`
    case "error": return `Last run failed: ${run.error || "unknown"} · ${fmtTime(run.finished_at)}`
    default: return run.status
  }
}

// ---------------------------------------------------------------------------
// Per-source preview types + pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

export interface PreviewJob {
  title: string
  company: string
  location: string
  url: string
  postedAt: string | null
  tags: string[]
  passesProfile: boolean
  passesQuality: boolean
  qualityReason: string | null
}

export interface PreviewResult {
  fetched: number
  kept: number
  jobs: PreviewJob[]
}

/** Pure summary line: "fetched N → M kept" */
export function summarize(result: PreviewResult): string {
  return `fetched ${result.fetched} → ${result.kept} kept`
}

type PreviewState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; result: PreviewResult }
  | { phase: "error"; message: string }
  | { phase: "timeout" }

// ---------------------------------------------------------------------------
// Per-source filter helpers (pure, exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Parse a raw `range` string pair (min, max) into [number|null, number|null].
 * Empty string → null (unset bound).
 */
export function parseRangeBound(s: string): number | null {
  const trimmed = s.trim()
  if (trimmed === "") return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/**
 * Assemble the config object to PATCH from the per-source local state.
 * Returns an Error string when the advancedJson is non-empty and not valid JSON.
 */
export function assembleConfig(
  filters: FilterDef[],
  values: Record<string, unknown>,
  advancedJson: string,
): Record<string, unknown> | string {
  const config: Record<string, unknown> = {}

  for (const f of filters) {
    const raw = values[f.key]

    if (f.type === "range") {
      const [rawMin, rawMax] = (raw as [string, string]) ?? ["", ""]
      const min = parseRangeBound(rawMin ?? "")
      const max = parseRangeBound(rawMax ?? "")
      if (min !== null || max !== null) {
        config[f.key] = [min, max]
      }
    } else if (f.type === "tags") {
      const str = (raw as string) ?? ""
      const tags = str
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
      if (tags.length > 0) config[f.key] = tags
    } else if (f.type === "select") {
      const s = raw as string | undefined
      if (s !== undefined && s !== "") config[f.key] = s
    } else if (f.type === "multiselect") {
      const arr = (raw as string[]) ?? []
      if (arr.length > 0) config[f.key] = arr
    } else if (f.type === "bool") {
      if (raw === true) config[f.key] = true
    } else {
      // text | number
      const s = raw as string | undefined
      if (s !== undefined && s !== "") config[f.key] = f.type === "number" ? Number(s) : s
    }
  }

  if (advancedJson.trim() !== "") {
    try {
      const parsed = JSON.parse(advancedJson)
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return "Advanced JSON must be a plain object (e.g. {\"key\": \"value\"})."
      }
      config.advanced = parsed
    } catch {
      return "Advanced JSON is not valid JSON. Fix it or clear the field before saving."
    }
  }

  return config
}

// ---------------------------------------------------------------------------
// Per-source filter panel component
// ---------------------------------------------------------------------------

interface SourceFilterPanelProps {
  sourceName: string
  initialConfig: Record<string, unknown>
  jsonPayload: boolean
  onSaved?: (sourceName: string, config: Record<string, unknown>) => void
}

function SourceFilterPanel({ sourceName, initialConfig, jsonPayload, onSaved }: SourceFilterPanelProps) {
  const filters = filtersFor(sourceName)

  // Build initial local state from savedConfig
  function initValues(cfg: Record<string, unknown>): Record<string, unknown> {
    const v: Record<string, unknown> = {}
    for (const f of filters) {
      const saved = cfg[f.key]
      if (f.type === "range") {
        const arr = Array.isArray(saved) ? saved : [null, null]
        v[f.key] = [arr[0] == null ? "" : String(arr[0]), arr[1] == null ? "" : String(arr[1])] as [string, string]
      } else if (f.type === "select") {
        v[f.key] = typeof saved === "string" ? saved : ""
      } else if (f.type === "multiselect") {
        v[f.key] = Array.isArray(saved) ? [...(saved as string[])] : []
      } else if (f.type === "bool") {
        v[f.key] = saved === true
      } else if (f.type === "tags") {
        v[f.key] = Array.isArray(saved) ? (saved as string[]).join(", ") : (typeof saved === "string" ? saved : "")
      } else {
        // text | number
        v[f.key] = saved !== undefined && saved !== null ? String(saved) : ""
      }
    }
    return v
  }

  const [values, setValues] = useState<Record<string, unknown>>(() => initValues(initialConfig))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)

  // Live read-only payload preview: recomputed on every render from current values
  const payload = assembleConfig(filters, values, "")

  function setField(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, [key]: value }))
    setSaveOk(false)
  }

  function toggleMultiselect(key: string, option: string, checked: boolean) {
    setValues((prev) => {
      const arr = (prev[key] as string[]) ?? []
      return {
        ...prev,
        [key]: checked ? [...arr, option] : arr.filter((x) => x !== option),
      }
    })
    setSaveOk(false)
  }

  async function handleSave() {
    setSaveError(null)
    setSaveOk(false)

    const result = assembleConfig(filters, values, "")
    if (typeof result === "string") {
      // Defensive guard — should not fire since we pass empty advancedJson
      setSaveError(result)
      return
    }

    setSaving(true)
    try {
      const res = await api.patch(
        `/api/jobs/discovery/sources/${encodeURIComponent(sourceName)}/config`,
        result,
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSaveError((data as { error?: string }).error ?? `HTTP ${res.status}`)
      } else {
        setSaveOk(true)
        onSaved?.(sourceName, result)
      }
    } catch (e) {
      console.error("Failed to save source config", e)
      setSaveError("Failed to save filter config.")
    } finally {
      setSaving(false)
    }
  }

  const filterKeys = filters.map((f) => f.key).join(", ")

  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-slate-900/60 p-4 space-y-4">
      {/* Hint: supported keys (only shown when there are filters) */}
      {filters.length > 0 && (
        <p className="text-[11px] text-slate-500">
          <span className="font-medium text-slate-400">Supported keys:</span> {filterKeys}
        </p>
      )}

      {/* Filter controls */}
      <div className="space-y-3">
        {filters.map((f) => (
          <FilterControl
            key={f.key}
            def={f}
            value={values[f.key]}
            onChange={(v) => setField(f.key, v)}
            onMultiselectToggle={(option, checked) => toggleMultiselect(f.key, option, checked)}
          />
        ))}
      </div>

      {/* Live JSON payload preview — only for Apify sources that accept actor input */}
      {jsonPayload && (
        <div className="space-y-1">
          <p className="block text-xs font-medium text-slate-400">Config sent (JSON)</p>
          <pre className="w-full rounded-md border border-white/10 bg-slate-800/60 p-3 text-xs text-slate-200 font-mono whitespace-pre-wrap break-all">
            {typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)}
          </pre>
          <p className="text-[11px] text-slate-500">
            Live preview of what&apos;s saved for this source — updates as you change filters.
          </p>
        </div>
      )}

      {/* Save row */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save filters"}
        </Button>
        {saveOk && <span className="text-xs text-emerald-400">Saved ✓</span>}
        {saveError && <span className="text-xs text-rose-400">{saveError}</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sticky right-hand preview panel
// ---------------------------------------------------------------------------

function PreviewPanel({ sourceName, state }: { sourceName: string | null; state: PreviewState | undefined }) {
  return (
    <GlassCard className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-100">Preview</span>
        {sourceName && (
          <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[11px] text-slate-400 ring-1 ring-white/10">
            {sourceName}
          </span>
        )}
      </div>

      {/* Body */}
      {(!sourceName || !state || state.phase === "idle") && (
        <p className="text-xs text-slate-500">
          Click <strong className="font-medium text-slate-400">Test (10)</strong> on any source to preview its first 10 results here — no DB writes.
        </p>
      )}

      {state?.phase === "loading" && (
        <p className="text-xs text-slate-400 animate-pulse">Running preview… (up to ~3 min)</p>
      )}

      {state?.phase === "timeout" && (
        <p className="text-xs text-amber-400">Preview timed out — the engine may be busy. Try again.</p>
      )}

      {state?.phase === "error" && (
        <p className="text-xs text-rose-400">{state.message}</p>
      )}

      {state?.phase === "done" && (
        <>
          <p className="text-xs font-medium text-slate-300">{summarize(state.result)}</p>
          {state.result.jobs.length === 0 ? (
            <p className="text-xs text-slate-500">No records returned.</p>
          ) : (
            <ul className="space-y-3">
              {state.result.jobs.map((job, i) => (
                <li key={i} className="border-t border-white/5 pt-3 first:border-0 first:pt-0 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-emerald-300 hover:underline leading-snug"
                    >
                      {job.title}
                    </a>
                    <div className="flex items-center gap-1 shrink-0">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${
                          job.passesProfile
                            ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
                            : "bg-rose-500/10 text-rose-300 ring-rose-500/30"
                        }`}
                        title="keyword filter"
                      >
                        keyword {job.passesProfile ? "✓" : "✗"}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${
                          job.passesQuality
                            ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
                            : "bg-rose-500/10 text-rose-300 ring-rose-500/30"
                        }`}
                        title={job.qualityReason ?? "quality filter"}
                      >
                        quality {job.passesQuality ? "✓" : `✗${job.qualityReason ? ` (${job.qualityReason})` : ""}`}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {[job.company, job.location, job.postedAt ? `posted ${job.postedAt}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {job.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {job.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] text-slate-400 ring-1 ring-white/10">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </GlassCard>
  )
}

// ---------------------------------------------------------------------------
// Individual filter control (rendered per FilterDef)
// ---------------------------------------------------------------------------

interface FilterControlProps {
  def: FilterDef
  value: unknown
  onChange: (v: unknown) => void
  onMultiselectToggle: (option: string, checked: boolean) => void
}

function FilterControl({ def, value, onChange, onMultiselectToggle }: FilterControlProps) {
  const labelClass = "block text-xs font-medium text-slate-400 mb-1"
  const inputClass =
    "rounded-md border border-white/10 bg-slate-800/60 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 w-full"

  /** Format a filter's default value for display (friendly labels for arrays). */
  function formatDefault(def: FilterDef): string | null {
    const d = def.default
    if (d === undefined || d === null) return null
    if (Array.isArray(d)) {
      const labels = (d as string[]).map((v) => def.optionLabels?.[v] ?? prettify(v))
      return labels.join(", ")
    }
    if (typeof d === "string") return def.optionLabels?.[d] ?? d
    return String(d)
  }

  const defaultCaption = formatDefault(def)

  if (def.type === "text") {
    return (
      <div>
        <label htmlFor={`filter-${def.key}`} className={labelClass}>{def.label}</label>
        <input
          id={`filter-${def.key}`}
          type="text"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={defaultCaption ?? undefined}
          className={inputClass}
        />
        {def.hint && <p className="mt-1 text-[11px] text-slate-500">{def.hint}</p>}
        {defaultCaption && <p className="mt-0.5 text-[11px] text-slate-600">Default: {defaultCaption}</p>}
      </div>
    )
  }

  if (def.type === "number") {
    return (
      <div>
        <label htmlFor={`filter-${def.key}`} className={labelClass}>{def.label}</label>
        <input
          id={`filter-${def.key}`}
          type="number"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={defaultCaption ?? undefined}
          className={inputClass}
        />
        {def.hint && <p className="mt-1 text-[11px] text-slate-500">{def.hint}</p>}
        {defaultCaption && <p className="mt-0.5 text-[11px] text-slate-600">Default: {defaultCaption}</p>}
      </div>
    )
  }

  if (def.type === "bool") {
    return (
      <div className="flex items-center gap-2">
        <Switch
          id={`filter-${def.key}`}
          checked={(value as boolean) ?? false}
          onCheckedChange={(v) => onChange(v)}
        />
        <label htmlFor={`filter-${def.key}`} className="text-sm text-slate-300 cursor-pointer">
          {def.label}
        </label>
        {def.hint && <p className="mt-1 text-[11px] text-slate-500">{def.hint}</p>}
      </div>
    )
  }

  if (def.type === "select") {
    const selected = (value as string) ?? ""
    return (
      <div>
        <label htmlFor={`filter-${def.key}`} className={labelClass}>{def.label}</label>
        <select
          id={`filter-${def.key}`}
          value={selected}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-md border border-white/10 bg-slate-800/60 px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 w-full"
        >
          <option value="">— any —</option>
          {(def.options ?? []).map((opt) => {
            const display = def.optionLabels?.[opt] ?? prettify(opt)
            return (
              <option key={opt} value={opt}>{display}</option>
            )
          })}
        </select>
        {def.hint && <p className="mt-1 text-[11px] text-slate-500">{def.hint}</p>}
        {defaultCaption && <p className="mt-0.5 text-[11px] text-slate-600">Default: {defaultCaption}</p>}
      </div>
    )
  }

  if (def.type === "multiselect") {
    const selected = (value as string[]) ?? []
    return (
      <fieldset>
        <legend className={labelClass}>{def.label}</legend>
        <div className="flex flex-wrap gap-2">
          {(def.options ?? []).map((opt) => {
            const checked = selected.includes(opt)
            // Use explicit optionLabels when defined, otherwise de-slug + title-case.
            const display = def.optionLabels?.[opt] ?? prettify(opt)
            return (
              <label
                key={opt}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-sm cursor-pointer ring-1 transition-colors ${
                  checked
                    ? "bg-emerald-500/20 text-emerald-200 ring-emerald-500/40"
                    : "bg-slate-800/60 text-slate-400 ring-white/10 hover:text-slate-200 hover:ring-white/20"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onMultiselectToggle(opt, e.target.checked)}
                  className="sr-only"
                />
                {display}
              </label>
            )
          })}
        </div>
        {def.hint && <p className="mt-1 text-[11px] text-slate-500">{def.hint}</p>}
        {defaultCaption && <p className="mt-0.5 text-[11px] text-slate-600">Default: {defaultCaption}</p>}
      </fieldset>
    )
  }

  if (def.type === "range") {
    const [minStr, maxStr] = (value as [string, string]) ?? ["", ""]
    return (
      <div>
        <span className={labelClass}>{def.label}</span>
        <div className="flex items-center gap-2">
          <input
            id={`filter-${def.key}-min`}
            type="number"
            value={minStr ?? ""}
            onChange={(e) => onChange([e.target.value, maxStr ?? ""] as [string, string])}
            placeholder="min"
            aria-label={`${def.label} minimum`}
            className={`${inputClass} w-28`}
          />
          <span className="text-slate-500 text-sm">–</span>
          <input
            id={`filter-${def.key}-max`}
            type="number"
            value={maxStr ?? ""}
            onChange={(e) => onChange([minStr ?? "", e.target.value] as [string, string])}
            placeholder="max"
            aria-label={`${def.label} maximum`}
            className={`${inputClass} w-28`}
          />
        </div>
        {def.hint && <p className="mt-1 text-[11px] text-slate-500">{def.hint}</p>}
      </div>
    )
  }

  if (def.type === "tags") {
    return (
      <div>
        <label htmlFor={`filter-${def.key}`} className={labelClass}>
          {def.label} <span className="font-normal text-slate-500">(comma-separated)</span>
        </label>
        <input
          id={`filter-${def.key}`}
          type="text"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. US, UK, Canada"
          className={inputClass}
        />
        {def.hint && <p className="mt-1 text-[11px] text-slate-500">{def.hint}</p>}
        {defaultCaption && <p className="mt-0.5 text-[11px] text-slate-600">Default: {defaultCaption}</p>}
      </div>
    )
  }

  return null
}

export default function DiscoveryPageClient() {
  // editable config — every change auto-saves, then reconciles with server truth
  const [sources, setSources] = useState<DiscoverySource[]>([])
  const [excludes, setExcludes] = useState<string[]>([])
  const [sourceConfigs, setSourceConfigs] = useState<Record<string, Record<string, unknown>>>({})
  const [openFilters, setOpenFilters] = useState<Set<string>>(new Set())
  const [newTerm, setNewTerm] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [run, setRun] = useState<DiscoveryRun | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [dismissResult, setDismissResult] = useState<string | null>(null)
  // Per-source preview state: source name → PreviewState
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({})
  // Track the most-recently-tested source for the right-hand preview panel
  const [activePreview, setActivePreview] = useState<string | null>(null)
  // Track active poll timers so we can cancel them when a new test starts
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({})

  const hydrate = useCallback((cfg: DiscoveryConfig) => {
    setSources(cfg.sources)
    setExcludes(cfg.excludes)
    setSourceConfigs(cfg.sourceConfigs ?? {})
  }, [])

  const fetchConfig = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/jobs/discovery", { credentials: "include" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: DiscoveryConfig = await res.json()
      hydrate(data)
    } catch (e) {
      console.error("Failed to load discovery config", e)
      setError("Failed to load discovery settings.")
    } finally {
      setLoading(false)
    }
  }, [hydrate])

  useEffect(() => { fetchConfig() }, [fetchConfig])

  const fetchRun = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs/discovery/run", { credentials: "include" })
      if (!res.ok) return
      const data = await res.json()
      setRun(data.run ?? null)
    } catch { /* status is best-effort */ }
  }, [])

  useEffect(() => { fetchRun() }, [fetchRun])

  // Poll while a run is queued or in-flight so the status updates live.
  const runActive = run?.status === "requested" || run?.status === "running"
  useEffect(() => {
    if (!runActive) return
    const t = setInterval(fetchRun, 3000)
    return () => clearInterval(t)
  }, [runActive, fetchRun])

  // Clear all active preview poll timers on unmount to prevent memory leaks.
  useEffect(() => {
    const timers = pollTimers
    return () => {
      for (const timer of Object.values(timers.current)) {
        clearInterval(timer)
      }
    }
  }, [])

  const requestRun = async () => {
    setRequesting(true)
    setError(null)
    try {
      const res = await api.post("/api/jobs/discovery/run", {})
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRun(data.run ?? null)
    } catch (e) {
      console.error("Failed to queue discovery", e)
      setError("Failed to queue discovery run.")
    } finally {
      setRequesting(false)
    }
  }

  // Every change is PUT immediately (optimistic), then reconciled with the returned
  // config. On failure we re-sync to server truth so the UI never lies.
  const applyChange = useCallback(async (change: Record<string, unknown>) => {
    setError(null)
    setSaving(true)
    try {
      const res = await api.put("/api/jobs/discovery", change)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      hydrate(await res.json())
      setSavedAt(Date.now())
    } catch (e) {
      console.error("Failed to save discovery change", e)
      setError("Couldn't save that change — reverted.")
      fetchConfig()
    } finally {
      setSaving(false)
    }
  }, [hydrate, fetchConfig])

  const toggleSource = (name: string, enabled: boolean) => {
    setSources((prev) => prev.map((s) => (s.name === name ? { ...s, enabled } : s)))
    applyChange({ sources: [{ name, enabled }] })
  }
  const changeInterval = (name: string, hours: number) => {
    setSources((prev) => prev.map((s) => (s.name === name ? { ...s, run_interval_hours: hours } : s)))
    applyChange({ intervals: [{ name, hours }] })
  }
  const addTerm = () => {
    const t = normalizeTermClient(newTerm)
    if (!t || t.length > 80) return
    setNewTerm("")
    if (excludes.includes(t)) return
    setExcludes((prev) => [...prev, t].sort())
    applyChange({ addExcludes: [t] })
  }
  const removeTerm = (t: string) => {
    setExcludes((prev) => prev.filter((x) => x !== t))
    applyChange({ removeExcludes: [t] })
  }

  // Retroactively dismiss inbox jobs that match the current exclude keywords.
  const dismissMatching = async () => {
    setDismissing(true)
    setError(null)
    setDismissResult(null)
    try {
      const res = await api.post("/api/jobs/discovery/dismiss-matching", {})
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setDismissResult(`Dismissed ${data.dismissed} matching job${data.dismissed === 1 ? "" : "s"}.`)
    } catch (e) {
      console.error("Failed to dismiss matching jobs", e)
      setError("Couldn't dismiss matching jobs.")
    } finally {
      setDismissing(false)
    }
  }

  // Run a per-source preview: POST → get id → poll GET every 3s → up to 90s.
  const testSource = useCallback(async (sourceName: string) => {
    // Track which source is being previewed in the right panel
    setActivePreview(sourceName)

    // Cancel any existing poll for this source
    if (pollTimers.current[sourceName]) {
      clearInterval(pollTimers.current[sourceName])
      delete pollTimers.current[sourceName]
    }

    setPreviews((prev) => ({ ...prev, [sourceName]: { phase: "loading" } }))

    let id: number
    try {
      const res = await api.post(
        `/api/jobs/discovery/sources/${encodeURIComponent(sourceName)}/preview`,
        {},
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const msg = (data as { error?: string }).error ?? `HTTP ${res.status}`
        setPreviews((prev) => ({ ...prev, [sourceName]: { phase: "error", message: msg } }))
        return
      }
      const data = await res.json()
      id = (data as { id: number }).id
    } catch {
      setPreviews((prev) => ({
        ...prev,
        [sourceName]: { phase: "error", message: "Failed to start preview." },
      }))
      return
    }

    // Poll every 3s, give up after 180s (60 ticks)
    const startedAt = Date.now()
    const MAX_MS = 180_000
    const POLL_MS = 3_000

    const timer = setInterval(async () => {
      if (Date.now() - startedAt > MAX_MS) {
        clearInterval(pollTimers.current[sourceName])
        delete pollTimers.current[sourceName]
        setPreviews((prev) => ({ ...prev, [sourceName]: { phase: "timeout" } }))
        return
      }

      try {
        const res = await fetch(
          `/api/jobs/discovery/previews/${id}`,
          { credentials: "include" },
        )
        if (!res.ok) return // transient error — keep polling
        const data = await res.json()
        const { status, result, error: errMsg } = data as {
          status: string
          result: PreviewResult | null
          error: string | null
        }

        if (status === "done") {
          clearInterval(pollTimers.current[sourceName])
          delete pollTimers.current[sourceName]
          setPreviews((prev) => ({
            ...prev,
            [sourceName]: { phase: "done", result: result! },
          }))
        } else if (status === "error") {
          clearInterval(pollTimers.current[sourceName])
          delete pollTimers.current[sourceName]
          setPreviews((prev) => ({
            ...prev,
            [sourceName]: { phase: "error", message: errMsg ?? "Preview failed." },
          }))
        }
        // status === 'requested' | 'running' → keep polling
      } catch {
        // network hiccup — keep polling
      }
    }, POLL_MS)

    pollTimers.current[sourceName] = timer
  }, [])

  // Group sources by market for display (data-driven — no hardcoded source names).
  const grouped = useMemo(() => {
    const byMarket = new Map<string, DiscoverySource[]>()
    for (const s of sources) {
      const arr = byMarket.get(s.market) ?? []
      arr.push(s)
      byMarket.set(s.market, arr)
    }
    return [...byMarket.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [sources])

  return (
    <div className="space-y-4">
      {/* Page header — full width */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Discovery</h1>
          <p className="text-sm text-slate-400">Pick the sources and exclude words your radar uses. Configure countries per-source via the Filters panel. Changes apply on the next run.</p>
        </div>
        <div className="flex items-center gap-2 text-xs h-5" aria-live="polite">
          {saving ? (
            <span className="text-slate-400">Saving…</span>
          ) : savedAt ? (
            <span className="text-emerald-400">Saved ✓</span>
          ) : (
            <span className="text-slate-500">Changes save automatically</span>
          )}
        </div>
      </div>

      {/* Two-column layout: left content + right sticky preview */}
      <div className="flex flex-col lg:flex-row lg:items-start gap-4">
        {/* Left column */}
        <div className="space-y-4 flex-1 min-w-0 lg:max-w-3xl">
          <GlassCard className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-400/20">
                <Radar className={`h-4 w-4 text-emerald-300 ${runActive ? "animate-pulse" : ""}`} />
              </div>
              <div className="text-sm">
                <div className="font-medium text-slate-100">On-demand discovery</div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  {run && <span className={`h-1.5 w-1.5 rounded-full ${run.status === "running" ? "bg-emerald-400 animate-pulse" : run.status === "requested" ? "bg-amber-400" : run.status === "error" ? "bg-rose-400" : "bg-slate-500"}`} />}
                  {runStatusText(run)}
                </div>
              </div>
            </div>
            <Button onClick={requestRun} disabled={requesting || runActive}>
              {runActive ? "Running…" : requesting ? "Queuing…" : "Run discovery now"}
            </Button>
          </GlassCard>

          {error && <p className="text-sm text-red-400">{error}</p>}

          {loading ? (
            <GlassCard><p className="text-slate-500">Loading…</p></GlassCard>
          ) : (
            <>
              {/* Sources */}
              <GlassCard className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold">Sources</h2>
                  <p className="text-xs text-slate-500">Toggle each discovery source. New sources appear here automatically.</p>
                </div>
                {sources.length === 0 ? (
                  <p className="text-sm text-slate-500">No sources configured yet.</p>
                ) : (
                  grouped.map(([market, list]) => (
                    <div key={market} className="space-y-1">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{market === "mena" ? "Gulf (GCC)" : market}</div>
                      {list.map((s) => {
                        const filtersOpen = openFilters.has(s.name)
                        const hasFilters = filtersFor(s.name).length > 0
                        return (
                          <div key={s.name} className="rounded-lg transition-colors hover:bg-white/[0.03]">
                            <div className="flex items-center justify-between px-2 py-2">
                              <div className="flex items-center gap-2.5">
                                <span className={`h-1.5 w-1.5 rounded-full ${s.enabled ? "bg-emerald-400" : "bg-slate-600"}`} />
                                <span className="text-sm font-medium text-slate-100">{s.name}</span>
                                {PAID_SOURCES.has(s.name) && (
                                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-amber-400/30 bg-amber-500/10 text-amber-300">paid · Apify</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    if (!hasFilters) return
                                    setOpenFilters((prev) => {
                                      const next = new Set(prev)
                                      if (next.has(s.name)) next.delete(s.name)
                                      else next.add(s.name)
                                      return next
                                    })
                                  }}
                                  disabled={!hasFilters}
                                  aria-expanded={filtersOpen}
                                  aria-label={`${filtersOpen ? "Hide" : "Show"} filters for ${s.name}`}
                                  title={!hasFilters ? "No configurable filters for this source" : undefined}
                                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ring-1 transition-colors ${
                                    hasFilters
                                      ? "text-slate-400 ring-white/10 hover:text-slate-200 hover:ring-white/20 cursor-pointer"
                                      : "text-slate-400 ring-white/10 opacity-40 cursor-not-allowed"
                                  }`}
                                >
                                  {filtersOpen ? (
                                    <ChevronDown className="h-3 w-3" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3" />
                                  )}
                                  Filters
                                </button>
                                <button
                                  onClick={() => testSource(s.name)}
                                  disabled={(previews[s.name]?.phase ?? "idle") === "loading"}
                                  aria-label={`Test ${s.name} with 10 records`}
                                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-slate-400 ring-1 ring-white/10 hover:text-slate-200 hover:ring-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {(previews[s.name]?.phase ?? "idle") === "loading" ? "Testing…" : "Test (10)"}
                                </button>
                                <label className="flex items-center gap-1 text-[11px] text-slate-400" title="How often this source runs">
                                  <span>every</span>
                                  <select
                                    value={s.run_interval_hours}
                                    onChange={(e) => changeInterval(s.name, Number(e.target.value))}
                                    aria-label={`Run interval for ${s.name}`}
                                    className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300 ring-1 ring-white/10 hover:ring-white/20 focus:outline-none focus:ring-white/30 transition-colors cursor-pointer"
                                  >
                                    {([6, 12, 24, 48, 72] as const).map((h) => (
                                      <option key={h} value={h}>{h}h</option>
                                    ))}
                                  </select>
                                </label>
                                <Switch
                                  checked={s.enabled}
                                  onCheckedChange={(v) => toggleSource(s.name, v)}
                                  aria-label={`Toggle source ${s.name}`}
                                />
                              </div>
                            </div>
                            {filtersOpen && hasFilters && (
                              <div className="px-2 pb-3">
                                <SourceFilterPanel
                                  sourceName={s.name}
                                  initialConfig={sourceConfigs[s.name] ?? {}}
                                  jsonPayload={PAID_SOURCES.has(s.name)}
                                  onSaved={(name, cfg) => setSourceConfigs((prev) => ({ ...prev, [name]: cfg }))}
                                />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ))
                )}
              </GlassCard>

              {/* Exclude keywords */}
              <GlassCard className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">Exclude keywords</h2>
                    <p className="text-xs text-slate-500">Terms to filter out. New matches are skipped at discovery; &ldquo;Dismiss matching jobs&rdquo; moves inbox jobs whose <strong className="font-medium text-slate-400">title</strong> contains a whole-word match to dismissed.</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Button variant="outline" size="sm" onClick={dismissMatching} disabled={dismissing || excludes.length === 0}>
                      {dismissing ? "Dismissing…" : "Dismiss matching jobs"}
                    </Button>
                    {dismissResult && <span className="text-xs text-emerald-400">{dismissResult}</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newTerm}
                    onChange={(e) => setNewTerm(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTerm() } }}
                    placeholder="e.g. ios developer"
                    maxLength={80}
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={addTerm} disabled={!normalizeTermClient(newTerm)}>
                    <Plus className="h-4 w-4" /> Add
                  </Button>
                </div>
                {excludes.length === 0 ? (
                  <p className="text-sm text-slate-500">No exclude keywords.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {excludes.map((t) => (
                      <span key={t} className="group inline-flex items-center gap-1.5 rounded-full bg-slate-800/80 px-3 py-1 text-xs text-slate-200 ring-1 ring-white/10 transition-colors hover:ring-rose-400/30">
                        {t}
                        <button
                          onClick={() => removeTerm(t)}
                          className="text-slate-500 transition-colors hover:text-rose-400"
                          aria-label={`Remove exclude ${t}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </GlassCard>
            </>
          )}
        </div>

        {/* Right column — sticky preview panel */}
        <aside className="w-full lg:w-[360px] lg:shrink-0 lg:sticky lg:top-4">
          <PreviewPanel
            sourceName={activePreview}
            state={activePreview ? previews[activePreview] : undefined}
          />
        </aside>
      </div>
    </div>
  )
}
