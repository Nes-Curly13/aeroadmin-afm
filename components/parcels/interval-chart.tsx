import { fmtDate } from "@/lib/format"

/** Intervalos reales entre aplicaciones vs cadencia esperada (dji_fumigation_schedule). */
export function IntervalChart({
  points,
  cadenceDays,
}: {
  points: { date: string; gap: number }[]
  cadenceDays: number
}) {
  if (points.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Se necesitan al menos dos aplicaciones.</p>
  }

  const max = Math.max(cadenceDays, ...points.map((p) => p.gap)) * 1.15
  const target = (cadenceDays / max) * 100

  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex h-40 items-end gap-1.5 border-b border-border pt-2">
        <div
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-chart-2"
          style={{ bottom: `${target}%` }}
          aria-hidden
        >
          <span className="absolute -top-4 right-0 rounded bg-chart-2/10 px-1 font-mono text-[10px] text-chart-2">
            {`cadencia ${cadenceDays} d`}
          </span>
        </div>
        {points.map((p) => {
          const over = p.gap > cadenceDays
          return (
            <div key={p.date} className="group relative flex flex-1 flex-col items-center justify-end">
              <span className="mb-1 font-mono text-[10px] tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                {p.gap}
              </span>
              <div
                className={`w-full rounded-t ${over ? "bg-destructive/70" : "bg-chart-1/80"}`}
                style={{ height: `${Math.max((p.gap / max) * 100, 3)}%` }}
                title={`${fmtDate(p.date)} — ${p.gap} días desde la aplicación anterior`}
              />
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
        <span>{fmtDate(points[0].date)}</span>
        <span>{fmtDate(points[points.length - 1].date)}</span>
      </div>
    </div>
  )
}
