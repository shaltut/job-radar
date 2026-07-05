"use client"

import { useEffect, useState } from "react"
import { GlassCard } from "@/components/ui/glass-card"

interface SkillGap { skill: string; count: number }

export default function SkillsGapPage() {
  const [skills, setSkills] = useState<SkillGap[]>([])
  const [jobCount, setJobCount] = useState(0)
  const [threshold, setThreshold] = useState(70)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetch("/api/jobs/skills-gap")
      .then((r) => r.json())
      .then((d) => {
        if (!active) return
        setSkills(d.skills ?? [])
        setJobCount(d.jobCount ?? 0)
        setThreshold(d.threshold ?? 70)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const max = skills.reduce((m, s) => Math.max(m, s.count), 0) || 1

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Skills gap</h1>
        <p className="text-sm text-slate-400">
          Skills most in demand across {jobCount} inbox {jobCount === 1 ? "job" : "jobs"} scoring ≥ {threshold} that your CV does not list.
        </p>
      </div>
      <GlassCard className="p-5">
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : skills.length === 0 ? (
          <p className="text-sm text-slate-500">No skills gap yet — score some high-fit jobs first.</p>
        ) : (
          <ul className="space-y-2">
            {skills.map((s, i) => (
              <li key={s.skill} className="flex items-center gap-3">
                <span className="w-6 shrink-0 text-right tabular-nums text-xs text-slate-500">{i + 1}</span>
                <span className="w-40 shrink-0 truncate text-sm text-slate-200">{s.skill}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                  <span className="block h-full bg-amber-400" style={{ width: `${(s.count / max) * 100}%` }} />
                </span>
                <span className="w-8 shrink-0 text-right tabular-nums text-xs text-slate-400">{s.count}</span>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  )
}
