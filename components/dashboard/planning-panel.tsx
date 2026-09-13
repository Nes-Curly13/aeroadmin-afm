import Link from "next/link";
import { AlertTriangle, CalendarClock, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate } from "@/lib/format";
import { severityLabel, type OverdueSeverity } from "@/lib/overdue-parcels";
import type { OverdueParcel } from "@/lib/types";

/**
 * PlanningPanel — vista de planificación del dashboard (OE2).
 *
 * Fase 6 (2026-09-08) había removido el `CompliancePanel` porque la regla
 * de negocio de "vencido" no estaba ratificada. Se ratifica acá: la regla
 * vive en `lib/fumigation-cadence.ts` / `lib/overdue-parcels.ts`
 * (en fecha > 7 d · vence pronto 0-7 d · vencida < 0 d · sin historial),
 * y este panel la hace visible al operador para que planifique la semana.
 *
 * Server component presentacional: recibe `items` por props (el page los
 * trae de `fetchOverdueParcelsCached`). No importa `api/**` ni `lib/db`.
 */
export interface PlanningPanelProps {
  items: OverdueParcel[];
  /** Cuántos items mostrar antes del "ver todas". Default 8. */
  limit?: number;
}

const SEVERITY_ICON: Record<OverdueSeverity, typeof AlertTriangle> = {
  overdue: AlertTriangle,
  due_soon: Clock,
  ok: Clock,
  no_history: Clock
};

const SEVERITY_BADGE: Record<OverdueSeverity, string> = {
  overdue: "border-destructive/40 bg-destructive/5 text-destructive",
  due_soon: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300",
  ok: "border-chart-1/40 bg-chart-1/5 text-chart-1",
  no_history: "border-input bg-background text-muted-foreground"
};

export function PlanningPanel({ items, limit = 8 }: PlanningPanelProps) {
  const overdue = items.filter((i) => i.severity === "overdue");
  const dueSoon = items.filter((i) => i.severity === "due_soon");
  const shown = items.slice(0, limit);

  return (
    <Card data-testid="planning-panel">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4 text-primary" aria-hidden />
          Planificación de fumigación
        </CardTitle>
        <CardDescription>
          Parcelas vencidas o por vencer según su cadencia. Regla: en fecha (&gt;7 días),
          vence pronto (0-7 días), vencida (atraso).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin parcelas pendientes. Todo al día.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className={SEVERITY_BADGE.overdue}>
                {overdue.length} vencida{overdue.length === 1 ? "" : "s"}
              </Badge>
              <Badge variant="outline" className={SEVERITY_BADGE.due_soon}>
                {dueSoon.length} por vencer
              </Badge>
            </div>
            <ul className="flex flex-col divide-y divide-border/40">
              {shown.map((p) => {
                const Icon = SEVERITY_ICON[p.severity];
                return (
                  <li key={p.parcel_id} className="flex items-center justify-between gap-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <Link
                        href={`/parcelas/${p.parcel_id}`}
                        className="truncate text-sm font-medium hover:text-primary"
                      >
                        {p.land_name ?? `Parcela #${p.parcel_id}`}
                      </Link>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {p.next_due_date ? (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {fmtDate(p.next_due_date)}
                        </span>
                      ) : null}
                      <Badge variant="outline" className={`text-[10px] ${SEVERITY_BADGE[p.severity]}`}>
                        {severityLabel(p.severity)}
                      </Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
            {items.length > shown.length ? (
              <Link href="/parcelas" className="text-xs font-medium text-primary hover:underline">
                Ver las {items.length} parcelas pendientes →
              </Link>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
