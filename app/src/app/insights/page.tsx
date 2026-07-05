"use client"

import { useEffect, useState } from "react"
import { GlassCard } from "@/components/ui/glass-card"
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts"

interface Funnel { inbox: number; shortlisted: number; applied: number; interviewing: number; offer: number; rejected: number; dismissed: number; total: number }
interface SourceStat { source: string; total: number; shortlisted_plus: number; applied_plus: number }
interface DayCount { day: string; count: number }
interface ScoreDist { excellent: number; strong: number; fair: number; weak: number; unscored: number }
interface StageStat { status: string; n: number; avg_days: number; max_days: number }
interface StaleJob { id: number; title: string; company: string | null; status: string; url: string; days: number }
interface Insights { funnel: Funnel; sources: SourceStat[]; volume: DayCount[]; scores: ScoreDist; timeInStage: { summary: StageStat[]; stalest: StaleJob[] } }

const TOOLTIP = { background: "#0b1120", border: "1px solid #1e293b", borderRadius: 8, color: "#f8fafc" }
const FUNNEL_STAGES: { key: keyof Funnel; label: string; fill: string }[] = [
  { key: "inbox", label: "Inbox", fill: "#94a3b8" },
  { key: "shortlisted", label: "Shortlisted", fill: "#6ee7b7" },
  { key: "applied", label: "Applied", fill: "#7dd3fc" },
  { key: "interviewing", label: "Interviewing", fill: "#c4b5fd" },
  { key: "offer", label: "Offer", fill: "#fcd34d" },
]
const SCORE_TIERS: { key: keyof ScoreDist; label: string; cls: string }[] = [
  { key: "excellent", label: "≥85", cls: "text-emerald-300 ring-emerald-400/30" },
  { key: "strong", label: "70–84", cls: "text-teal-300 ring-teal-400/30" },
  { key: "fair", label: "55–69", cls: "text-amber-300 ring-amber-400/30" },
  { key: "weak", label: "<55", cls: "text-rose-300 ring-rose-400/30" },
  { key: "unscored", label: "Unscored", cls: "text-slate-400 ring-white/10" },
]

export default function InsightsPage() {
  const [data, setData] = useState<Insights | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetch("/api/jobs/insights")
      .then((r) => r.json())
      .then((d) => { if (active && !d.error) setData(d) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  if (loading) return <div className="space-y-4"><h1 className="text-2xl font-semibold">Insights</h1><p className="text-sm text-slate-500">Loading…</p></div>
  if (!data) return <div className="space-y-4"><h1 className="text-2xl font-semibold">Insights</h1><p className="text-sm text-slate-500">No data yet.</p></div>

  const { funnel, sources, volume, scores, timeInStage } = data
  const funnelData = FUNNEL_STAGES.map((s) => ({ name: s.label, value: funnel[s.key], fill: s.fill }))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Insights</h1>
        <p className="text-sm text-slate-400">Where your search stands — {funnel.total} jobs tracked.</p>
      </div>

      <GlassCard>
        <h2 className="mb-1 text-lg font-semibold">Pipeline</h2>
        <p className="mb-3 text-xs text-slate-400">Jobs currently at each stage.</p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funnelData} layout="vertical" margin={{ top: 4, right: 24, left: 24, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis type="number" stroke="#64748b" allowDecimals={false} />
              <YAxis type="category" dataKey="name" stroke="#64748b" width={90} />
              <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "#1e293b55" }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {funnelData.map((d) => <Cell key={d.name} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex gap-4 text-xs text-slate-400">
          <span>Rejected: <span className="text-rose-300">{funnel.rejected}</span></span>
          <span>Dismissed: <span className="text-slate-500">{funnel.dismissed}</span></span>
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="mb-1 text-lg font-semibold">Source effectiveness</h2>
        <p className="mb-3 text-xs text-slate-400">Which sources yield pursuable roles.</p>
        {sources.length === 0 ? <p className="text-sm text-slate-500">No data yet.</p> : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-1 pr-4">Source</th>
                  <th className="py-1 pr-4 text-right">Total</th>
                  <th className="py-1 pr-4 text-right">→Shortlist</th>
                  <th className="py-1 pr-4 text-right">→Applied</th>
                  <th className="py-1 text-right">Yield</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.source} className="border-t border-white/5">
                    <td className="py-1.5 pr-4 text-slate-200">{s.source}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-slate-400">{s.total}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-emerald-300">{s.shortlisted_plus}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-sky-300">{s.applied_plus}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-400">{s.total ? Math.round((s.shortlisted_plus / s.total) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">→Shortlist / →Applied count jobs that reached at least that stage (rejected counted as applied).</p>
          </>
        )}
      </GlassCard>

      <GlassCard>
        <h2 className="mb-1 text-lg font-semibold">Volume &amp; quality</h2>
        <p className="mb-3 text-xs text-slate-400">Jobs added (last 30 days) and score mix.</p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={volume} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id="vol" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="day" stroke="#64748b" tick={{ fontSize: 11 }} />
              <YAxis stroke="#64748b" allowDecimals={false} width={28} />
              <Tooltip contentStyle={TOOLTIP} />
              <Area type="monotone" dataKey="count" stroke="#10b981" fill="url(#vol)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {SCORE_TIERS.map((t) => (
            <span key={t.key} className={`rounded-md bg-white/5 px-2.5 py-1 text-xs ring-1 ${t.cls}`}>{t.label}: <span className="font-semibold tabular-nums">{scores[t.key]}</span></span>
          ))}
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="mb-1 text-lg font-semibold">Time in stage</h2>
        <p className="mb-3 text-xs text-slate-400">How long applied / interviewing jobs have been waiting.</p>
        <div className="mb-3 grid grid-cols-2 gap-3">
          {["applied", "interviewing"].map((st) => {
            const s = timeInStage.summary.find((x) => x.status === st)
            return (
              <div key={st} className="rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
                <div className="text-xs uppercase tracking-wide text-slate-400">{st}</div>
                {s ? <div className="mt-1 text-sm text-slate-200">{s.n} jobs · avg {s.avg_days}d · max {s.max_days}d</div> : <div className="mt-1 text-sm text-slate-600">none</div>}
              </div>
            )
          })}
        </div>
        {timeInStage.stalest.length > 0 && (
          <ul className="space-y-1.5">
            {timeInStage.stalest.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-3 text-sm">
                <a href={j.url} target="_blank" rel="noreferrer" className="truncate text-slate-200 hover:text-emerald-300">{j.title}{j.company ? ` · ${j.company}` : ""}</a>
                <span className="shrink-0 text-xs text-slate-400">{j.status} · {j.days}d</span>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  )
}
