"use client"

export function RangeInput({ min, max, onChange }: {
  min: number | null
  max: number | null
  onChange: (min: number | null, max: number | null) => void
}) {
  const parse = (v: string): number | null => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null }
  const cls = "w-12 rounded-md border bg-slate-900/60 px-1.5 py-1 text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
  const border = (v: number | null) => (v != null ? "border-emerald-500/40" : "border-white/10")
  return (
    <div className="flex items-center gap-1">
      <input type="number" inputMode="numeric" value={min ?? ""} placeholder="min" onChange={(e) => onChange(parse(e.target.value), max)} className={`${cls} ${border(min)}`} />
      <span className="text-[10px] text-slate-600">–</span>
      <input type="number" inputMode="numeric" value={max ?? ""} placeholder="max" onChange={(e) => onChange(min, parse(e.target.value))} className={`${cls} ${border(max)}`} />
    </div>
  )
}
