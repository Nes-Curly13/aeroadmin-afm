import { Droplets, Layers, Plane, User } from "lucide-react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { droneModel } from "@/lib/data"
import { SOURCE_LABEL, fmtDate, fmtDec, fmtHa, fmtLiters, fmtTime } from "@/lib/format"
import type { DjiFlight, DjiFumigation } from "@/lib/types"

const SOURCE_STYLE: Record<string, string> = {
  manual: "border-chart-3/40 bg-chart-3/10 text-chart-3",
  import: "border-chart-2/40 bg-chart-2/10 text-chart-2",
  djiscraper: "border-chart-1/40 bg-chart-1/10 text-chart-1",
}

export function FumigationTimeline({
  fumigations,
  flights,
  cadenceDays,
}: {
  fumigations: DjiFumigation[]
  flights: DjiFlight[]
  cadenceDays: number
}) {
  if (fumigations.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">Sin fumigaciones registradas.</p>
  }

  return (
    <ol className="flex flex-col">
      {fumigations.map((f, i) => {
        const prev = fumigations[i + 1]
        const gap = prev
          ? Math.round((new Date(f.executed_at).getTime() - new Date(prev.executed_at).getTime()) / 86_400_000)
          : null
        const drift = gap === null ? null : gap - cadenceDays
        const sortie = flights.filter((fl) => fl.fumigation_id === f.id)

        return (
          <li key={f.id} className="relative flex gap-4 pb-6 pl-1 last:pb-0">
            <div className="relative flex flex-col items-center">
              <span
                className="mt-1 size-3 shrink-0 rounded-full border-2 border-card bg-primary"
                aria-hidden
              />
              {i < fumigations.length - 1 && <span className="mt-1 w-px flex-1 bg-border" aria-hidden />}
            </div>

            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-sm font-semibold tabular-nums">{fmtDate(f.executed_at)}</p>
                <span className="font-mono text-[11px] text-muted-foreground">{fmtTime(f.executed_at)}</span>
                <Badge variant="outline" className={`text-[10px] font-medium ${SOURCE_STYLE[f.source] ?? ""}`}>
                  {SOURCE_LABEL[f.source] ?? f.source}
                </Badge>
                {/* Sprint 2026-08-05: link a la ficha individual /fumigacion/[id] */}
                <Link
                  href={`/fumigacion/${f.id}`}
                  className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Ver ficha de fumigación #${f.id}`}
                >
                  {`#${f.id}`}
                </Link>
                {gap !== null && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {`${gap} d desde la anterior`}
                    {drift !== null && drift !== 0 && (
                      <span className={drift > 0 ? "text-destructive" : "text-chart-1"}>
                        {` (${drift > 0 ? "+" : ""}${drift} vs cadencia)`}
                      </span>
                    )}
                  </span>
                )}
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Droplets className="size-3.5 text-chart-2" aria-hidden />
                  {`${f.product} · ${fmtLiters(f.volume_l)}`}
                </span>
                <span className="font-mono tabular-nums">{fmtHa(f.area_treated_ha)}</span>
                <span className="inline-flex items-center gap-1.5">
                  <Plane className="size-3.5 text-chart-4" aria-hidden />
                  {`${f.flights_count} vuelos`}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <User className="size-3.5" aria-hidden />
                  {f.operator}
                </span>
                {/*
                  Sprint S9 — badge "multi-parcela" en el timeline del V0.
                  Solo aparece si la fumigación cubrió >1 suerte. El link
                  apunta a la ficha de la fumigación (que ya tiene la
                  card de "Otras suertes cubiertas" con el detalle).
                */}
                {f.n_secondary_parcels && f.n_secondary_parcels > 0 ? (
                  <Link
                    aria-label={`Multi-parcela: cubrió ${f.n_secondary_parcels} suerte${f.n_secondary_parcels === 1 ? "" : "s"} adicional${f.n_secondary_parcels === 1 ? "" : "es"}. Ver detalle.`}
                    className="inline-flex items-center gap-1 rounded-full border border-chart-1/40 bg-chart-1/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-chart-1 hover:bg-chart-1/20"
                    href={`/fumigacion/${f.id}`}
                  >
                    <Layers className="size-3" aria-hidden />
                    {`+${f.n_secondary_parcels} suerte${f.n_secondary_parcels === 1 ? "" : "s"}`}
                  </Link>
                ) : null}
              </div>

              {sortie.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sortie.map((fl) => (
                    <span
                      key={fl.id}
                      className="rounded border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      title={`${fl.pilot} · ${fl.drone_sn}`}
                    >
                      {`${droneModel(fl.drone_model_id).name} · ${fmtDec(fl.duration_min)} min · ${fmtHa(fl.area_ha)}`}
                    </span>
                  ))}
                </div>
              )}

              {f.notes && <p className="mt-2 text-xs italic leading-relaxed text-muted-foreground">{f.notes}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
