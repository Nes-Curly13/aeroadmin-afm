import { Activity, CircleAlert, CircleCheck, CircleX } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { fmtDateTime, fmtInt, fmtRelative } from "@/lib/format"
import type { DjiAgHealth, DjiImportBatch } from "@/lib/types"

const STATUS_UI = {
  ok: { icon: CircleCheck, label: "OK", className: "text-primary" },
  partial: { icon: CircleAlert, label: "Parcial", className: "text-chart-4" },
  error: { icon: CircleX, label: "Error", className: "text-destructive" },
} as const

export function HealthPanel({ health, batches }: { health: DjiAgHealth; batches: DjiImportBatch[] }) {
  const Ui = STATUS_UI[health.status]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4 text-primary" aria-hidden />
          Salud del pipeline DJI AG
        </CardTitle>
        <CardDescription>djiag_health + últimos lotes de dji_import_batches</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-md border border-border bg-muted/50 p-3">
          <Ui.icon className={`size-6 ${Ui.className}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">{`Último run ${Ui.label} · ${fmtRelative(health.last_run_at)}`}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{fmtDateTime(health.last_run_at)}</p>
          </div>
          <Badge variant="outline" className="shrink-0 font-mono">
            {`${(health.duration_ms / 1000).toFixed(1)} s`}
          </Badge>
        </div>

        <dl className="grid grid-cols-2 gap-2">
          {[
            ["Parcelas sincronizadas", fmtInt(health.parcels_synced)],
            ["Vuelos del último run", fmtInt(health.flights_synced)],
            ["Latencia API", `${health.api_latency_ms} ms`],
            ["Próximo run", fmtRelative(health.next_run_at)],
            ["Token expira", fmtRelative(health.token_expires_at)],
            ["Fallos consecutivos", fmtInt(health.consecutive_failures)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-md border border-border px-2.5 py-2">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</dt>
              <dd className="tabular font-mono text-sm font-semibold">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Lotes recientes</p>
          <ul className="divide-y divide-border">
            {batches.slice(0, 5).map((b) => {
              const S = STATUS_UI[b.status]
              return (
                <li key={b.id} className="flex items-start gap-2.5 py-2">
                  <S.icon className={`mt-0.5 size-3.5 shrink-0 ${S.className}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-semibold">{b.id}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {`${fmtDateTime(b.started_at)} · ${b.parcels_upserted} parcelas · ${b.flights_upserted} vuelos · ${b.fumigations_upserted} aplic.`}
                    </p>
                    {b.message && <p className="mt-0.5 text-[11px] text-destructive">{b.message}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}
