"use client"
import { useEffect, useRef, useState } from "react"

export function toggleValue(selected: string[], value: string): string[] {
  return selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]
}

export function filterOptions(options: { value: string; label: string }[], term: string): { value: string; label: string }[] {
  const t = term.trim().toLowerCase()
  if (!t) return options
  return options.filter((o) => o.label.toLowerCase().includes(t))
}

export function MultiSelect({ label, options, selected, onChange }: {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])
  const active = selected.length > 0
  const shown = filterOptions(options, term)
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className={`w-full truncate rounded-md border px-2 py-1 text-left text-[11px] transition-colors motion-reduce:transition-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${active ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-white/10 bg-slate-900/60 text-slate-400 hover:border-white/20"}`}>
        {active ? `${label}: ${selected.length}` : label} ▾
      </button>
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-48 overflow-auto rounded-lg border border-white/10 bg-slate-900 p-1 shadow-xl">
          {options.length > 8 && (
            <input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search…"
              className="mb-1 w-full rounded border border-white/10 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-emerald-500/50 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60" />
          )}
          {shown.length === 0 && <div className="px-2 py-1 text-xs text-slate-600">No matches</div>}
          {shown.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-slate-300 hover:bg-white/5">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onChange(toggleValue(selected, o.value))}
                className="h-3.5 w-3.5 rounded border-white/20 bg-slate-900/60 accent-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60" />
              <span className="capitalize">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
