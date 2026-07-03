import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { OperationsPanel } from "@/components/dashboard/operations-panel";
import type {
  DashboardMetrics,
  DjiAlertRecord,
  DjiDailySummaryRecord,
  DjiParcelRecord
} from "@/lib/types";

const METRICS: DashboardMetrics = {
  totalFlights: 30,
  totalAreaCovered: 1234.5,
  highAlertParcels: 2,
  totalAssets: 50
};

const FLIGHT: DjiDailySummaryRecord = {
  id: 1,
  record_date: "2026-06-01",
  weekday: "Monday",
  category: "Agriculture",
  area_mu: 10,
  times_count: 5,
  usage_liters: 50,
  work_time_text: "1Hour0min0s",
  raw_text: "raw"
};

const FLIGHT_HIGH: DjiDailySummaryRecord = {
  ...FLIGHT,
  id: 2,
  area_mu: 80,
  times_count: 90
};

const ALERT: DjiAlertRecord = {
  parcel_id: 1,
  parcel_name: "Parcela 1",
  level: "HIGH",
  age_days: 5,
  message: "x",
  geometry: null
};

const PARCEL: DjiParcelRecord = {
  id: 1,
  external_id: "ext-1",
  land_name: "Mi parcela",
  field_type: "Farmland",
  declared_area_ha: null,
  spray_area_m2: 12_500,
  drone_model_code: 201,
  drone_model_name: "Agras T40",
  spray_width_m: 5.5,
  work_speed_mps: 6.0,
  optimal_heading_deg: 115,
  radar_height_m: 3.0,
  edge_offset_m: 1.5,
  obstacle_offset_m: 1.5,
  climb_height_m: 2.0,
  no_spray_zone_m2: 0,
  droplet_size: 320,
  sweep_direction: 1,
  is_orchard: false,
  uses_side_spray: false,
  spray_geometry: null,
  reference_point: null,
  waypoints_geometry: null,
  waypoint_count: 24,
  source_url_geometry: null,
  source_url_parameter: null,
  source_url_waypoint: null,
  fetched_at: "2026-07-01T00:00:00Z"
};

describe("OperationsPanel", () => {
  it("renderiza con datos vacíos sin tirar", () => {
    render(
      <OperationsPanel
        alerts={[]}
        flights={[]}
        metrics={METRICS}
        parcels={[]}
      />
    );
    expect(screen.getByText(/reporte 2026/i)).toBeInTheDocument();
  });

  it("renderiza el panel 'Reporte 2026' con datos típicos", () => {
    render(
      <OperationsPanel
        alerts={[]}
        flights={[FLIGHT, FLIGHT_HIGH, FLIGHT]}
        metrics={METRICS}
        parcels={[]}
      />
    );
    expect(screen.getByText(/reporte 2026/i)).toBeInTheDocument();
    // Las 4 KPIs originales NO se renderizan (esos vienen del header del dashboard)
    expect(screen.queryByText(/resumenes año/i)).not.toBeInTheDocument();
  });

  it("renderiza el bloque 'Acceso rapido'", () => {
    render(
      <OperationsPanel
        alerts={[]}
        flights={[]}
        metrics={METRICS}
        parcels={[PARCEL]}
      />
    );
    expect(screen.getByText(/acceso rapido/i)).toBeInTheDocument();
  });

  it("renderiza el bloque 'Sincronización DJI' con totalAssets", () => {
    render(
      <OperationsPanel
        alerts={[ALERT]}
        flights={[]}
        metrics={METRICS}
        parcels={[]}
      />
    );
    expect(screen.getByText(/sincronizaci(o|ó)n dji/i)).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("renderiza el panel de alertas con header 'Alertas DJI'", () => {
    render(
      <OperationsPanel
        alerts={[ALERT]}
        flights={[]}
        metrics={METRICS}
        parcels={[]}
      />
    );
    expect(screen.getByRole("heading", { name: /alertas dji/i })).toBeInTheDocument();
  });

  it("renderiza la lista de vuelos con header 'Registro reciente'", () => {
    render(
      <OperationsPanel
        alerts={[]}
        flights={[FLIGHT, FLIGHT_HIGH]}
        metrics={METRICS}
        parcels={[]}
      />
    );
    expect(screen.getByText(/registro reciente/i)).toBeInTheDocument();
    // 2 flights visibles
    const items = document.querySelectorAll('[data-flight-id]');
    expect(items.length).toBe(2);
  });

  it("muestra el estado vacío de la lista de vuelos cuando no hay flights", () => {
    render(
      <OperationsPanel
        alerts={[]}
        flights={[]}
        metrics={METRICS}
        parcels={[]}
      />
    );
    expect(screen.getByText(/no hay vuelos/i)).toBeInTheDocument();
  });

  it("calcula correctamente el mes más activo (al menos 2 flights del mismo mes)", () => {
    // Usamos fechas con día 15 para evitar problemas de TZ offset con día 1
    const flights = [
      { ...FLIGHT, id: 1, record_date: "2026-05-15" },
      { ...FLIGHT, id: 2, record_date: "2026-05-20" },
      { ...FLIGHT, id: 3, record_date: "2026-06-15" }
    ];
    render(
      <OperationsPanel
        alerts={[]}
        flights={flights}
        metrics={METRICS}
        parcels={[]}
      />
    );
    // 2 de los 3 flights son del mismo mes, 1 es de otro
    // El "X registros" debe ser exactamente 2
    expect(screen.getByText(/2 registros/i)).toBeInTheDocument();
  });
});
