// Tests para el MapView component (M6: flightPoints + layers toggle).
//
// Strategy:
//   - Render <MapView> con props mockeadas.
//   - Verificar que el componente acepta la prop flightPoints + layer toggle.
//   - Verificar que el legend item "Vuelo" aparece SOLO si flightPoints > 0.
//
// El MapClient (que carga Leaflet via dynamic) no se renderiza en jsdom
// (no hay DOM geometrico), asique testeamos los UI bits que SÍ render.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MapView } from "@/components/map-view";

const sampleParcels = [
  {
    id: 1,
    external_id: "ext-001",
    land_name: "Parcela Demo",
    asset_kind: "parcel",
    source_url: "",
    raw_json: null,
    geometry: null,
    field_type: "Farmland",
    declared_area_ha: null,
    spray_area_m2: 50000,
    drone_model_code: null,
    drone_model_name: "T40",
    spray_width_m: 5,
    work_speed_mps: 5,
    optimal_heading_deg: 0,
    radar_height_m: 3,
    edge_offset_m: 1,
    obstacle_offset_m: 1,
    climb_height_m: 4,
    no_spray_zone_m2: 0,
    droplet_size: 100,
    sweep_direction: 0,
    is_orchard: false,
    uses_side_spray: false,
    spray_geometry: null,
    reference_point: null,
    waypoints_geometry: null,
    waypoint_count: 0,
    source_url_geometry: null,
    source_url_parameter: null,
    source_url_waypoint: null,
    fetched_at: null
  }
];

const sampleFlightPoints = [
  {
    flight_id: 638640703,
    start_at: "2026-06-15T10:30:00.000Z",
    lng: -76.532,
    lat: 3.4516,
    drone_nickname: "AFM T40 1",
    pilot_name: "breiner pelaez",
    parcel_id: 1,
    area_m2: 1234.56,
    spray_usage_ml: 5000
  }
];

describe("MapView — flightPoints (M6)", () => {
  it("acepta flightPoints sin erro de TypeScript", () => {
    // El type-checker cubre esto en CI; aqui solo verificamos que el componente
    // se monta con la prop.
    const { container } = render(
      <MapView
        alerts={[]}
        flightPoints={sampleFlightPoints}
        flights={[]}
        parcels={sampleParcels}
      />
    );
    expect(container).toBeTruthy();
  });

  it("el toggle 'Vuelos (DJI AG)' aparece en el panel de capas", () => {
    render(
      <MapView
        alerts={[]}
        flightPoints={sampleFlightPoints}
        flights={[]}
        parcels={sampleParcels}
      />
    );
    // El label del checkbox para la capa 'flights' incluye el texto custom.
    expect(screen.getByText("Vuelos (DJI AG)")).toBeInTheDocument();
  });

  it("los 4 toggles de capas (parcels, waypoints, alerts, flights) estan", () => {
    render(
      <MapView
        alerts={[]}
        flights={[]}
        parcels={sampleParcels}
      />
    );
    // Sin flightPoints la leyenda toggle 'flights' existe igual; solo el legend
    // item 'Vuelo' es condicional.
    const checkboxes = screen.getAllByRole("checkbox");
    // 4 toggle de capas + ~0 de alerts (no hay alerts)
    expect(checkboxes.length).toBeGreaterThanOrEqual(4);
  });

  it("flightPoints vacios (undefined) — componente OK y sin legend 'Vuelo'", () => {
    const { container } = render(
      <MapView
        alerts={[]}
        flights={[]}
        parcels={sampleParcels}
      />
    );
    expect(container).toBeTruthy();
    // La leyenda no debe mostrar el dot 'Vuelo' (solo aparece si flightPoints > 0).
    expect(screen.queryByText("Vuelo")).not.toBeInTheDocument();
  });

  it("flightPoints con 1 elemento — legend 'Vuelo' aparece", () => {
    render(
      <MapView
        alerts={[]}
        flightPoints={sampleFlightPoints}
        flights={[]}
        parcels={sampleParcels}
      />
    );
    expect(screen.getByText("Vuelo")).toBeInTheDocument();
  });
});
