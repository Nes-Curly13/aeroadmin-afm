import { CalendarCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { fmtInt } from "@/lib/format";
import type { DashboardPlanCompliance } from "@/api/repositories";

/**
 * PlanCompliance — cumplimiento de la planificación MANUAL: de los
 * planes agendados en el período, cuántos se hicieron. Ata el dashboard
 * con el tablero de planificación.
 */
export function PlanCompliance({
  data
}: {
  data: DashboardPlanCompliance;
}) {
  const total = data.hechas + data.planificadas + data.canceladas;
  const pct = total === 0 ? 0 : Math.round((data.hechas / total) * 100);
  const pendingPct = total === 0 ? 0 : Math.round((data.planificadas / total) * 100);
  const cancelledPct = Math.max(0, 100 - pct - pendingPct);

  return (
    <Card data-testid="plan-compliance">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarCheck className="size-4 text-primary" aria-hidden />
          Cumplimiento de planificación
        </CardTitle>
        <CardDescription>
          Planes agendados en el período que ya se ejecutaron.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin planes agendados en el período.
          </p>
        ) : (
          <>
            <div className="flex items-end justify-between gap-2">
              <span className="tabular font-mono text-3xl font-extrabold leading-none">
                {pct}%
              </span>
              <span className="text-xs text-muted-foreground">
                {fmtInt(data.hechas)} / {fmtInt(total)} hechas
              </span>
            </div>
            <div
              className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`${pct}% hechas, ${pendingPct}% pendientes, ${cancelledPct}% canceladas`}
            >
              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
              <div className="h-full bg-chart-4" style={{ width: `${pendingPct}%` }} />
              <div className="h-full bg-muted-foreground/30" style={{ width: `${cancelledPct}%` }} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-primary" aria-hidden />
                Hechas · {fmtInt(data.hechas)}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-chart-4" aria-hidden />
                Pendientes · {fmtInt(data.planificadas)}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-muted-foreground/30" aria-hidden />
                Canceladas · {fmtInt(data.canceladas)}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
