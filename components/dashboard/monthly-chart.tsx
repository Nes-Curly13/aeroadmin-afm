import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { fmtInt } from "@/lib/format"

export interface MonthlyBar {
  label: string
  ha: number
  flights: number
}

export function MonthlyChart({ data }: { data: MonthlyBar[] }) {
  const maxHa = Math.max(1, ...data.map((d) => d.ha))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hectáreas tratadas por mes</CardTitle>
        <CardDescription>Últimos {data.length} meses · barra = ha aplicadas, línea = vuelos ejecutados</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex h-56 items-end gap-2">
          {data.map((d) => {
            const h = (d.ha / maxHa) * 100
            const flightsRatio = d.flights / Math.max(1, ...data.map((x) => x.flights))
            return (
              <div key={d.label} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                <span className="tabular font-mono text-[10px] font-semibold text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  {fmtInt(d.ha)}
                </span>
                <div className="relative flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t-sm bg-primary/85 transition-colors group-hover:bg-primary"
                    style={{ height: `${Math.max(2, h)}%` }}
                  />
                  <span
                    className="absolute left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-chart-2 ring-2 ring-card"
                    style={{ bottom: `${Math.max(2, flightsRatio * 100)}%` }}
                    aria-hidden
                  />
                </div>
                <span className="w-full truncate text-center text-[10px] text-muted-foreground">{d.label}</span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
