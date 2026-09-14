import Link from "next/link";
import { AlertTriangle, CalendarClock, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { applicationStatusChipClass, applicationStatusLabel } from "@/lib/phase-applications";
import type { PhasePlanningItem } from "@/lib/phase-applications";

/**
 * PlanningPanel — planificación fitosanitaria por FASE (OE2, MVP 2026-09-13).
 *
 * Reemplaza el panel por cadencia fija (14 d). Muestra las parcelas con
 * ciclo activo que tienen aplicaciones **pendientes o vencidas** según la
 * fase del cultivo (`phase_application_rules`).
 *
 * Server component presentacional: recibe `items` por props (el page los
 * trae de `getPhasePlanningOverview`). No importa `lib/db`.
 */
export interface PlanningPanelProps {
  items: PhasePlanningItem[];
  limit?: number;
}

const PHASE_LABEL: Record<string, string> = {
  establecimiento: "Establecimiento",
  vegetativa: "Crecimiento",
  madurante: "Maduración",
  cosecha: "Cosecha"
};

const CATEGORY_LABEL: Record<string, string> = {
  herbicida: "Herbicida",
  insecticida: "Insecticida",
  fungicida: "Fungicida",
  fertilizante: "Fertilizante",
  acaricida: "Acaricida",
  nematicida: "Nematicida",
  otro: "Otro"
};

const TYPE_LABEL: Record<string, string> = {
  pre_emergente: "Pre-emergente",
  post_emergente: "Post-emergente",
  bioestimulante: "Bioestimulante",
  madurante: "Madurante"
};

function appLabel(item: PhasePlanningItem): string {
  const next = item.nextApplication;
  if (!next) return "—";
  const cat = CATEGORY_LABEL[next.category_slug] ?? next.category_slug;
  const type = next.application_type_slug
    ? TYPE_LABEL[next.application_type_slug] ?? next.application_type_slug
    : null;
  return type ? `${cat} · ${type}` : cat;
}

export function PlanningPanel({ items, limit = 8 }: PlanningPanelProps) {
  const totalOverdue = items.reduce((a, i) => a + i.overdue, 0);
  const totalPending = items.reduce((a, i) => a + i.pending, 0);
  const shown = items.slice(0, limit);

  return (
    <Card data-testid="planning-panel">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4 text-primary" aria-hidden />
          Planificación fitosanitaria
        </CardTitle>
        <CardDescription>
          Parcelas con aplicaciones pendientes o vencidas según la fase del cultivo.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin aplicaciones pendientes. Todo al día.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className={applicationStatusChipClass("vencida")}>
                {totalOverdue} vencida{totalOverdue === 1 ? "" : "s"}
              </Badge>
              <Badge variant="outline" className={applicationStatusChipClass("pendiente")}>
                {totalPending} pendiente{totalPending === 1 ? "" : "s"}
              </Badge>
              <span className="text-muted-foreground">
                en {items.length} parcela{items.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="flex flex-col divide-y divide-border/40">
              {shown.map((p) => {
                const Icon = p.overdue > 0 ? AlertTriangle : Clock;
                const status = p.overdue > 0 ? "vencida" : "pendiente";
                return (
                  <li key={p.parcel_id} className="flex items-center justify-between gap-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0">
                        <Link
                          href={`/parcelas/${p.parcel_id}`}
                          className="block truncate text-sm font-medium hover:text-primary"
                        >
                          {p.land_name ?? `Parcela #${p.parcel_id}`}
                        </Link>
                        <span
                          data-testid="planning-item-meta"
                          className="text-[11px] text-muted-foreground"
                        >
                          {PHASE_LABEL[p.phase] ?? p.phase} · {p.age_days} d · {appLabel(p)}
                        </span>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`shrink-0 text-[10px] ${applicationStatusChipClass(status)}`}
                    >
                      {applicationStatusLabel(status)}
                    </Badge>
                  </li>
                );
              })}
            </ul>
            {items.length > shown.length ? (
              <Link href="/parcelas" className="text-xs font-medium text-primary hover:underline">
                Ver las {items.length} parcelas →
              </Link>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
