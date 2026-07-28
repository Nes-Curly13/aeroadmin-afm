// components/dashboard/compliance-panel.tsx
//
// Sprint S6 (V0 port v2) — Panel de cumplimiento de cadencia de fumigación.
// Port 1:1 del mockup V0 (`docs/fumigation-management-dashboard/components/
// dashboard/compliance-panel.tsx`) al proyecto real, con adaptación del
// shape de datos.
//
// Decisiones de adaptación:
//
//   1. INPUTS — el V0 usaba `ParcelSummary[]` (con parcel, schedule,
//      status, days_to_due). El proyecto tiene `OverdueParcel[]` (con
//      parcel_id, land_name, external_id, recommended_cadence_days,
//      days_until_next_due, severity). La forma es similar pero no
//      idéntica — adaptamos los accesos a campos.
//
//   2. STATUS MAPPING — el V0 usaba `STATUS_META` (en `lib/data.ts`)
//      con 4 etiquetas: "al_dia" | "por_vencer" | "vencido" | "critico".
//      El proyecto ya tiene `CADENCE_STATUS_META` y
//      `CADENCE_STATUS_ORDER` en `lib/map-filter-types.ts` con esas
//      mismas 4 etiquetas + mapping `internal` para vincular con la
//      `severity` de `OverdueParcel`. Reutilizamos los del proyecto
//      para mantener coherencia con el resto de la app (mapa, filtros).
//
//      El helper `severityToCadenceStatus` (exportado) traduce la
//      `severity` interna ("overdue"|"due_soon"|"ok"|"no_history") a
//      la etiqueta de UI ("vencido"|"por_vencer"|"al_dia"|"critico").
//      Ya existía en la versión previa — se preserva.
//
//   3. STRUCTURE — el V0 tiene:
//      - Stacked bar (proporción por status, role="img")
//      - 4 cards (uno por status) con count + % del portafolio
//      - Lista "Requieren atención" (top 6, ordenado por days_to_due ASC)
//
//      Mantenemos las 3 secciones con el mismo shape visual. El
//      stacked bar y los 4 cards usan el `CADENCE_STATUS_ORDER` del
//      proyecto (orden canónico, más urgente primero) para mantener
//      coherencia con el resto del UI. El V0 usaba
//      ["al_dia","por_vencer","vencido","critico"] (menos urgente
//      primero); preservamos el orden canónico del proyecto porque
//      ya está alineado con el filtro del mapa y la cadencia de UI.
//
//   4. CARD / BADGE — el V0 usa `<Card>`, etc. El proyecto tiene el
//      primitive. No necesitamos Badge en este componente.
//
//   5. LINK ROUTE — V0: `/parcelas/${s.parcel.id}`. Proyecto:
//      `/parcels/${s.parcel_id}` (ruta real del proyecto).
//
//   6. SIN HISTORIAL — el V0 no diferenciaba "vencido" vs "crítico con
//      sin historial" (siempre decía "X d vencida" con X=0 si era null).
//      El proyecto SÍ diferencia: si `days_until_next_due` es null
//      (severity=no_history), mostramos "Sin historial" en lugar de
//      "0 d vencida". Este fue un cambio que el operador fumigador
//      pidió en el sprint S6 para no confundir "vencido" con
//      "nunca fumigado".
//
// Accesibilidad:
//   - Stacked bar tiene `role="img"` + `aria-label` con total de parcelas.
//   - 4 cards tienen `data-status` para styling compuesto (no se usa hoy
//     pero está disponible para que un caller pueda aplicar estilos por
//     estado).
//   - Lista de atención: `data-testid="compliance-attention"` para tests
//     y `data-testid="compliance-link-{parcel_id}"` en cada link.
//   - `data-slot="compliance-panel"` en el Card raíz.

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
 * Exportada para tests y para que otros componentes (chips, badges)
 * puedan reutilizar la misma traducción sin reinventar el mapping.
 */
export function severityToCadenceStatus(severity: OverdueParcel["severity"]): CadenceStatus {
  for (const status of CADENCE_STATUS_ORDER) {
    if (CADENCE_STATUS_META[status].internal === severity) return status;
  }
  // Fallback defensivo: si OverdueParcel agrega un severity nuevo que
  // aún no está mapeado en CADENCE_STATUS_META, lo tratamos como "al_dia"
  // (el menos alarmante) en lugar de tirar.
  return "al_dia";
}

// ---------------------------------------------------------------------------
// Helpers locales (espejo del V0 `lib/format.ts`).
// ---------------------------------------------------------------------------

/** Formato decimal a 1 dígito, locale es-CO (espejo de `fmtDec` V0). */
function fmtDec(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(n);
}

/** "hace 5 min" / "hace 3 h" / "hace 12 días" / "hace 2 meses" en es-CO. */
function fmtRelative(iso: string | null): string {
  if (!iso) return "sin registro";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "sin registro";
  const diffMs = Date.now() - then.getTime();
  const abs = Math.abs(diffMs);
  const future = diffMs < 0;
  const minutes = Math.floor(abs / 60_000);
  if (minutes < 1) return "justo ahora";
  if (minutes < 60) return future ? `en ${minutes} min` : `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return future ? `en ${hours} h` : `hace ${hours} h`;
  const days = Math.round(abs / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat("es-CO", { numeric: "auto" });
  return rtf.format(future ? days : -days, "day");
}

export function CompliancePanel({ summaries }: CompliancePanelProps) {
  const total = summaries.length;

  // Counts por CadenceStatus (orden canónico del proyecto: más urgente primero).
  const counts = CADENCE_STATUS_ORDER.map((status) => {
    const count = summaries.filter((s) => severityToCadenceStatus(s.severity) === status).length;
    return { status, count, meta: CADENCE_STATUS_META[status] };
  });

  // Top N parcelas que requieren atención (overdue + no_history).
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
    <Card data-slot="compliance-panel">
      <CardHeader>
        <CardTitle>Cumplimiento de cadencia</CardTitle>
        <CardDescription>
          Comparación entre la cadencia esperada (dji_fumigation_schedule) y la última aplicación registrada
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
                        <span className="block truncate text-sm font-semibold">{parcelLabel}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {s.area_fumigable_ha !== null
                            ? `${fmtDec(s.area_fumigable_ha)} ha · `
                            : ""}
                          cadencia {s.recommended_cadence_days} d
                          {s.last_fumigation_date
                            ? ` · última aplicación ${fmtRelative(s.last_fumigation_date)}`
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
      </CardContent>
    </Card>
  );
}
