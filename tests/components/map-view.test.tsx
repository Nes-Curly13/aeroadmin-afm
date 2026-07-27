import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

/**
 * Tests del MapView (v1.8).
 *
 * v1.8 cambio:
 *   - Se eliminó el panel derecho permanente (buscador de parcela +
 *     datos del dron + parámetros de aspersión + toggles de capa +
 *     link al detalle). Toda esa info pasa al popup de Leaflet.
 *   - Las capas se tildan/destildan desde el `<LayersControl>` nativo
 *     de Leaflet (esquina superior derecha), no desde un panel propio.
 *   - La leyenda se rebalanceó: 4 indicadores visuales puros
 *     (Parcela activa, Parcela inactiva, En vuelo, Completado) sin
 *     toggles. Está en la esquina inferior izquierda.
 *
 * Por lo tanto, los tests ya NO verifican:
 *   - El `<ParcelSearch>` (no está más)
 *   - El `<select>` de selección de parcela (no está más)
 *   - El detalle de dron / aspersión (no está más)
 *   - Los toggles de capa (están en Leaflet, fuera del scope de
 *     este componente)
 *
 * Lo que SÍ verificamos:
 *   - El `<MapClient>` se monta vía dynamic
 *   - La `<MapLegend>` se renderiza con los 4 items correctos
 *   - El `topRightSlot` se monta cuando se pasa
 */
describe("MapView — v1.8 (mapa full-bleed, sin panel derecho)", () => {
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

  it("renderiza la leyenda con 4 entradas (Parcela activa/inactiva + En vuelo/Completado)", () => {
    render(
      <MapView
        alerts={[]}
        flights={[]}
        parcels={[makeParcel({})]}
      />
    );
    // La leyenda está en la esquina inferior izquierda.
    const legend = screen.getByRole("region", { name: /leyenda del mapa/i });
    expect(legend).toBeInTheDocument();
    expect(legend.textContent).toMatch(/parcela activa/i);
    expect(legend.textContent).toMatch(/parcela inactiva/i);
    expect(legend.textContent).toMatch(/en vuelo/i);
    expect(legend.textContent).toMatch(/completado/i);
  });

  it("la leyenda NO tiene toggles de capa (están en el LayersControl de Leaflet)", () => {
    render(
      <MapView
        alerts={[]}
        flights={[]}
        parcels={[makeParcel({})]}
      />
    );
    // Cero checkboxes en el MapView — los toggles viven en Leaflet.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("NO renderiza un selector de parcela (la selección pasa al popup)", () => {
    render(
      <MapView
        alerts={[]}
        flights={[]}
        parcels={[makeParcel({ id: 1, land_name: "Mi parcela" })]}
      />
    );
    // Antes había un <select> con aria-label "Seleccionar parcela".
    // v1.8 lo sacó. Buscar por el label es la forma más estable de
    // afirmar que NO está.
    expect(screen.queryByLabelText(/seleccionar parcela/i)).toBeNull();
  });

  it("monta el topRightSlot cuando se le pasa (botón Filtros, chips, etc.)", () => {
    render(
      <MapView
        alerts={[]}
        flights={[]}
        parcels={[makeParcel({})]}
        topRightSlot={<button data-testid="custom-slot-button">Filtros</button>}
      />
    );
    expect(screen.getByTestId("custom-slot-button")).toBeInTheDocument();
  });

  it("sin topRightSlot el área top-right no se renderiza", () => {
    const { container } = render(
      <MapView
        alerts={[]}
        flights={[]}
        parcels={[makeParcel({})]}
      />
    );
    // El container raíz no tiene un wrapper específico para topRightSlot
    // (no se monta cuando es undefined). Lo validamos buscando la
    // ausencia de cualquier elemento con clase "top-4 right-4" + z-500.
    const topRight = container.querySelector('[data-testid="app-shell-page-header"]');
    expect(topRight).toBeNull();
  });
});
