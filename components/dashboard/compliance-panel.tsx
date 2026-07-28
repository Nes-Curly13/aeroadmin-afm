// components/dashboard/compliance-panel.tsx
//
// Sprint S6 (V0 port) — Panel de cumplimiento de cadencia de fumigación.
// Adaptado del mockup V0 (docs/fumigation-management-dashboard/components/
// dashboard/compliance-panel.tsx) al proyecto real.
//
// Decisiones de adaptación:
//
//   1. INPUTS:
//      V0 usaba `ParcelSummary[]` (con parcel, schedule, status, days_to_due).
//      El proyecto real no tiene `ParcelSummary` — la forma más cercana
//      es `OverdueParcel[]` (de `lib/types.ts`), que ya agrega:
//        parcel_id, land_name, external_id, crop_type, recommended_cadence_days,
//        last_fumigation_date, days_until_next_due, severity
//        ("overdue" | "due_soon" | "ok" | "no_history")
//      Por eso `summaries: OverdueParcel[]`.
//
//   2. STATUS MAPPING:
//      V0 usaba "al_dia" / "por_vencer" / "vencido" / "critico".
//      El proyecto ya tiene `CadenceStatus` con esas 4 etiquetas exactas
//      (en `lib/map-filter-types.ts`) + `CADENCE_STATUS_META` con label y
//      color. Las reutilizamos para mantener coherencia con el filtro del
//      mapa. El mapping severity → CadenceStatus se hace adentro:
//
//        overdue    → vencido
//        due_soon   → por_vencer
//        ok         → al_dia
//        no_history → critico
//
//      Exportamos `severityToCadenceStatus` para que sea testeable.
//
//   3. STRUCTURE vs V0:
//      - Stacked bar (proporción por status) — preservado, con role="img".
//      - 4 cards (una por status) con count y % — preservado.
//      - Lista "Requieren atención" — top 6 parcelas con severity
//        `overdue` o `no_history`, ordenadas por `days_until_next_due`
//        ascendente (las más atrasadas primero). El V0 usaba el mismo
//        criterio. Enlace a `/parcels/[id]` (ruta real del proyecto, no
//        `/parcelas/` del V0).
//
//   4. CARD / BADGE / TABLE: no usados — solo divs + Tailwind.

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import {
  CADENCE_STATUS_META,
  CADENCE_STATUS_ORDER,
  type CadenceStatus
} from "@/lib/map-filter-types";
import type { OverdueParcel } from "@/lib/types";

export interface CompliancePanelProps {
  /**
   * Lista agregada de parcelas con su cadencia y severidad.
   * El caller (page o wrapper) se encarga de aplicar filtros / orden
   * upstream. Acá agrupamos por `severity` mapeada a `CadenceStatus`.
   */
  summaries: OverdueParcel[];
}

/**
 * Mapea el `severity` interno de `OverdueParcel` a la etiqueta de UI
 * `CadenceStatus` que usa el resto del proyecto (mapa, filtros).
 *
 * Exportada para tests y para que otros componentes (chips, badges) puedan
 * reutilizar la misma traducción sin reinventar el mapping.
 */
export function severityToCadenceStatus(
  severity: OverdueParcel["severity"]
): CadenceStatus {
  for (const status of CADENCE_STATUS_ORDER) {
    if (CADENCE_STATUS_META[status].internal === severity) return status;
  }
  // Fallback defensivo: si OverdueParcel agrega un severity nuevo que
  // aún no está mapeado en CADENCE_STATUS_META, lo tratamos como "al_dia"
  // (el menos alarmante) en lugar de tirar.
  return "al_dia";
}

export function CompliancePanel({ summaries }: CompliancePanelProps) {
  const total = summaries.length;

  // Counts por CadenceStatus (orden canónico, más urgente primero).
  const counts = CADENCE_STATUS_ORDER.map((status) => {
    const count = summaries.filter(
      (s) => severityToCadenceStatus(s.severity) === status
    ).length;
    return { status, count, meta: CADENCE_STATUS_META[status] };
  });

  // Top N parcelas que requieren atención (vencidas o sin historial).
  // Orden: days_until_next_due ascendente (más negativo = más atrasado).
  // null days_until_next_due (no_history) va al final.
  const attention = [...summaries]
    .filter((s) => s.severity === "overdue" || s.severity === "no_history")
    .sort((a, b) => {
      const ad = a.days_until_next_due ?? Number.POSITIVE_INFINITY;
      const bd = b.days_until_next_due ?? Number.POSITIVE_INFINITY;
      return ad - bd;
    })
    .slice(0, 6);

  return (
    <div
      className="rounded-md border border-border bg-card p-4"
      data-slot="compliance-panel"
    >
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Cumplimiento de cadencia</h3>
        <p className="text-[11px] text-muted-foreground">
          Comparación entre la cadencia esperada (dji_fumigation_schedule) y la última aplicación registrada
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {/* Stacked bar: proporción por status. role="img" + aria-label. */}
        <div
          aria-label={`Distribución de estados de cadencia sobre ${total} parcelas`}
          className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
          data-testid="compliance-stacked-bar"
          role="img"
        >
          {counts.map(({ status, count }) => (
            <div
              data-status={status}
              key={status}
              style={{
                width: `${(count / Math.max(1, total)) * 100}%`,
                backgroundColor: CADENCE_STATUS_META[status].color
              }}
              title={`${CADENCE_STATUS_META[status].label}: ${count}`}
            />
          ))}
        </div>

        {/* 4 cards: count + label + % del portafolio. */}
        <ul
          aria-label="Conteo por estado de cadencia"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          data-testid="compliance-counts"
        >
          {counts.map(({ status, count, meta }) => (
            <li
              className="flex flex-col gap-0.5 rounded-md border border-border p-2.5"
              data-status={status}
              key={status}
            >
              <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: meta.color }}
                />
                {meta.label}
              </span>
              <span
                className="font-mono text-lg font-bold leading-tight tabular-nums"
                data-testid={`compliance-count-${status}`}
              >
                {count}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {`${Math.round((count / Math.max(1, total)) * 100)}% del portafolio`}
              </span>
            </li>
          ))}
        </ul>

        {/* Lista "Requieren atención". */}
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Requieren atención
          </p>
          {attention.length === 0 ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="compliance-attention-empty"
            >
              Todo el portafolio está al día.
            </p>
          ) : (
            <ul className="divide-y divide-border" data-testid="compliance-attention">
              {attention.map((s) => {
                const cadStatus = severityToCadenceStatus(s.severity);
                const daysLate =
                  s.days_until_next_due !== null ? Math.abs(s.days_until_next_due) : null;
                const parcelLabel = s.land_name || s.external_id;
                return (
                  <li key={s.parcel_id}>
                    <Link
                      className="flex items-center gap-3 py-2 transition-colors hover:text-primary"
                      data-testid={`compliance-link-${s.parcel_id}`}
                      href={`/parcels/${s.parcel_id}`}
                    >
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: CADENCE_STATUS_META[cadStatus].color }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {parcelLabel}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {s.area_fumigable_ha !== null
                            ? `${s.area_fumigable_ha.toFixed(1)} ha · `
                            : ""}
                          cadencia {s.recommended_cadence_days} d
                          {s.last_fumigation_date
                            ? ` · última aplicación ${s.last_fumigation_date}`
                            : " · sin historial"}
                        </span>
                      </span>
                      <span
                        className="shrink-0 font-mono text-xs font-bold text-destructive tabular-nums"
                        data-testid={`compliance-days-late-${s.parcel_id}`}
                      >
                        {daysLate !== null ? `${daysLate} d vencida` : "Sin historial"}
                      </span>
                      <ArrowUpRight
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
