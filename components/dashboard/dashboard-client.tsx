"use client";

import { useState } from "react";

import { AlertsPanelPaginated } from "@/components/dashboard/alerts-panel-paginated";
import { OperationsPanel } from "@/components/dashboard/operations-panel";
import { TodayYesterdayCard } from "@/components/dashboard/today-yesterday-card";
import { UpcomingFumigations } from "@/components/dashboard/upcoming-fumigations";
import { BentoCard, BentoGrid } from "@/components/ui/bento-grid";
import { MetricCard } from "@/components/ui/metric-card";
import { formatArea, formatNumber } from "@/lib/format";
import { getDashboardKpiTone } from "@/lib/ui-tokens";
import type {
  AlertLevel,
  DashboardMetrics,
  DjiAlertRecord,
  DjiDailySummaryRecord,
  DjiParcelRecord,
  UpcomingFumigation
} from "@/lib/types";
import type { ActivityComparison } from "@/lib/cache";

// Iconos inline (eran locales en app/page.tsx antes del bento refactor).
// Los mantenemos en este client component para no contaminar el page.tsx
// con SVG que solo se usan acá.

function CompassIcon() {
  return (
    <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
      <path
        d="M14.85 9.15 9 15l6.45-2.15L17.6 6.4 14.85 9.15Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function AreaIcon() {
  return (
    <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
      <path
        d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="M12 3v18M4 7.5l8 4.5 8-4.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
      <path
        d="M12 8v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92A2 2 0 0 0 22.18 18L13.71 3.86a2 2 0 0 0-3.42 0Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function DroneIcon() {
  return (
    <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
      <path
        d="M3 8h4M17 8h4M3 16h4M17 16h4M7 12h10M12 5v3M12 16v3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function OverdueIcon() {
  return (
    <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 7v5l3 2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export interface DashboardClientProps {
  metrics: DashboardMetrics;
  alerts: DjiAlertRecord[];
  flights: DjiDailySummaryRecord[];
  parcels: DjiParcelRecord[];
  upcoming: UpcomingFumigation[];
  overdueCount: number;
  /** Sprint A — F4.0: comparativa ayer/hoy para el card superior. */
  activityComparison: ActivityComparison;
}

/**
 * Wrapper client del dashboard bento (sprint v1.7 — Track A).
 *
 * Por qué es client y no server:
 *   - El `alertFilter` (HIGH / MEDIUM / LOW / ALL) lo comparten los
 *     botones del `<AlertsPanel>` (dentro de `AlertsPanelPaginated`)
 *     y la lista de vuelos recientes (`<RecentFlightsList>` dentro
 *     de `OperationsPanel`). Antes (pre-v1.7) los dos vivían en el
 *     mismo árbol de `<OperationsPanel>` y el state se mantenía con
 *     `useState` interno. Ahora son dos cards separados en el
 *     `BentoGrid`, así que el state se levanta a este componente.
 *
 * Layout del BentoGrid (xl = 12 cols, lg = 4, sm = 2, mobile = 1):
 *   Fila 1 (KPIs, 12 cols):
 *     - 3 cards colSpan=2: Registros, Área, Activos (info, baja urgencia)
 *     - 2 cards colSpan=3: Alertas Altas, Atrasadas por cadencia (danger)
 *     Total: 6 + 6 = 12. La distribución "2+3" en lugar de 5×3 (=15)
 *     resuelve el problema del spec ("5×3 no entra limpio en 12")
 *     manteniendo los KPIs urgentes con mayor peso visual.
 *
 *   Filas 2-3 (12 cols × 2 rows):
 *     - UpcomingFumigations: colSpan=6, rowSpan=2 (lista scrollable 320px)
 *     - AlertsPanelPaginated: colSpan=6, rowSpan=2 (paginada, 5/página)
 *
 *   Fila 4 (12 cols, 1 row):
 *     - OperationsPanel: colSpan=12, full-width (summary + sync + flights)
 *
 * Nota sobre padding: el `BentoCard` aporta `p-5` (20px) y cada
 * sección del OperationsPanel tiene su propio `p-6` (24px). El
 * resultado es 20+24=44px desde el borde del BentoCard al contenido
 * de la primera sección. Es deliberado — el BentoCard provee el
 * frame exterior y cada sección conserva su padding propio. Si en
 * una iteración futura se quiere reducir, refactorizar las secciones
 * internas para que NO traigan su propio padding y dependan del p-5
 * del BentoCard.
 */
export function DashboardClient({
  metrics,
  alerts,
  flights,
  parcels,
  upcoming,
  overdueCount,
  activityComparison
}: DashboardClientProps) {
  // Estado compartido entre AlertsPanel (filtra alerts) y
  // RecentFlightsList (filtra vuelos por nivel de alerta derivado).
  const [alertFilter, setAlertFilter] = useState<AlertLevel | "ALL">("ALL");

  return (
    <BentoGrid ariaLabel="Panel de control operativo">
      {/* Fila 0 (Sprint A — F4.0) — vista del día. Full-width, va
          ARRIBA de los KPIs para responder "¿qué pasó ayer?" antes de
          que el supervisor tenga que scrollear. */}
      <BentoCard colSpan={12} testId="card-activity-comparison">
        <TodayYesterdayCard comparison={activityComparison} />
      </BentoCard>

      {/* Fila 1 — KPIs. Mix colSpan=2 + colSpan=3 = 12 (ver doc arriba). */}
      <BentoCard colSpan={2} testId="kpi-total-flights">
        <MetricCard
          accent={<CompassIcon />}
          hint="Misiones registradas en todas las parcelas"
          label="Registros Totales"
          tone={getDashboardKpiTone("totalFlights")}
          value={formatNumber(metrics.totalFlights)}
        />
      </BentoCard>
      <BentoCard colSpan={2} testId="kpi-total-area">
        <MetricCard
          accent={<AreaIcon />}
          hint="Cobertura combinada de huella de dron"
          label="Área Cubierta"
          tone={getDashboardKpiTone("totalAreaCovered")}
          value={formatArea(metrics.totalAreaCovered)}
        />
      </BentoCard>
      <BentoCard colSpan={2} testId="kpi-total-assets">
        <MetricCard
          accent={<DroneIcon />}
          hint="Activos DJI importados y disponibles"
          label="Activos DJI"
          tone={getDashboardKpiTone("totalAssets")}
          value={formatNumber(metrics.totalAssets)}
        />
      </BentoCard>
      <BentoCard colSpan={3} testId="kpi-high-alerts">
        <MetricCard
          accent={<AlertIcon />}
          hint="Umbral: 4 ha o 8h en un día. Día con volumen o frecuencia de riesgo."
          label="Alertas Altas"
          tone={getDashboardKpiTone("highAlertParcels")}
          value={formatNumber(metrics.highAlertParcels)}
        />
      </BentoCard>
      <BentoCard colSpan={3} testId="kpi-overdue-cadence">
        <MetricCard
          accent={<OverdueIcon />}
          hint="Recomendación basada en cadencia — confirmación manual requerida"
          label="Atrasadas por cadencia"
          tone="danger"
          value={formatNumber(overdueCount)}
        />
      </BentoCard>

      {/* Filas 2-3 — Upcoming + Alerts side-by-side, ambos rowSpan=2. */}
      <BentoCard size="md" colSpan={6} rowSpan={2} testId="card-upcoming-fumigations">
        <UpcomingFumigations items={upcoming} totalOverdue={overdueCount} />
      </BentoCard>
      <BentoCard size="md" colSpan={6} rowSpan={2} testId="card-alerts-paginated">
        <AlertsPanelPaginated
          alerts={alerts}
          alertFilter={alertFilter}
          onAlertFilterChange={setAlertFilter}
        />
      </BentoCard>

      {/* Fila 4 — OperationsPanel full-width. Sin scroll interno. */}
      <BentoCard colSpan={12} size="xl" testId="card-operations-panel">
        <OperationsPanel
          alertFilter={alertFilter}
          alerts={alerts}
          flights={flights}
          metrics={metrics}
          onAlertFilterChange={setAlertFilter}
          parcels={parcels}
        />
      </BentoCard>
    </BentoGrid>
  );
}
