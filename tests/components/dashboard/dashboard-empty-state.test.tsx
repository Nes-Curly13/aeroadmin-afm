// tests/components/dashboard/dashboard-empty-state.test.tsx
//
// Sprint A — F3.0: tests del banner "Aún no hay datos" del dashboard.
// Cubre el componente individual Y su integración en DashboardClient
// (que es el patrón de "mostrar solo el banner si todo está en 0").
//
// Cobertura:
//   - <DashboardEmptyState /> renderiza headline + body + CTA con
//     target="_blank" y rel="noopener".
//   - El CTA apunta al doc de operaciones (default /docs/ARCHITECTURE.md).
//   - <DashboardClient /> muestra el banner cuando totalFlights=0,
//     overdueCount=0, sin alertas HIGH.
//   - <DashboardClient /> NO muestra el banner si hay CUALQUIER flight.
//   - <DashboardClient /> NO muestra el banner si hay alertas HIGH
//     (incluso con totalFlights=0).
//   - <DashboardClient /> NO muestra el banner si overdueCount > 0
//     (incluso con totalFlights=0).

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import type { ActivityComparison } from "@/lib/cache";
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import type {
  AlertLevel,
  DashboardMetrics,
  DjiAlertRecord,
  DjiParcelRecord,
  UpcomingFumigation
} from "@/lib/types";

const emptyActivity: ActivityComparison = {
  today: { flights_count: 0, area_fumigated_m2: 0, parcels_touched: 0, duration_minutes: 0 },
  yesterday: { flights_count: 0, area_fumigated_m2: 0, parcels_touched: 0, duration_minutes: 0 },
  dates: { today: "2026-07-23", yesterday: "2026-07-22" }
};

describe("<DashboardEmptyState /> — F3.0 banner", () => {
  it("renderiza el headline, body y CTA", () => {
    render(<DashboardEmptyState />);
    expect(screen.getByText(/aún no hay datos de fumigación/i)).toBeInTheDocument();
    expect(
      screen.getByText(/ejecutá el scraper dji ag en el server/i)
    ).toBeInTheDocument();
    const cta = screen.getByTestId("dashboard-empty-state-cta-docs");
    expect(cta).toBeInTheDocument();
    expect(cta.getAttribute("target")).toBe("_blank");
    expect(cta.getAttribute("rel")).toMatch(/noopener/);
  });

  it("apunta al doc de operaciones por default", () => {
    render(<DashboardEmptyState />);
    const cta = screen.getByTestId("dashboard-empty-state-cta-docs");
    expect(cta.getAttribute("href")).toBe("/docs/ARCHITECTURE.md");
  });

  it("acepta un docsHref custom", () => {
    render(<DashboardEmptyState docsHref="/docs/otra-cosa.md" />);
    const cta = screen.getByTestId("dashboard-empty-state-cta-docs");
    expect(cta.getAttribute("href")).toBe("/docs/otra-cosa.md");
  });
});

describe("<DashboardClient /> — F3.0 empty state integration", () => {
  const baseMetrics: DashboardMetrics = {
    totalFlights: 0,
    totalAreaCovered: 0,
    highAlertParcels: 0,
    totalAssets: 0
  };
  const baseAlerts: DjiAlertRecord[] = [];
  const baseParcels: DjiParcelRecord[] = [];
  const baseUpcoming: UpcomingFumigation[] = [];

  it("muestra el banner cuando todo está en 0 (BD recién poblada)", () => {
    render(
      <DashboardClient
        activityComparison={emptyActivity}
        alerts={baseAlerts}
        flights={[]}
        metrics={baseMetrics}
        overdueCount={0}
        parcels={baseParcels}
        upcoming={baseUpcoming}
      />
    );
    expect(screen.getByTestId("dashboard-empty")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-empty-state")).toBeInTheDocument();
    // El bento NO se renderiza
    expect(screen.queryByTestId("card-activity-comparison")).toBeNull();
    expect(screen.queryByText("Atrasadas por cadencia")).toBeNull();
  });

  it("NO muestra el banner si hay al menos 1 flight", () => {
    render(
      <DashboardClient
        activityComparison={emptyActivity}
        alerts={baseAlerts}
        flights={[]}
        metrics={{ ...baseMetrics, totalFlights: 1 }}
        overdueCount={0}
        parcels={baseParcels}
        upcoming={baseUpcoming}
      />
    );
    expect(screen.queryByTestId("dashboard-empty")).toBeNull();
    // El bento SÍ se renderiza — el card de TodayYesterday está presente
    expect(screen.getByTestId("card-activity-comparison")).toBeInTheDocument();
  });

  it("NO muestra el banner si overdueCount > 0 (incluso con 0 flights)", () => {
    render(
      <DashboardClient
        activityComparison={emptyActivity}
        alerts={baseAlerts}
        flights={[]}
        metrics={baseMetrics}
        overdueCount={3}
        parcels={baseParcels}
        upcoming={baseUpcoming}
      />
    );
    expect(screen.queryByTestId("dashboard-empty")).toBeNull();
  });

  it("NO muestra el banner si hay alertas HIGH (incluso con 0 flights)", () => {
    const highAlerts: DjiAlertRecord[] = [
      {
        parcel_id: 1,
        parcel_name: "X",
        level: "HIGH" as AlertLevel,
        age_days: 5,
        message: "high",
        geometry: null
      }
    ];
    render(
      <DashboardClient
        activityComparison={emptyActivity}
        alerts={highAlerts}
        flights={[]}
        metrics={baseMetrics}
        overdueCount={0}
        parcels={baseParcels}
        upcoming={baseUpcoming}
      />
    );
    expect(screen.queryByTestId("dashboard-empty")).toBeNull();
  });

  it("ignora alertas LOW/MEDIUM — siguen mostrando el banner si no hay flights/overdue", () => {
    const lowAlerts: DjiAlertRecord[] = [
      {
        parcel_id: 1,
        parcel_name: "X",
        level: "LOW" as AlertLevel,
        age_days: 5,
        message: "low",
        geometry: null
      },
      {
        parcel_id: 2,
        parcel_name: "Y",
        level: "MEDIUM" as AlertLevel,
        age_days: 5,
        message: "med",
        geometry: null
      }
    ];
    render(
      <DashboardClient
        activityComparison={emptyActivity}
        alerts={lowAlerts}
        flights={[]}
        metrics={baseMetrics}
        overdueCount={0}
        parcels={baseParcels}
        upcoming={baseUpcoming}
      />
    );
    // LOW/MEDIUM no son HIGH → el banner SÍ se muestra
    expect(screen.getByTestId("dashboard-empty")).toBeInTheDocument();
  });
});
