// Tests de `<AlertsPanelPaginated>` (sprint v1.7 — Track A).
//
// Cubre el wrapper que agrega paginación (5 alerts/página) sobre el
// `<AlertsPanel>` original. El `<AlertsPanel>` se mantiene sin
// modificaciones — sus tests viven en
// `tests/components/dashboard/alerts-panel.test.tsx`.
//
// Cobertura:
//   - Slicea correctamente: página 1 muestra los primeros 5, página 2
//     los siguientes 5, etc.
//   - El `<Pagination>` aparece cuando hay >5 alerts y NO aparece
//     cuando hay <=5 (regla del spec: "si no hay alerts, no muestres
//     el Pagination"; el componente <Pagination> ya hace
//     `if (totalPages <= 1) return null` por sí mismo).
//   - onPageChange se llama al cambiar de página.
//   - El `alertFilter` y `onAlertFilterChange` se delegan al
//     `<AlertsPanel>` subyacente (botones de filtro siguen funcionando).
//   - Cuando no hay alerts, no se rompe y no se muestra la Pagination.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { AlertsPanelPaginated } from "@/components/dashboard/alerts-panel-paginated";
import type { DjiAlertRecord } from "@/lib/types";

function makeAlert(id: number, level: DjiAlertRecord["level"]): DjiAlertRecord {
  return {
    age_days: 1,
    geometry: null,
    level,
    message: `Alerta ${id}`,
    parcel_id: id,
    parcel_name: `Parcela ${id}`
  };
}

const PAGE_SIZE = 5;

function buildAlerts(count: number): DjiAlertRecord[] {
  // Alternamos HIGH/LOW para que el test también sea robusto si los
  // nombres o niveles cambian.
  return Array.from({ length: count }, (_, i) => makeAlert(i + 1, i % 2 === 0 ? "HIGH" : "LOW"));
}

describe("AlertsPanelPaginated", () => {
  it("renderiza el header 'Alertas DJI' cuando hay alerts (delegado al AlertsPanel)", () => {
    render(
      <AlertsPanelPaginated
        alerts={buildAlerts(3)}
        alertFilter="ALL"
        onAlertFilterChange={() => {}}
      />
    );
    expect(screen.getByRole("heading", { name: /alertas dji/i })).toBeInTheDocument();
  });

  it("muestra los primeros 5 alerts en la página 1 (alerts > 5)", () => {
    const alerts = buildAlerts(12);
    render(
      <AlertsPanelPaginated
        alerts={alerts}
        alertFilter="ALL"
        onAlertFilterChange={() => {}}
      />
    );
    // Los primeros 5 names aparecen
    for (let i = 1; i <= PAGE_SIZE; i++) {
      expect(screen.getByText(`Parcela ${i}`)).toBeInTheDocument();
    }
    // El sexto NO aparece (queda en página 2)
    expect(screen.queryByText("Parcela 6")).toBeNull();
  });

  it("NO muestra el Pagination cuando hay <=5 alerts", () => {
    render(
      <AlertsPanelPaginated
        alerts={buildAlerts(3)}
        alertFilter="ALL"
        onAlertFilterChange={() => {}}
      />
    );
    // El Pagination expone data-testid="alerts-panel-pagination" cuando
    // totalPages > 1. Con 3 alerts → totalPages=1 → el componente
    // retorna null → no hay Pagination.
    expect(screen.queryByTestId("alerts-panel-pagination")).toBeNull();
  });

  it("muestra el Pagination cuando hay >5 alerts", () => {
    render(
      <AlertsPanelPaginated
        alerts={buildAlerts(12)}
        alertFilter="ALL"
        onAlertFilterChange={() => {}}
      />
    );
    // 12 alerts / 5 = 3 páginas (ceil). El Pagination debe estar.
    expect(screen.getByTestId("alerts-panel-pagination")).toBeInTheDocument();
  });

  it("navega a página 2 al clickear 'Siguiente →' y muestra los siguientes 5 alerts", () => {
    const alerts = buildAlerts(12);
    render(
      <AlertsPanelPaginated
        alerts={alerts}
        alertFilter="ALL"
        onAlertFilterChange={() => {}}
      />
    );
    // Inicialmente: Parcela 1..5
    expect(screen.getByText("Parcela 1")).toBeInTheDocument();
    expect(screen.queryByText("Parcela 6")).toBeNull();

    // Click "Siguiente"
    fireEvent.click(screen.getByRole("button", { name: /página siguiente/i }));

    // Ahora: Parcela 6..10. Parcela 1 desaparece.
    expect(screen.getByText("Parcela 6")).toBeInTheDocument();
    expect(screen.getByText("Parcela 10")).toBeInTheDocument();
    expect(screen.queryByText("Parcela 1")).toBeNull();
    expect(screen.queryByText("Parcela 11")).toBeNull();
  });

  it("vuelve a página 1 al clickear '← Anterior' desde página 2", () => {
    const alerts = buildAlerts(12);
    render(
      <AlertsPanelPaginated
        alerts={alerts}
        alertFilter="ALL"
        onAlertFilterChange={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /página siguiente/i }));
    expect(screen.getByText("Parcela 6")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /página anterior/i }));
    expect(screen.getByText("Parcela 1")).toBeInTheDocument();
    expect(screen.queryByText("Parcela 6")).toBeNull();
  });

  it("renderiza sin alerts sin tirar y sin mostrar Pagination", () => {
    render(
      <AlertsPanelPaginated alerts={[]} alertFilter="ALL" onAlertFilterChange={() => {}} />
    );
    // AlertsPanel en empty state: "Sin alertas activas"
    expect(screen.getByText(/sin alertas activas/i)).toBeInTheDocument();
    // Sin Pagination
    expect(screen.queryByTestId("alerts-panel-pagination")).toBeNull();
  });

  it("delega el click del filtro HIGH al onAlertFilterChange del padre", () => {
    const onChange = vi.fn();
    render(
      <AlertsPanelPaginated
        alerts={buildAlerts(3)}
        alertFilter="ALL"
        onAlertFilterChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "HIGH" }));
    expect(onChange).toHaveBeenCalledWith("HIGH");
  });
});
