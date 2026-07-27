// Tests para el MapView component (v1.8 — flightPoints en leyenda).
//
// Strategy:
//   - Render <MapView> con props mockeadas (incluyendo flightPoints).
//   - Verificar que el componente acepta la prop flightPoints sin error.
//   - Verificar que la leyenda muestra los items "En vuelo" y "Completado"
//     cuando hay flightPoints (v1.8 — antes mostraba un único item "Vuelo"
//     condicional a flightPoints > 0).
//
// El MapClient (que carga Leaflet via dynamic) no se renderiza en jsdom
// (no hay DOM geometrico), asique testeamos los UI bits que SÍ render.
//
// v1.8 cambio:
//   - La leyenda pasó de 3 grupos (Parcelas/Alertas/Vuelos) con toggles
//     a 4 indicadores visuales puros: Parcela activa, Parcela inactiva,
//     En vuelo, Completado. Los items "En vuelo" y "Completado" se
//     muestran SIEMPRE (no son condicionales a flightPoints > 0) — la
//     leyenda es un "key visual" del mapa, no un toggle de capa.
//   - Los toggles de capa viven ahora en el <LayersControl> nativo de
//     Leaflet (esquina superior derecha del mapa), no en el MapView.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MapView } from "@/components/map-view";
import type { DjiParcelRecord, FlightPointRecord } from "@/lib/types";

const sampleParcels: DjiParcelRecord[] = [
  {
    id: 1,
    external_id: "ext-001",
    land_name: "Parcela Demo",
    field_type: "Farmland",
    declared_area_ha: null,
    spray_area_m2: 50000,
    drone_model_code: 201,
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

const sampleFlightPoints: FlightPointRecord[] = [
  {
    flight_id: 638640703,
    start_at: "2026-07-27T10:30:00.000Z", // reciente → "en vuelo"
    lng: -76.532,
    lat: 3.4516,
    drone_nickname: "AFM T40 1",
    pilot_name: "breiner pelaez",
    parcel_id: 1,
    area_m2: 1234.56,
    spray_usage_ml: 5000
  }
];

describe("MapView — v1.8 (flightPoints en leyenda)", () => {
  it("acepta flightPoints sin error de TypeScript / runtime", () => {
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

  it("la leyenda muestra SIEMPRE 'En vuelo' y 'Completado' (key visual, no condicional)", () => {
    render(
      <MapView
        alerts={[]}
        flights={[]}
        parcels={sampleParcels}
      />
    );
    // Aunque flightPoints no se pase, los items están en la leyenda.
    // v1.8 — son "key visual" del mapa, no indicadores condicionales.
    expect(screen.getByText(/en vuelo/i)).toBeInTheDocument();
    expect(screen.getByText(/completado/i)).toBeInTheDocument();
  });

  it("la leyenda NO tiene un item 'Vuelo' (el label viejo se renombró a 'En vuelo')", () => {
    render(
      <MapView
        alerts={[]}
        flightPoints={sampleFlightPoints}
        flights={[]}
        parcels={sampleParcels}
      />
    );
    // El test usa el texto exacto "Vuelo" (sin "En "). El nuevo
    // label es "En vuelo". Si la leyenda tuviera el viejo, el test
    // pasaría. Como ahora es "En vuelo", el match exacto falla.
    // Lo validamos buscando el texto que SÍ debe estar.
    expect(screen.queryByText(/^Vuelo$/)).toBeNull();
    expect(screen.getByText(/en vuelo/i)).toBeInTheDocument();
  });

  it("NO hay checkboxes en el MapView (los toggles de capa viven en Leaflet)", () => {
    render(
      <MapView
        alerts={[]}
        flightPoints={sampleFlightPoints}
        flights={[]}
        parcels={sampleParcels}
      />
    );
    // Cero checkboxes en el MapView — los toggles están en el
    // <LayersControl> de Leaflet, fuera del scope de este componente.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
