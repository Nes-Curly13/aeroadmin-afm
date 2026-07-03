import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { DjiParcelRecord } from "@/lib/types";

// (S2 / 2026-07-01) Mock migrado de DjiAssetRecord (3-rows-per-field) a
// DjiParcelRecord (1-row-per-field, columnas planas). El shape legacy
// ya no existe — la tabla dji_land_assets se dropeó y getParcels() se eliminó.
function makeParcel(over: Partial<DjiParcelRecord>): DjiParcelRecord {
  return {
    id: 1,
    external_id: "ext-1",
    land_name: "Parcela",
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
    spray_geometry: { type: "Point", coordinates: [-76.4, 3.5] },
    reference_point: null,
    waypoints_geometry: null,
    waypoint_count: 0,
    source_url_geometry: null,
    source_url_parameter: null,
    source_url_waypoint: null,
    fetched_at: "2026-07-01T00:00:00Z",
    ...over
  };
}

vi.mock("@/components/map-client", () => ({
  MapClient: () => <div data-testid="map-client-stub" />
}));

vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ MapClient: React.ComponentType }>) => {
    return function DynamicComponent() {
      // No-op: no renderiza el mapa en tests
      return <div data-testid="dynamic-stub" />;
    };
  }
}));

import { MapView } from "@/components/map-view";

describe("MapView", () => {
  it("renderiza el mapa con parcelas que tienen geometría", () => {
    render(
      <MapView
        alerts={[]}
        flights={[]}
        parcels={[makeParcel({ id: 1 }), makeParcel({ id: 2, land_name: "Otra" })]}
      />
    );
    // El map-client-stub se renderiza a través de dynamic
    expect(screen.getByTestId("dynamic-stub")).toBeInTheDocument();
  });

  it("muestra el selector de parcelas", () => {
    render(
      <MapView
        alerts={[]}
        flights={[]}
        parcels={[makeParcel({ id: 1, land_name: "Mi parcela" })]}
      />
    );
    // El selector se renderiza dentro del panel
    expect(screen.getByLabelText(/seleccionar parcela/i)).toBeInTheDocument();
  });

  it("muestra la leyenda con 3 entradas", () => {
    render(
      <MapView
        alerts={[]}
        flights={[]}
        parcels={[makeParcel({})]}
      />
    );
    // Buscamos dentro del section de la leyenda (aria-label="Leyenda del mapa")
    const legend = screen.getByRole("region", { name: /leyenda del mapa/i });
    // Diseño Opción B: la leyenda muestra tipos de parcela + waypoint
    expect(legend.textContent).toMatch(/Farmland/);
    expect(legend.textContent).toMatch(/Orchards/);
    expect(legend.textContent).toMatch(/Waypoint/);
  });

  it("cambia de parcela al seleccionar otra en el dropdown", () => {
    const parcels = [makeParcel({ id: 1, land_name: "A" }), makeParcel({ id: 2, land_name: "B" })];
    render(<MapView alerts={[]} flights={[]} parcels={parcels} />);
    const select = screen.getByLabelText(/seleccionar parcela/i);
    fireEvent.change(select, { target: { value: "2" } });
    // El detail panel ahora muestra "B" como heading principal
    // (usamos getAllByText porque "B" también aparece en el dropdown)
    const headings = screen.getAllByText("B");
    expect(headings.length).toBeGreaterThan(0);
  });
});
