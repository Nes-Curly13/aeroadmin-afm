"use client";

import { useMemo, useState } from "react";

import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import { Pagination } from "@/components/ui/pagination";
import type { AlertLevel, DjiAlertRecord } from "@/lib/types";

const PAGE_SIZE = 5;

export interface AlertsPanelPaginatedProps {
  alerts: DjiAlertRecord[];
  alertFilter: AlertLevel | "ALL";
  onAlertFilterChange: (level: AlertLevel | "ALL") => void;
}

/**
 * Wrapper del `<AlertsPanel>` que agrega paginación (sprint v1.7 — Track A).
 *
 * Por qué existe:
 *   - El `<AlertsPanel>` original no paginaba — renderizaba TODAS las
 *     alertas en una sola lista vertical. Con badges HIGH/MEDIUM/LOW
 *     mezclados, la lista podía crecer indefinidamente y forzar scroll
 *     del body, rompiendo el layout bento (el operador pierde de vista
 *     los KPIs).
 *   - En el sprint v1.7 (UI overhaul) estandarizamos paginación via
 *     `<Pagination>`. El Pagination es stateless: nosotros manejamos
 *     el `currentPage` y sliceamos los alerts antes de pasarlos al
 *     `<AlertsPanel>`.
 *
 * Por qué no modificamos `<AlertsPanel>`:
 *   - El spec lo prohíbe explícitamente ("NO toques el `<AlertsPanel>`
 *     actual si podés evitarlo"). La paginación es responsabilidad de
 *     este wrapper, no del panel interno.
 *
 * Comportamiento:
 *   - 5 alerts por página. `totalPages = Math.ceil(alerts.length / 5)`.
 *   - Cuando `alerts.length === 0`, `<Pagination>` retorna null por sí
 *     mismo (chequea `totalPages <= 1`). No hace falta un condicional acá.
 *   - El `alertFilter` (HIGH/MEDIUM/LOW/ALL) lo seguimos pasando al
 *     `<AlertsPanel>` para mantener los botones de filtro funcionales
 *     (filtran la página actual). El estado del filtro vive en el
 *     `DashboardClient` para poder sincronizarse con el
 *     `RecentFlightsList`.
 *   - Si el usuario navega de página y luego cambia el filtro, el
 *     `<AlertsPanel>` re-filtra la nueva página. No reseteamos el
 *     `currentPage` acá (el spec no lo pide; la interacción filtro +
 *     paginación queda "filtrar la página actual").
 *
 * Tests:
 *   - `tests/components/dashboard/alerts-panel-paginated.test.tsx` cubre
 *     paginación básica, callbacks, y el caso sin alerts.
 */
export function AlertsPanelPaginated({
  alerts,
  alertFilter,
  onAlertFilterChange
}: AlertsPanelPaginatedProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(alerts.length / PAGE_SIZE));

  const paginatedAlerts = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return alerts.slice(start, start + PAGE_SIZE);
  }, [alerts, currentPage]);

  return (
    <div className="flex h-full flex-col" data-testid="alerts-panel-paginated">
      <div className="flex-1">
        <AlertsPanel
          alertFilter={alertFilter}
          alerts={paginatedAlerts}
          onAlertFilterChange={onAlertFilterChange}
        />
      </div>
      <div className="mt-4 flex justify-center">
        <Pagination
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          testId="alerts-panel-pagination"
          totalPages={totalPages}
        />
      </div>
    </div>
  );
}
