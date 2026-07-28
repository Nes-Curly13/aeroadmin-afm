import { ArrowUpRight } from "lucide-react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { STATUS_META } from "@/lib/data-constants"
import { fmtDec, fmtRelative } from "@/lib/format"
import type { ComplianceStatus, ParcelSummary } from "@/lib/types"

const ORDER: ComplianceStatus[] = ["al_dia", "por_vencer", "vencido", "critico"]

export function CompliancePanel({ summaries }: { summaries: ParcelSummary[] }) {
  const total = summaries.length
  const counts = ORDER.map((s) => ({ status: s, count: summaries.filter((x) => x.status === s).length }))
  const attention = summaries
    .filter((s) => s.status === "vencido" || s.status === "critico")
    .sort((a, b) => (a.days_to_due ?? 0) - (b.days_to_due ?? 0))
    .slice(0, 6)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cumplimiento de cadencia</CardTitle>
        <CardDescription>
          Comparación entre la cadencia esperada (dji_fumigation_schedule) y la última aplicación registrada
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Distribución de estados de cadencia">
          {counts.map(({ status, count }) => (
            <div
              key={status}
              style={{ width: `${(count / Math.max(1, total)) * 100}%`, backgroundColor: STATUS_META[status].color }}
              title={`${STATUS_META[status].label}: ${count}`}
            />
          ))}
        </div>

        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {counts.map(({ status, count }) => (
            <li key={status} className="flex flex-col gap-0.5 rounded-md border border-border p-2.5">
              <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                <span className="size-2 rounded-full" style={{ backgroundColor: STATUS_META[status].color }} aria-hidden />
                {STATUS_META[status].label}
              </span>
              <span className="tabular font-mono text-lg font-bold leading-tight">{count}</span>
              <span className="text-[10px] text-muted-foreground">{`${Math.round((count / Math.max(1, total)) * 100)}% del portafolio`}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Requieren atención
          </p>
          {attention.length === 0 && <p className="text-sm text-muted-foreground">Todo el portafolio está al día.</p>}
          <ul className="divide-y divide-border">
            {attention.map((s) => (
              <li key={s.parcel.id}>
                <Link
                  href={`/parcelas/${s.parcel.id}`}
                  className="flex items-center gap-3 py-2 transition-colors hover:text-primary"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: STATUS_META[s.status].color }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {s.parcel.name} · {s.parcel.farm_name}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {fmtDec(s.parcel.area_ha)} ha · cadencia {s.schedule.cadence_days} d · última aplicación{" "}
                      {fmtRelative(s.last_fumigation_at)}
                    </span>
                  </span>
                  <span className="tabular shrink-0 font-mono text-xs font-bold text-destructive">
                    {`${Math.abs(s.days_to_due ?? 0)} d vencida`}
                  </span>
                  <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}
