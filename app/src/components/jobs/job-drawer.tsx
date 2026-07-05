"use client"
import { useEffect, useState } from "react"
import { X, ExternalLink } from "lucide-react"
import { formatSalaryUsd } from "@/lib/salary-chip"

export function JobDrawer({ jobId, onClose }: { jobId: number | null; onClose: () => void }) {
  const [job, setJob] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (jobId == null) { setJob(null); return }
    setLoading(true)
    fetch(`/api/jobs/${jobId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setJob(d?.job ?? null)).catch(() => setJob(null)).finally(() => setLoading(false))
  }, [jobId])
  useEffect(() => {
    if (jobId == null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [jobId, onClose])
  if (jobId == null) return null
  const chips = (arr: string[] | null, tone = "emerald") => (Array.isArray(arr) && arr.length ? (
    <div className="flex flex-wrap gap-1.5">{arr.map((s) => <span key={s} className={`rounded-md px-2 py-0.5 text-xs ring-1 ${tone === "emerald" ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20" : "bg-amber-500/10 text-amber-300 ring-amber-400/20"}`}>{s}</span>)}</div>
  ) : null)
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Job details">
      <div className="absolute inset-0 bg-black/50 motion-reduce:transition-none" onClick={onClose} />
      <aside className="relative h-full w-full max-w-[480px] overflow-y-auto border-l border-white/10 bg-slate-950 p-5 shadow-2xl">
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded p-1 text-slate-400 hover:text-slate-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"><X className="h-4 w-4" /></button>
        {loading && <div className="h-6 w-2/3 animate-pulse rounded bg-white/5 motion-reduce:animate-none" />}
        {job && (
          <div className="space-y-4 pr-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">{job.clean_title || job.title}</h2>
              {job.clean_title && job.title !== job.clean_title && <p className="text-xs text-slate-500">{job.title}</p>}
              <p className="text-sm text-slate-400">{job.company || "—"}{job.location ? ` · ${job.location}` : ""}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-400">
              {typeof job.score === "number" && <span className="rounded bg-white/5 px-2 py-0.5 ring-1 ring-white/10">Score {job.score}</span>}
              {job.work_mode && <span className="rounded bg-white/5 px-2 py-0.5 ring-1 ring-white/10">{job.work_mode}</span>}
              <span className="rounded bg-white/5 px-2 py-0.5 ring-1 ring-white/10 uppercase">{job.market}</span>
              <span className="rounded bg-white/5 px-2 py-0.5 ring-1 ring-white/10">{job.source}</span>
            </div>
            {job.eligibility && <div className="rounded px-2 py-1 text-xs ring-1 ring-amber-400/20 bg-amber-500/10 text-amber-300/90 inline-block">{job.eligibility}</div>}
            {job.score_reason && <p className="text-sm text-slate-300">{job.score_reason}</p>}
            {chips(job.tech_stack)}
            {(job.matched_skills?.length || job.missing_skills?.length) ? (
              <div className="space-y-1.5">
                {chips(job.matched_skills)}
                {chips(job.missing_skills, "amber")}
              </div>
            ) : null}
            {(() => {
              const usd = formatSalaryUsd(job)
              if (!usd && !job.salary_range) return null
              return (
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Salary</div>
                  <div className="mt-1 text-base font-semibold text-amber-300">
                    {usd || `${job.salary_source === "estimated" ? "~" : ""}${job.salary_range}`}
                    {(job.salary_source === "estimated" || job.salary_source === "listed") && (
                      <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-white/10 bg-white/5 text-slate-400">{job.salary_source === "estimated" ? "estimated" : "listed"}</span>
                    )}
                  </div>
                  {job.salary_ask && <div className="mt-1 text-sm text-slate-300">Suggested ask: <span className="text-slate-100">{job.salary_ask}</span></div>}
                </div>
              )
            })()}
            <a href={job.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-emerald-300 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 rounded">Open original <ExternalLink className="h-3.5 w-3.5" /></a>
            {job.description && <div className="whitespace-pre-wrap border-t border-white/10 pt-3 text-sm leading-relaxed text-slate-300">{job.description}</div>}
          </div>
        )}
      </aside>
    </div>
  )
}
