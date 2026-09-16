import { TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { fmtDec, fmtInt } from "@/lib/format";
import type { DashboardTrendPoint } from "@/api/repositories";

/**
 * TrendChart — hectáreas (barra) + fumigaciones (punto/línea) por
 * semana o mes. Chart a mano (sin librerías externas), consistente con
 * el resto del design system.
 */
export function TrendChart({
  data,
  grain
}: {
  data: DashboardTrendPoint[];
  grain: "week" | "month";
}) {
  const maxHa = Math.max(1, ...data.map((d) => d.ha));
  const maxFum = Math.max(1, ...data.map((d) => d.fumigaciones));

  return (
    <Card data-testid="trend-chart">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="size-4 text-primary" aria-hidden />
          Tendencia {grain === "week" ? "semanal" : "mensual"}
        </CardTitle>
        <CardDescription>
          Barra = hectáreas tratadas · punto = fumigaciones registradas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin datos en el período.
          </p>
        ) : (
          <div className="flex h-56 items-end gap-1">
            {data.map((d) => {
              const haPct = Math.max(2, (d.ha / maxHa) * 100);
              const fumPct = Math.max(2, (d.fumigaciones / maxFum) * 100);
              return (
                <div
                  key={d.bucket}
                  className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
                  title={`${d.bucket} · ${fmtDec(d.ha)} ha · ${fmtInt(d.fumigaciones)} fumigaciones`}
                >
                  <div className="relative flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t-sm bg-primary/80 transition-colors group-hover:bg-primary"
                      style={{ height: `${haPct}%` }}
                    />
                    <span
                      className="absolute left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-chart-3 ring-2 ring-card"
                      style={{ bottom: `${fumPct}%` }}
                      aria-hidden
                    />
                  </div>
                  <span className="w-full truncate text-center text-[9px] text-muted-foreground">
                    {grain === "week" ? d.bucket.slice(5) : d.bucket.slice(0, 7)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
