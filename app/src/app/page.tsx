"use client"

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { buildJobsQuery, parseJobsView } from "@/lib/jobs-url"
import { activeFilterChips } from "@/lib/jobs-chips"
import { api } from "@/lib/csrf"
import { formatJobSummary } from "@/lib/job-summary"
import { formatSalaryChip, formatSalaryUsd } from "@/lib/salary-chip"
import { relativeAgo } from "@/lib/relative-time"
import { GlassCard } from "@/components/ui/glass-card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { ExternalLink, FileText, X, Sparkles, Wand2, Inbox, Search } from "lucide-react"
import { MultiSelect } from "@/components/jobs/multi-select"
import { RangeInput } from "@/components/jobs/range-input"
import { JobDrawer } from "@/components/jobs/job-drawer"
import { WORK_MODES, CATEGORIES, ELIGIBILITY_STD, ELIGIBILITY_STD_LABELS, type SortKey, type SortSpec, type Facets, type EligibilityStd } from "@/lib/jobs-repo"

interface Job {
  id: number; title: string; company: string | null; location: string | null; remote: boolean | null
  market: string; source: string; url: string; posted_at: string | null; discovered_at: string | null; status: string; score: number | null; score_reason: string | null; tags: string[] | null
  seniority_fit: string | null; domain_fit: string | null; remote_fit: string | null
  matched_skills: string[] | null; missing_skills: string[] | null
  clean_title: string | null; tech_stack: string[] | null; work_mode: string | null; locations: string[] | null; eligibility: string | null
  category: string | null; eligibility_std: string | null
  cv_pdf: string | null; cover_pdf: string | null; materials_status: string | null
  apply_answers: Record<string, string> | null
  status_changed_at: string | null
  salary_range: string | null; salary_source: string | null; salary_ask: string | null
  salary_usd_min: number | null; salary_usd_max: number | null
}
interface RunInfo { kind: string; status: string; note: string | null; inserted: number | null; finished_at: string | null; error: string | null }
const RUN_LABELS: Record<string, string> = { score: "Run scoring", tailor: "Run tailoring" }

// Score is the signature signal: a graded pill + a thin fill bar so good matches pop.
function scoreTier(score: number): { text: string; ring: string; bar: string } {
  if (score >= 85) return { text: "text-emerald-300", ring: "ring-emerald-400/40", bar: "bg-emerald-400" }
  if (score >= 70) return { text: "text-teal-300", ring: "ring-teal-400/40", bar: "bg-teal-400" }
  if (score >= 55) return { text: "text-amber-300", ring: "ring-amber-400/40", bar: "bg-amber-400" }
  return { text: "text-rose-300/90", ring: "ring-rose-400/30", bar: "bg-rose-400/80" }
}

// Prefer the engine's normalized USD figure when present; fall back to the raw listed/estimated range.
function salaryDisplay(j: Job): string {
  return formatSalaryUsd(j) || formatSalaryChip(j)
}

// Canonical work-type badge — work_mode is authoritative; fall back to the
// source-derived `remote` boolean when the engine hasn't classified it yet.
function workModeDisplay(j: Job): { label: string; cls: string } | null {
  const mode = j.work_mode || (j.remote ? "remote" : null)
  if (!mode) return null
  const cls = mode === "remote"
    ? "ring-emerald-400/20 bg-emerald-500/10 text-emerald-300/90"
    : mode === "hybrid"
      ? "ring-amber-400/20 bg-amber-500/10 text-amber-300/90"
      : "ring-white/10 bg-white/5 text-slate-400"
  return { label: mode, cls }
}

// Standardized eligibility badge (#121) — maps the enum to a short friendly label.
// "none" reads as a bare dash (nothing required); "security_clearance" is called out in rose.
function eligibilityDisplay(j: Job): { label: string; cls: string } | null {
  const val = j.eligibility_std as EligibilityStd | null
  if (!val) return null
  const label = ELIGIBILITY_STD_LABELS[val] ?? val
  if (val === "none") return { label, cls: "ring-white/10 bg-white/5 text-slate-500" }
  if (val === "security_clearance") return { label, cls: "ring-rose-400/20 bg-rose-500/10 text-rose-300/90" }
  return { label, cls: "ring-amber-400/20 bg-amber-500/10 text-amber-300/90" }
}

function fitClass(v: string | null): string {
  if (v === "high") return "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20"
  if (v === "medium") return "bg-amber-500/10 text-amber-300 ring-amber-400/20"
  if (v === "low") return "bg-rose-500/10 text-rose-300 ring-rose-400/20"
  return "bg-white/5 text-slate-400 ring-white/10"
}
function SkillChips({ label, skills, tone }: { label: string; skills: string[] | null; tone: "emerald" | "amber" }) {
  const ring = tone === "emerald"
    ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20"
    : "bg-amber-500/10 text-amber-300 ring-amber-400/20"
  return (
    <div className="space-y-1.5">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      {skills && skills.length ? (
        <div className="flex flex-wrap gap-1.5">{skills.map((s) => <span key={s} className={`rounded-md px-2 py-0.5 text-xs ring-1 ${ring}`}>{s}</span>)}</div>
      ) : <span className="text-sm text-slate-600">—</span>}
    </div>
  )
}

const SELECT_CLASS = "bg-slate-900/60 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-slate-200 hover:border-white/20 focus:border-emerald-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 transition-colors motion-reduce:transition-none"
const FILTER_INPUT = "w-full rounded-md border border-white/10 bg-slate-900/60 px-1.5 py-1 text-[11px] text-slate-200 placeholder:text-slate-500 focus:border-emerald-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
// Per-status hex (for coloring native <option>s + the select trigger).
const STATUS_HEX: Record<string, string> = {
  new: "#94a3b8", notified: "#94a3b8", shortlisted: "#6ee7b7", applied: "#7dd3fc",
  interviewing: "#c4b5fd", offer: "#fcd34d", rejected: "#fca5a5", dismissed: "#a1a1aa",
}
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const CHECKBOX_CLASS = "h-4 w-4 cursor-pointer rounded border-white/20 bg-slate-900/60 accent-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
const STATUS_OPTIONS = ["new", "shortlisted", "applied", "interviewing", "offer", "rejected", "dismissed"]
// Filter includes 'notified' (engine-set, not user-settable) so notified jobs can be found.
const STATUS_FILTER_OPTIONS = ["new", "notified", "shortlisted", "applied", "interviewing", "offer", "rejected", "dismissed"]
const WORK_MODE_OPTIONS = [...WORK_MODES]
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: c }))
const ELIGIBILITY_OPTIONS = ELIGIBILITY_STD.map((e) => ({ value: e, label: ELIGIBILITY_STD_LABELS[e] }))

const ANSWER_FIELDS: { key: string; label: string }[] = [
  { key: "summary", label: "Summary / About you" },
  { key: "why_role", label: "Why this role" },
  { key: "relevant_experience", label: "Relevant experience" },
  { key: "salary", label: "Salary expectation" },
  { key: "notice", label: "Notice period" },
  { key: "work_auth", label: "Work authorization" },
  { key: "years", label: "Years of experience" },
]

function JobsPageContent() {
  const router = useRouter()
  const pathname = usePathname()
  const initialSp = useSearchParams()

  const [statuses, setStatuses] = useState<string[]>([])
  const [markets, setMarkets] = useState<string[]>([])
  const [sourceSel, setSourceSel] = useState<string[]>([])
  const [titleSel, setTitleSel] = useState<string[]>([])
  const [companySel, setCompanySel] = useState<string[]>([])
  const [locationSel, setLocationSel] = useState<string[]>([])
  const [workModeSel, setWorkModeSel] = useState<string[]>([])
  const [categorySel, setCategorySel] = useState<string[]>([])
  const [eligibilitySel, setEligibilitySel] = useState<string[]>([])
  const [facets, setFacets] = useState<Facets>({ titles: [], companies: [], locations: [], markets: [], sources: [] })
  const [scoreMin, setScoreMin] = useState<number | null>(null)
  const [scoreMax, setScoreMax] = useState<number | null>(null)
  const [addedWithin, setAddedWithin] = useState("")
  const [postedWithin, setPostedWithin] = useState("")
  const [hasMaterials, setHasMaterials] = useState(false)
  const [qDraft, setQDraft] = useState("") // raw search input value (every keystroke)
  const [q, setQ] = useState("")           // committed value — drives the URL + fetch, debounced from qDraft
  const qCommitted = useRef("")            // mirrors `q`; lets the debounce effect no-op on hydrate + repeats
  const [sorts, setSorts] = useState<SortSpec[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [jobs, setJobs] = useState<Job[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kitJob, setKitJob] = useState<Job | null>(null)
  const [whyJob, setWhyJob] = useState<Job | null>(null)
  const [runs, setRuns] = useState<Record<string, RunInfo | null>>({ score: null, tailor: null })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkStatus, setBulkStatus] = useState("")
  const [bulkBusy, setBulkBusy] = useState(false)
  const [drawerId, setDrawerId] = useState<number | null>(null)
  const prevRunStatus = useRef<Record<string, string | undefined>>({})

  // Hydrate filter/sort/page state from URL on mount (once — empty dep array).
  const hydrated = useRef(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const v = parseJobsView(new URLSearchParams(initialSp.toString()))
    setStatuses(v.statuses)
    setMarkets(v.markets)
    setSourceSel(v.sources)
    setTitleSel(v.titles)
    setCompanySel(v.companies)
    setLocationSel(v.locations)
    setWorkModeSel(v.workModes)
    setCategorySel(v.categories)
    setEligibilitySel(v.eligibilities)
    setScoreMin(v.scoreMin)
    setScoreMax(v.scoreMax)
    setAddedWithin(v.addedWithin)
    setPostedWithin(v.postedWithin)
    setHasMaterials(v.hasMaterials)
    setQDraft(v.q); setQ(v.q); qCommitted.current = v.q
    setSorts(v.sorts)
    setPage(v.page)
    hydrated.current = true
  }, []) // intentionally empty — run once on mount to hydrate from URL

  // Debounce the free-text search: commit qDraft → q (and reset to page 1) 350ms after typing
  // stops. Guarded by qCommitted so the hydrate-triggered qDraft change (URL had ?q=...) doesn't
  // spuriously reset the page that was ALSO deep-linked from the URL.
  useEffect(() => {
    if (!hydrated.current) return
    const t = setTimeout(() => {
      if (qDraft === qCommitted.current) return
      qCommitted.current = qDraft
      setQ(qDraft)
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [qDraft])

  // Reflect filter/sort/page changes into the URL (replace, not push — no history spam).
  useEffect(() => {
    if (!hydrated.current) return // skip the pre-hydrate first render so we don't blank a deep-linked URL
    const qs = buildJobsQuery({ statuses, markets, sources: sourceSel, titles: titleSel, companies: companySel, locations: locationSel, workModes: workModeSel, categories: categorySel, eligibilities: eligibilitySel, scoreMin, scoreMax, addedWithin, postedWithin, hasMaterials, q, sorts, page }).toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [statuses, markets, sourceSel, titleSel, companySel, locationSel, workModeSel, categorySel, eligibilitySel, scoreMin, scoreMax, addedWithin, postedWithin, hasMaterials, q, sorts, page, router, pathname])

  // quiet=true → background refresh WITHOUT tearing down the table:
  // keeps the loading spinner from unmounting rows (which resets scroll) and
  // preserves the current selection. Used after a single-row status change.
  const fetchJobs = useCallback(async (quiet = false) => {
    setError(null)
    if (!quiet) {
      setLoading(true)
      setSelected(new Set()) // selection is scoped to the current view
    }
    const sp = new URLSearchParams()
    sp.set("page", String(page)); sp.set("limit", "50")
    const appendAll = (key: string, vals: string[]) => vals.forEach((v) => sp.append(key, v))
    appendAll("statuses", statuses)
    appendAll("markets", markets)
    appendAll("sources", sourceSel)
    appendAll("titles", titleSel)
    appendAll("companies", companySel)
    appendAll("locations", locationSel)
    appendAll("workModes", workModeSel)
    appendAll("categories", categorySel)
    appendAll("eligibilities", eligibilitySel)
    if (scoreMin != null) sp.set("scoreMin", String(scoreMin))
    if (scoreMax != null) sp.set("scoreMax", String(scoreMax))
    if (addedWithin) sp.set("added", addedWithin)
    if (postedWithin) sp.set("posted", postedWithin)
    if (hasMaterials) sp.set("materials", "ready")
    if (q) sp.set("q", q)
    if (sorts.length) sp.set("sort", sorts.map((s) => `${s.col}:${s.dir}`).join(","))
    try {
      const res = await fetch(`/api/jobs?${sp.toString()}`, { credentials: "include" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setJobs(data.jobs || [])
      setTotal(data.total || 0)
      setFacets(data.facets || { titles: [], companies: [], locations: [], markets: [], sources: [] })
      setTotalPages(data.totalPages || 1)
    } catch (e) {
      console.error("Failed to load jobs", e)
      setError("Failed to load jobs.")
    } finally {
      setLoading(false)
    }
  }, [statuses, markets, sourceSel, titleSel, companySel, locationSel, workModeSel, categorySel, eligibilitySel, scoreMin, scoreMax, addedWithin, postedWithin, hasMaterials, q, sorts, page])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  const cycleSort = (col: SortKey, additive: boolean) => {
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.col === col)
      const cur = idx >= 0 ? prev[idx] : null
      const next: SortSpec | null = !cur ? { col, dir: "desc" } : cur.dir === "desc" ? { col, dir: "asc" } : null // desc→asc→off
      if (additive) {
        const base = prev.filter((s) => s.col !== col)
        return next ? [...base, next] : base
      }
      return next ? [next] : []
    })
    setPage(1)
  }
  const sortState = (col: SortKey) => {
    const i = sorts.findIndex((s) => s.col === col)
    return i < 0 ? null : { dir: sorts[i].dir, rank: sorts.length > 1 ? i + 1 : null }
  }
  const activeFilterCount = [
    statuses.length > 0, markets.length > 0, sourceSel.length > 0,
    titleSel.length > 0, companySel.length > 0, locationSel.length > 0, workModeSel.length > 0,
    categorySel.length > 0, eligibilitySel.length > 0,
    scoreMin != null, scoreMax != null,
    addedWithin, postedWithin, hasMaterials, q,
  ].filter(Boolean).length
  const clearSearch = () => { setQDraft(""); qCommitted.current = ""; setQ("") }
  const clearFilters = () => {
    setStatuses([]); setMarkets([]); setSourceSel([]); setTitleSel([]); setCompanySel([]); setLocationSel([]); setWorkModeSel([])
    setCategorySel([]); setEligibilitySel([])
    setScoreMin(null); setScoreMax(null); setAddedWithin(""); setPostedWithin(""); setHasMaterials(false); clearSearch(); setPage(1)
  }

  const SortableHeader = ({ col, children, className }: { col: SortKey; children: ReactNode; className?: string }) => {
    const st = sortState(col)
    return (
      <button type="button" onClick={(e) => cycleSort(col, e.shiftKey)}
        className={`inline-flex items-center gap-1 hover:text-slate-200 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 rounded motion-reduce:transition-none ${st ? "text-emerald-300" : "text-slate-500"} ${className ?? ""}`}
        title="Click to sort · Shift-click to add to multi-sort">
        {children}
        <span className="text-[9px]">{st ? (st.dir === "asc" ? "▲" : "▼") : "↕"}</span>
        {st?.rank && <span className="rounded bg-emerald-500/25 px-1 text-[8px] tabular-nums text-emerald-200">{st.rank}</span>}
      </button>
    )
  }

  const setStatus = async (id: number, status: string) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status } : j)))
    try {
      await api.patch(`/api/jobs/${id}`, { status })
    } catch (e) {
      console.error(e)
    } finally {
      fetchJobs(true) // quiet refresh: refresh the list but keep scroll + selection
    }
  }

  // ---- on-demand score/tailor runs (queue + poll, same mechanism as discovery) ----
  const fetchRun = useCallback(async (kind: string) => {
    try {
      const res = await fetch(`/api/jobs/discovery/run?kind=${kind}`, { credentials: "include" })
      if (!res.ok) return
      const data = await res.json()
      setRuns((prev) => ({ ...prev, [kind]: data.run ?? null }))
    } catch { /* status is best-effort */ }
  }, [])

  useEffect(() => { fetchRun("score"); fetchRun("tailor") }, [fetchRun])

  const scoreActive = runs.score?.status === "requested" || runs.score?.status === "running"
  const tailorActive = runs.tailor?.status === "requested" || runs.tailor?.status === "running"
  useEffect(() => {
    if (!scoreActive && !tailorActive) return
    const t = setInterval(() => {
      if (scoreActive) fetchRun("score")
      if (tailorActive) fetchRun("tailor")
    }, 3000)
    return () => clearInterval(t)
  }, [scoreActive, tailorActive, fetchRun])

  // When a run finishes, refresh the job list so new scores / materials appear.
  useEffect(() => {
    for (const kind of ["score", "tailor"]) {
      const st = runs[kind]?.status
      const prev = prevRunStatus.current[kind]
      if ((prev === "requested" || prev === "running") && (st === "done" || st === "error")) fetchJobs()
      prevRunStatus.current[kind] = st
    }
  }, [runs, fetchJobs])

  const requestRun = async (kind: string) => {
    try {
      const res = await api.post("/api/jobs/discovery/run", { kind })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRuns((prev) => ({ ...prev, [kind]: data.run ?? null }))
    } catch (e) {
      console.error("queue run failed", e)
      setError("Failed to queue run.")
    }
  }

  // ---- selection + bulk status ----
  const toggleSelect = (id: number) =>
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allOnPageSelected = jobs.length > 0 && jobs.every((j) => selected.has(j.id))
  const toggleSelectAll = () =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (allOnPageSelected) jobs.forEach((j) => n.delete(j.id))
      else jobs.forEach((j) => n.add(j.id))
      return n
    })
  const applyBulk = async () => {
    if (!bulkStatus || selected.size === 0) return
    setBulkBusy(true)
    try {
      const res = await api.patch("/api/jobs", { ids: [...selected], status: bulkStatus })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setBulkStatus("")
      await fetchJobs() // also clears selection
    } catch (e) {
      console.error("bulk update failed", e)
      setError("Bulk update failed.")
    } finally {
      setBulkBusy(false)
    }
  }

  const runStatusText = (kind: string): string => {
    const r = runs[kind]
    if (!r) return ""
    if (r.status === "requested") return "queued…"
    if (r.status === "running") return "running…"
    if (r.status === "done") return r.note || "done"
    if (r.status === "error") return `failed: ${r.error || "unknown"}`
    return r.status
  }

  const fmtDate = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—")
  const daysSince = (d: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Jobs</h1>
          <p className="text-sm text-slate-400">Triage your radar — score, shortlist, tailor.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {(["score", "tailor"] as const).map((kind) => {
            const r = runs[kind]
            const active = r?.status === "requested" || r?.status === "running"
            const Icon = kind === "score" ? Sparkles : Wand2
            return (
              <div key={kind} className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => requestRun(kind)} disabled={active} className="gap-1.5">
                  <Icon className={`h-3.5 w-3.5 ${active ? "animate-pulse" : ""}`} />
                  {active ? (kind === "score" ? "Scoring…" : "Tailoring…") : RUN_LABELS[kind]}
                </Button>
                {runStatusText(kind) && (
                  <span className={`text-xs ${active ? "text-emerald-300" : r?.status === "error" ? "text-rose-300" : "text-slate-400"}`}>{runStatusText(kind)}</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500"><span className="tabular-nums text-slate-300">{total}</span> jobs</span>
          <div className="relative w-64 max-w-full">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <Input
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return
                if (qDraft === qCommitted.current) return
                qCommitted.current = qDraft
                setQ(qDraft)
                setPage(1)
              }}
              placeholder="Search title, skills, tech stack…"
              aria-label="Search jobs by title, skills, or tech stack"
              className="h-7 rounded-lg border-white/10 bg-slate-900/60 pl-8 pr-7 text-xs text-slate-200 placeholder:text-slate-500 focus-visible:ring-emerald-500/60"
            />
            {qDraft && (
              <button type="button" onClick={clearSearch} aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-500 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {activeFilterCount > 0 && (
          <button onClick={clearFilters} className="rounded-lg border border-white/10 bg-slate-900/60 px-2.5 py-1 text-xs text-slate-300 hover:border-white/20">
            Clear filters ({activeFilterCount})
          </button>
        )}
      </div>

      {(() => {
        const chips = activeFilterChips({ statuses, markets, sources: sourceSel, titles: titleSel, companies: companySel, locations: locationSel, workModes: workModeSel, categories: categorySel, eligibilities: eligibilitySel, scoreMin, scoreMax, addedWithin, postedWithin, hasMaterials, q })
        if (!chips.length) return null
        const removeChip = (key: string) => {
          const colonIdx = key.indexOf(":")
          const field = colonIdx >= 0 ? key.slice(0, colonIdx) : key
          const val = colonIdx >= 0 ? key.slice(colonIdx + 1) : ""
          const drop = (arr: string[], set: (v: string[]) => void) => set(arr.filter((x) => x !== val))
          if (field === "statuses") drop(statuses, setStatuses); else if (field === "markets") drop(markets, setMarkets)
          else if (field === "sources") drop(sourceSel, setSourceSel); else if (field === "titles") drop(titleSel, setTitleSel)
          else if (field === "companies") drop(companySel, setCompanySel); else if (field === "locations") drop(locationSel, setLocationSel)
          else if (field === "workModes") drop(workModeSel, setWorkModeSel)
          else if (field === "categories") drop(categorySel, setCategorySel); else if (field === "eligibilities") drop(eligibilitySel, setEligibilitySel)
          else if (key === "scoreMin") setScoreMin(null); else if (key === "scoreMax") setScoreMax(null)
          else if (key === "addedWithin") setAddedWithin(""); else if (key === "postedWithin") setPostedWithin(""); else if (key === "materials") setHasMaterials(false)
          else if (key === "q") clearSearch()
          setPage(1)
        }
        return (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button key={c.key} onClick={() => removeChip(c.key)} aria-label={`Remove filter ${c.label}`}
                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200 hover:bg-emerald-500/20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
                {c.label} <span aria-hidden className="text-emerald-300/70">✕</span>
              </button>
            ))}
          </div>
        )
      })()}

      {selected.size > 0 && (
        <div className="sticky top-2 z-30 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm shadow-lg shadow-emerald-500/5 backdrop-blur">
          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-200">
            <span className="rounded-full bg-emerald-500/30 px-2 py-0.5 tabular-nums">{selected.size}</span> selected
          </span>
          <span className="text-slate-500">·</span>
          <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} className={`${SELECT_CLASS} capitalize`}>
            <option value="">Set status…</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s} style={{ color: STATUS_HEX[s], backgroundColor: "#0f172a" }}>{cap(s)}</option>)}
          </select>
          <Button size="sm" onClick={applyBulk} disabled={!bulkStatus || bulkBusy}>{bulkBusy ? "Applying…" : `Apply to ${selected.size}`}</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {error && !loading && <p className="text-sm text-red-400">{error}</p>}

      <GlassCard className="p-0 overflow-x-auto">
        <Table className="[&_th]:px-2.5 [&_th]:py-2 [&_td]:px-2.5 [&_td]:py-2.5 [&_td]:align-top">
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-transparent sticky top-0 z-20 bg-slate-800/95 backdrop-blur">
              <TableHead className="w-9 pl-3"><input type="checkbox" aria-label="Select all on page" checked={allOnPageSelected} onChange={toggleSelectAll} className={CHECKBOX_CLASS} /></TableHead>
              <TableHead className="w-7 text-[11px] text-slate-600">#</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider"><SortableHeader col="status">Status</SortableHeader></TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider"><SortableHeader col="score">Score</SortableHeader></TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider"><SortableHeader col="title">Title</SortableHeader></TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider"><SortableHeader col="company">Company</SortableHeader></TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider"><SortableHeader col="location">Location</SortableHeader></TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-slate-500">Work</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-slate-500">Eligibility</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider"><SortableHeader col="market">Market</SortableHeader></TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-slate-500">Category</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider"><SortableHeader col="source">Source</SortableHeader></TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider"><SortableHeader col="posted">Posted</SortableHeader></TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider"><SortableHeader col="added">Added</SortableHeader></TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider"><SortableHeader col="materials">Materials</SortableHeader></TableHead>
            </TableRow>
            <TableRow className="border-white/5 hover:bg-transparent sticky top-[34px] z-20 bg-slate-800/95 backdrop-blur">
              <TableHead className="pl-3" /><TableHead />
              <TableHead><MultiSelect label="Status" selected={statuses} onChange={(v) => { setStatuses(v); setPage(1) }} options={STATUS_FILTER_OPTIONS.map((s) => ({ value: s, label: s }))} /></TableHead>
              <TableHead><RangeInput min={scoreMin} max={scoreMax} onChange={(lo, hi) => { setScoreMin(lo); setScoreMax(hi); setPage(1) }} /></TableHead>
              <TableHead><MultiSelect label="Title" selected={titleSel} onChange={(v) => { setTitleSel(v); setPage(1) }} options={facets.titles.map((s) => ({ value: s, label: s }))} /></TableHead>
              <TableHead><MultiSelect label="Company" selected={companySel} onChange={(v) => { setCompanySel(v); setPage(1) }} options={facets.companies.map((s) => ({ value: s, label: s }))} /></TableHead>
              <TableHead><MultiSelect label="Location" selected={locationSel} onChange={(v) => { setLocationSel(v); setPage(1) }} options={facets.locations.map((s) => ({ value: s, label: s }))} /></TableHead>
              <TableHead><MultiSelect label="Work" selected={workModeSel} onChange={(v) => { setWorkModeSel(v); setPage(1) }} options={WORK_MODE_OPTIONS.map((s) => ({ value: s, label: s }))} /></TableHead>
              <TableHead><MultiSelect label="Eligibility" selected={eligibilitySel} onChange={(v) => { setEligibilitySel(v); setPage(1) }} options={ELIGIBILITY_OPTIONS} /></TableHead>
              <TableHead><MultiSelect label="Market" selected={markets} onChange={(v) => { setMarkets(v); setPage(1) }} options={facets.markets.map((s) => ({ value: s, label: s }))} /></TableHead>
              <TableHead><MultiSelect label="Category" selected={categorySel} onChange={(v) => { setCategorySel(v); setPage(1) }} options={CATEGORY_OPTIONS} /></TableHead>
              <TableHead><MultiSelect label="Source" selected={sourceSel} onChange={(v) => { setSourceSel(v); setPage(1) }} options={facets.sources.map((s) => ({ value: s, label: s }))} /></TableHead>
              <TableHead><select value={postedWithin} onChange={(e) => { setPostedWithin(e.target.value); setPage(1) }} className={FILTER_INPUT}><option value="">any</option><option value="7">7d</option><option value="30">30d</option><option value="90">90d</option></select></TableHead>
              <TableHead><select value={addedWithin} onChange={(e) => { setAddedWithin(e.target.value); setPage(1) }} className={FILTER_INPUT}><option value="">any</option><option value="7">7d</option><option value="30">30d</option><option value="90">90d</option></select></TableHead>
              <TableHead><select value={hasMaterials ? "ready" : ""} onChange={(e) => { setHasMaterials(e.target.value === "ready"); setPage(1) }} className={FILTER_INPUT}><option value="">any</option><option value="ready">ready</option></select></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={`sk-${i}`} className="border-white/5 hover:bg-transparent">
                  <TableCell colSpan={15} className="py-2">
                    <div className="h-6 w-full animate-pulse rounded bg-white/5 motion-reduce:animate-none" />
                  </TableCell>
                </TableRow>
              ))
            ) : jobs.length === 0 ? (
              <TableRow className="hover:bg-transparent"><TableCell colSpan={15}>
                <div className="flex flex-col items-center gap-2 py-16 text-center">
                  <Inbox className="h-8 w-8 text-slate-600" />
                  <p className="font-medium text-slate-300">No jobs here</p>
                  <p className="text-sm text-slate-500">Adjust the filters, or run discovery to pull in fresh roles.</p>
                </div>
              </TableCell></TableRow>
            ) : (
              jobs.map((j, i) => (
                <TableRow key={j.id} onClick={() => setDrawerId(j.id)} className={`cursor-pointer border-white/5 ${selected.has(j.id) ? "bg-emerald-500/[0.07] hover:bg-emerald-500/10" : "hover:bg-white/[0.03]"}`}>
                  <TableCell className="pl-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${j.title}`} checked={selected.has(j.id)} onChange={() => toggleSelect(j.id)} className={CHECKBOX_CLASS} />
                  </TableCell>
                  <TableCell className="tabular-nums text-xs text-slate-600">{(page - 1) * 50 + i + 1}</TableCell>
                  <TableCell className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={STATUS_OPTIONS.includes(j.status) ? j.status : ""}
                      onChange={(e) => setStatus(j.id, e.target.value)}
                      className={`${SELECT_CLASS} font-medium capitalize`}
                      style={{ color: STATUS_HEX[j.status] ?? "#e2e8f0" }}
                    >
                      {!STATUS_OPTIONS.includes(j.status) && <option value="" disabled>{cap(j.status)}</option>}
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s} style={{ color: STATUS_HEX[s], backgroundColor: "#0f172a" }}>{cap(s)}</option>)}
                    </select>
                    {(j.status === "applied" || j.status === "interviewing") && daysSince(j.status_changed_at) !== null && (
                      <div className="mt-1 text-[10px] text-slate-400">{daysSince(j.status_changed_at)}d in stage</div>
                    )}
                  </TableCell>
                  <TableCell title={j.score_reason || ""} onClick={(e) => e.stopPropagation()}>
                    {typeof j.score === "number" ? (() => {
                      const t = scoreTier(j.score)
                      return (
                        <button type="button" onClick={() => setWhyJob(j)} aria-label="Why this score?" className="flex w-12 flex-col gap-1 text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60" title="Why this score?">
                          <span className={`inline-flex items-center justify-center rounded-md bg-white/5 px-1.5 py-0.5 text-xs font-bold tabular-nums ring-1 ${t.ring} ${t.text} hover:brightness-125`}>{j.score}</span>
                          <span className="h-1 overflow-hidden rounded-full bg-white/10"><span className={`block h-full ${t.bar}`} style={{ width: `${j.score}%` }} /></span>
                        </button>
                      )
                    })() : <span className="text-slate-600">—</span>}
                  </TableCell>
                  <TableCell className="max-w-[340px]" onClick={(e) => e.stopPropagation()}>
                    <a href={j.url} target="_blank" rel="noreferrer" title={j.title}
                       className="group inline-flex items-start gap-1.5 font-medium text-slate-100 transition-colors hover:text-emerald-300">
                      <span className="line-clamp-2">{j.clean_title || j.title}</span>
                      <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-slate-500 opacity-0 transition-opacity group-hover:opacity-100" />
                    </a>
                    {formatJobSummary(j) && (
                      <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">{formatJobSummary(j)}</div>
                    )}
                    {salaryDisplay(j) && (
                      <div className="mt-0.5 line-clamp-1 text-[11px] text-amber-300/90">💰 {salaryDisplay(j)}</div>
                    )}
                    {j.eligibility && (
                      <span className="mt-1 inline-block rounded px-1 py-0.5 text-[10px] font-medium ring-1 ring-amber-400/20 bg-amber-500/10 text-amber-300/90">{j.eligibility}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-300"><span className="inline-block max-w-[11rem] truncate align-bottom" title={j.company || undefined}>{j.company || "—"}</span></TableCell>
                  <TableCell className="whitespace-nowrap text-slate-400">
                    <span className="inline-block max-w-[8rem] truncate align-bottom text-sm" title={j.location || undefined}>{j.location || "—"}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {(() => {
                      const w = workModeDisplay(j)
                      return w ? (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ring-1 ${w.cls}`}>{w.label}</span>
                      ) : <span className="text-slate-600">—</span>
                    })()}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {(() => {
                      const e = eligibilityDisplay(j)
                      return e ? (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${e.cls}`}>{e.label}</span>
                      ) : <span className="text-slate-600">—</span>
                    })()}
                  </TableCell>
                  <TableCell><span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-white/10 bg-white/5 text-slate-400">{j.market}</span></TableCell>
                  <TableCell className="whitespace-nowrap">
                    {j.category ? (
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-white/10 bg-white/5 text-slate-300">{j.category}</span>
                    ) : <span className="text-slate-600">—</span>}
                  </TableCell>
                  <TableCell className="text-xs text-slate-400">{j.source}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-slate-400" title={fmtDate(j.posted_at)}>{relativeAgo(j.posted_at)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-xs">
                    <div className="text-slate-300">{fmtDate(j.discovered_at)}</div>
                    {daysSince(j.discovered_at) !== null && (
                      <div className="text-[10px] text-slate-400">{daysSince(j.discovered_at) === 0 ? "today" : `${daysSince(j.discovered_at)}d ago`}</div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {j.materials_status === "ready" ? (
                      <span className="inline-flex gap-1.5">
                        {j.cv_pdf && <a href={`/api/jobs/${j.id}/materials/cv`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-300 ring-1 ring-emerald-400/20 hover:bg-emerald-500/20"><FileText className="h-3 w-3" />CV</a>}
                        {j.cover_pdf && <a href={`/api/jobs/${j.id}/materials/cover`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-300 ring-1 ring-emerald-400/20 hover:bg-emerald-500/20"><FileText className="h-3 w-3" />Cover</a>}
                        <button onClick={() => setKitJob(j)} className="inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-white/10">Kit</button>
                      </span>
                    ) : j.materials_status === "error" ? (
                      <span className="text-xs text-rose-400">failed</span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </GlassCard>

      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="tabular-nums text-slate-500">{total} {total === 1 ? "job" : "jobs"}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
          <span className="tabular-nums text-slate-400">Page {page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>

      {kitJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setKitJob(null)}>
          <div className="max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <GlassCard className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Apply kit — {kitJob.title}</h2>
                <Button variant="ghost" size="sm" onClick={() => setKitJob(null)}><X className="h-4 w-4" /></Button>
              </div>
              <div className="flex gap-3 text-sm">
                {kitJob.cv_pdf && <a href={`/api/jobs/${kitJob.id}/materials/cv`} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">CV PDF</a>}
                {kitJob.cover_pdf && <a href={`/api/jobs/${kitJob.id}/materials/cover`} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">Cover PDF</a>}
              </div>
              {ANSWER_FIELDS.map((f) => {
                const val = kitJob.apply_answers?.[f.key] || ""
                return (
                  <div key={f.key} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-slate-400">{f.label}</span>
                      {val && <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(val)}>Copy</Button>}
                    </div>
                    <p className="text-sm whitespace-pre-wrap text-slate-200">{val || "—"}</p>
                  </div>
                )
              })}
            </GlassCard>
          </div>
        </div>
      )}

      {whyJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setWhyJob(null)}>
          <div className="max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <GlassCard className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Why this score — {whyJob.title}</h2>
                <Button variant="ghost" size="sm" onClick={() => setWhyJob(null)}><X className="h-4 w-4" /></Button>
              </div>
              {typeof whyJob.score === "number" && (
                <div className="text-sm text-slate-300"><span className="font-semibold tabular-nums">{whyJob.score}</span>/100 — {whyJob.score_reason || "no reason recorded"}</div>
              )}
              {(whyJob.seniority_fit || whyJob.domain_fit || whyJob.remote_fit) && (
                <div className="flex flex-wrap gap-2">
                  {([["Seniority", whyJob.seniority_fit], ["Domain", whyJob.domain_fit], ["Remote", whyJob.remote_fit]] as const).map(([label, v]) => (
                    <span key={label} className={`rounded-md px-2 py-1 text-xs ring-1 ${fitClass(v)}`}>{label}: {v ?? "—"}</span>
                  ))}
                </div>
              )}
              <SkillChips label="Matched skills" skills={whyJob.matched_skills} tone="emerald" />
              <SkillChips label="Missing skills" skills={whyJob.missing_skills} tone="amber" />
              {!whyJob.seniority_fit && !whyJob.matched_skills?.length && !whyJob.missing_skills?.length && (
                <p className="text-sm text-slate-500">No detailed breakdown yet — rescore to populate.</p>
              )}
            </GlassCard>
          </div>
        </div>
      )}

      <JobDrawer jobId={drawerId} onClose={() => setDrawerId(null)} />
    </div>
  )
}

export default function JobsPage() {
  return (
    <Suspense fallback={null}>
      <JobsPageContent />
    </Suspense>
  )
}
