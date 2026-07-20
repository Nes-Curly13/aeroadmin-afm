import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { MapStatsIsland } from "@/components/map/map-stats-island";
import type {
  DjiAlertRecord,
  DjiDailySummaryRecord,
  DjiParcelRecord,
  FlightPointRecord
} from "@/lib/types";
import type { getParcelsSummary } from "@/api/repositories";

type ParcelsSummaryRow = Awaited<ReturnType<typeof getParcelsSummary>>[number];

function makeParcel(over: Partial<DjiParcelRecord>): DjiParcelRecord {
  return {
    id: 1,
    external_id: "ext-1",
    land_name: "Parcela A",
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
    waypoint_count: 12,
    source_url_geometry: null,
    source_url_parameter: null,
    source_url_waypoint: null,
    fetched_at: "2026-07-01T00:00:00Z",
    ...over
  };
}

const PARCELS: DjiParcelRecord[] = [
  makeParcel({ id: 1, land_name: "Parcela A", spray_area_m2: 12_500, waypoint_count: 12, is_orchard: false }),
  makeParcel({ id: 2, land_name: "Parcela B", spray_area_m2: 5_000, waypoint_count: 0, is_orchard: true, field_type: "Orchards" }),
  makeParcel({ id: 3, land_name: "Parcela C", spray_area_m2: 7_500, waypoint_count: 8, is_orchard: false })
];

const SUMMARY: ParcelsSummaryRow[] = [
  { total_parcels: "2", total_orchards: "0", total_farmlands: "2", total_spray_area_m2: "20000", avg_spray_area_m2: "10000", drone_model_code: 201, drone_model_name: "Agras T40", count_by_drone: "2" },
  { total_parcels: "1", total_orchards: "1", total_farmlands: "0", total_spray_area_m2: "5000", avg_spray_area_m2: "5000", drone_model_code: 202, drone_model_name: "Agras T50", count_by_drone: "1" }
];

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

const ALERT_LOW: DjiAlertRecord = {
  parcel_id: 1,
  parcel_name: "Parcela A",
  level: "LOW",
  age_days: 5,
  message: "OK",
  geometry: null
};

const ALERT_HIGH: DjiAlertRecord = {
  parcel_id: 2,
  parcel_name: "Parcela B",
  level: "HIGH",
  age_days: 30,
  message: "Riesgo",
  geometry: null
};

const FLIGHT_POINTS: FlightPointRecord[] = [
  { flight_id: 100, start_at: "2026-06-01T00:00:00Z", lng: -76.4, lat: 3.5, drone_nickname: "T40-01", pilot_name: "Juan", parcel_id: 1, area_m2: 1200, spray_usage_ml: 500 }
];

/**
 * Helper: busca el KPI con un label específico dentro del bloque de KPIs
 * y devuelve su contenedor <div> para inspeccionar el valor numérico.
 */
function findKpiByLabel(label: RegExp) {
  const kpiContainer = screen.getByTestId("map-stats-kpis");
  // Encuentra el <p> que matchea el label y sube al <div> padre
  const labelEl = within(kpiContainer).getByText(label);
  return labelEl.parentElement as HTMLElement;
}

describe("MapStatsIsland", () => {
  it("renderiza los 5 KPIs con sus labels", () => {
    render(
      <MapStatsIsland
        alerts={[ALERT_LOW]}
        flightPoints={FLIGHT_POINTS}
        flights={{ data: [FLIGHT], total: 1, page: 1, limit: 20, totalPages: 1 }}
        fumigatedIds={new Set([1, 3])}
        parcels={PARCELS}
        summary={SUMMARY}
      />
    );
    const kpis = screen.getByTestId("map-stats-kpis");
    expect(within(kpis).getByText(/^parcelas$/i)).toBeInTheDocument();
    expect(within(kpis).getByText(/área fumigable/i)).toBeInTheDocument();
    expect(within(kpis).getByText(/con plan de vuelo/i)).toBeInTheDocument();
    expect(within(kpis).getByText(/drones en flota/i)).toBeInTheDocument();
    expect(within(kpis).getByText(/fumigadas \(6m\)/i)).toBeInTheDocument();
  });

  it("calcula correctamente el total de parcelas y el split orchards/farmland", () => {
    render(
      <MapStatsIsland
        alerts={[]}
        flightPoints={[]}
        flights={{ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }}
        fumigatedIds={new Set()}
        parcels={PARCELS}
        summary={SUMMARY}
      />
    );
    // KPI Parcelas: total 3
    const parcelasKpi = findKpiByLabel(/^parcelas$/i);
    expect(within(parcelasKpi).getByText("3")).toBeInTheDocument();
    // 1 orchard, 2 farmland
    expect(within(parcelasKpi).getByText(/1 orchards.*2 farmland/i)).toBeInTheDocument();
  });

  it("calcula correctamente el área fumigable agregada en ha y m²", () => {
    render(
      <MapStatsIsland
        alerts={[]}
        flightPoints={[]}
        flights={{ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }}
        fumigatedIds={new Set()}
        parcels={PARCELS}
        summary={SUMMARY}
      />
    );
    // 12500 + 5000 + 7500 = 25000 m² = 2.50 ha
    const areaKpi = findKpiByLabel(/área fumigable/i);
    expect(within(areaKpi).getByText("2.50 ha")).toBeInTheDocument();
    // m² con separador en-US
    expect(within(areaKpi).getByText(/25,000/)).toBeInTheDocument();
  });

  it("cuenta parcelas con plan de vuelo (waypoint_count > 0)", () => {
    render(
      <MapStatsIsland
        alerts={[]}
        flightPoints={[]}
        flights={{ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }}
        fumigatedIds={new Set()}
        parcels={PARCELS}
        summary={SUMMARY}
      />
    );
    // PARCELS: 2 con waypoints (id 1 y 3), 1 sin waypoints (id 2)
    const planKpi = findKpiByLabel(/con plan de vuelo/i);
    expect(within(planKpi).getByText("2")).toBeInTheDocument();
    expect(within(planKpi).getByText(/de 3 parcelas/i)).toBeInTheDocument();
  });

  it("renderiza el panel 'Distribución por drone' con barras y porcentajes", () => {
    render(
      <MapStatsIsland
        alerts={[]}
        flightPoints={[]}
        flights={{ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }}
        fumigatedIds={new Set()}
        parcels={PARCELS}
        summary={SUMMARY}
      />
    );
    const panels = screen.getByTestId("map-stats-panels");
    expect(within(panels).getByText(/distribución por drone/i)).toBeInTheDocument();
    // 2 drones: T40 (2 parcelas = 67%) y T50 (1 parcela = 33%)
    expect(within(panels).getByText(/Agras T40/)).toBeInTheDocument();
    expect(within(panels).getByText(/Agras T50/)).toBeInTheDocument();
    // Barras
    const bars = document.querySelectorAll("[data-drone-bar]");
    expect(bars.length).toBe(2);
  });

  it("renderiza el panel 'Resúmenes operativos' con días registrados y alertas altas", () => {
    render(
      <MapStatsIsland
        alerts={[ALERT_LOW, ALERT_HIGH]}
        flightPoints={[]}
        flights={{ data: [FLIGHT, FLIGHT], total: 2, page: 1, limit: 20, totalPages: 1 }}
        fumigatedIds={new Set()}
        parcels={PARCELS}
        summary={SUMMARY}
      />
    );
    const panels = screen.getByTestId("map-stats-panels");
    expect(within(panels).getByText(/resúmenes operativos/i)).toBeInTheDocument();
    const diasBlock = within(panels).getByText(/días registrados/i).parentElement as HTMLElement;
    expect(within(diasBlock).getByText("2")).toBeInTheDocument();
    // 1 alerta HIGH
    const alertasBlock = within(panels).getByText(/alertas altas/i).parentElement as HTMLElement;
    expect(within(alertasBlock).getByText("1")).toBeInTheDocument();
  });

  it("cuenta fumigadas correctamente contra el set fumigatedIds", () => {
    render(
      <MapStatsIsland
        alerts={[]}
        flightPoints={[]}
        flights={{ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }}
        fumigatedIds={new Set([1, 2])} // 2 de 3 fumigadas
        parcels={PARCELS}
        summary={SUMMARY}
      />
    );
    // KPI Fumigadas: 2 fumigadas, 1 sin fumigación reciente
    const fumKpi = findKpiByLabel(/fumigadas \(6m\)/i);
    expect(within(fumKpi).getByText("2")).toBeInTheDocument();
    expect(within(fumKpi).getByText(/1 sin fumigación reciente/i)).toBeInTheDocument();
  });

  it("renderiza sin tirar con datos vacíos", () => {
    render(
      <MapStatsIsland
        alerts={[]}
        flightPoints={[]}
        flights={{ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }}
        fumigatedIds={new Set()}
        parcels={[]}
        summary={[]}
      />
    );
    // 0 parcelas (KPI Parcelas)
    const parcelasKpi = findKpiByLabel(/^parcelas$/i);
    expect(within(parcelasKpi).getByText("0")).toBeInTheDocument();
    // Panel distribución con estado vacío
    const panels = screen.getByTestId("map-stats-panels");
    expect(within(panels).getByText(/sin drones asignados/i)).toBeInTheDocument();
  });

  it("no rompe con summary sin drone_model_name (los agrupa como 'Sin asignar')", () => {
    const summaryWithNull: ParcelsSummaryRow[] = [
      { total_parcels: "1", total_orchards: "0", total_farmlands: "1", total_spray_area_m2: "10000", avg_spray_area_m2: "10000", drone_model_code: null, drone_model_name: null, count_by_drone: "1" }
    ];
    render(
      <MapStatsIsland
        alerts={[]}
        flightPoints={[]}
        flights={{ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }}
        fumigatedIds={new Set()}
        parcels={[makeParcel({})]}
        summary={summaryWithNull}
      />
    );
    expect(screen.getByText(/sin asignar/i)).toBeInTheDocument();
  });

  it("maneja fumigatedIds como Set con 0 elementos sin fallar", () => {
    expect(() => {
      render(
        <MapStatsIsland
          alerts={[]}
          flightPoints={[]}
          flights={{ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }}
          fumigatedIds={new Set()}
          parcels={PARCELS}
          summary={SUMMARY}
        />
      );
    }).not.toThrow();
  });
});
