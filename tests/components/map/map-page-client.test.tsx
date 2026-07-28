// Tests del MapPageClient (S6 port del V0).
// Mockeamos el `MapView` (que internamente carga MapLibre vía next/dynamic)
// para enfocarnos en el filter rail, los KPIs derivados y los handlers
// de eventos. Los tests del MapLibreView en sí viven en maplibre-view.test.tsx.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { MapPageClient } from "@/components/map/map-page-client";
import type { DjiParcelRecord } from "@/lib/types";
import type { MapFumigationEvent } from "@/lib/map-filter-types";

// Mock de next/dynamic: en tests, el dynamic import de MapView se
// resuelve a un placeholder. No ejercitamos el map acá.
vi.mock("@/components/map-view", () => ({
  MapView: (props: { onMapReady?: (m: unknown) => void }) => {
    // Avisamos al padre que el map está listo con un stub.
    props.onMapReady?.({ fitBounds: vi.fn(), flyTo: vi.fn() } as never);
    return <div data-testid="map-view-mock" />;
  }
}));

const baseParcel: DjiParcelRecord = {
  id: 1,
  external_id: "ext-1",
  land_name: "Porvenir STE 3",
  field_type: "Farmland",
  is_orchard: false,
  spray_geometry: null,
  spray_area_m2: 50000,
  declared_area_ha: 5,
  drone_model_code: 201,
  drone_model_name: "Agras T40 / T50",
  spray_width_m: null,
  work_speed_mps: null,
  optimal_heading_deg: null,
  radar_height_m: null,
  edge_offset_m: null,
  obstacle_offset_m: null,
  climb_height_m: null,
  no_spray_zone_m2: null,
  droplet_size: null,
  sweep_direction: null,
  uses_side_spray: null,
  waypoints_geometry: null,
  waypoint_count: 0,
  source_url_geometry: null,
  source_url_parameter: null,
  source_url_waypoint: null,
  fetched_at: null,
  reference_point: {
    type: "Point",
    coordinates: [-76.5, 3.5]
  },
  last_fumigation_date: "2026-05-01"
};

const parcelOverdue: DjiParcelRecord = { ...baseParcel, id: 1, last_fumigation_date: "2026-05-01" };
const parcelOk: DjiParcelRecord = { ...baseParcel, id: 2, land_name: "La Esperanza 1", last_fumigation_date: "2026-07-20" };
const parcelNoHistory: DjiParcelRecord = { ...baseParcel, id: 3, land_name: "Sin historial SA", last_fumigation_date: null };

const baseEvents: MapFumigationEvent[] = [
  {
    id: 100,
    parcel_id: 1,
    executed_at: "2026-06-15",
    source: "manual",
    area_treated_ha: 5,
    volume_l: 10,
    flights_count: 1,
    lng: -76.5,
    lat: 3.5
  },
  {
    id: 101,
    parcel_id: 2,
    executed_at: "2026-07-10",
    source: "import",
    area_treated_ha: 3,
    volume_l: 6,
    flights_count: 2,
    lng: -76.6,
    lat: 3.6
  }
];

const baseProps = {
  parcels: [parcelOverdue, parcelOk, parcelNoHistory],
  flights: [],
  alerts: [],
  fumigatedParcelIds: new Set<number>(),
  fumigationsByMonth: [
    { key: "2026-01", label: "ene 26", start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 1, 1) - 1, count: 0 },
    { key: "2026-07", label: "jul 26", start: Date.UTC(2026, 6, 1), end: Date.UTC(2026, 7, 1) - 1, count: 5 }
  ] as { key: string; label: string; start: number; end: number; count: number }[]
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("MapPageClient — page header", () => {
  it("muestra el page header con el chip 'X Parcelas' y el botón Mostrar filtros", () => {
    render(<MapPageClient {...baseProps} />);
    expect(screen.getByTestId("map-page-header")).toBeInTheDocument();
    expect(screen.getByTestId("map-page-header-parcel-count").textContent).toMatch(/3 Parcelas/);
    expect(screen.getByTestId("map-page-header-filters-button")).toBeInTheDocument();
  });

  it("el chip refleja el conteo de parcelas filtradas (no el resultCount del server)", () => {
    render(<MapPageClient {...baseProps} />);
    // resultCount del server es 3, pero el header muestra sortedList.length
    // que también es 3 con filtros vacíos. Ambos coinciden.
    const chip = screen.getByTestId("map-page-header-parcel-count");
    expect(chip.textContent).toMatch(/3 Parcelas/);
  });
});

describe("MapPageClient — filter rail (v2.1 S6)", () => {
  it("el drawer arranca colapsado (no se ve el filter rail)", () => {
    render(<MapPageClient {...baseProps} />);
    expect(screen.queryByTestId("map-v0-filter-rail")).not.toBeInTheDocument();
  });

  it("click en 'Mostrar filtros' abre el rail del V0", () => {
    render(<MapPageClient {...baseProps} />);
    fireEvent.click(screen.getByTestId("map-page-header-filters-button"));
    expect(screen.getByTestId("map-v0-filter-rail")).toBeInTheDocument();
  });

  it("el rail muestra el buscador y los 3 selects (cliente/hacienda/modelo)", () => {
    render(<MapPageClient {...baseProps} />);
    fireEvent.click(screen.getByTestId("map-page-header-filters-button"));
    expect(screen.getByTestId("map-v0-search-input")).toBeInTheDocument();
    expect(screen.getByTestId("map-v0-client-select")).toBeInTheDocument();
    expect(screen.getByTestId("map-v0-farm-select")).toBeInTheDocument();
    expect(screen.getByTestId("map-v0-model-select")).toBeInTheDocument();
  });

  it("el rail muestra los 4 status pills y los 3 source pills", () => {
    render(<MapPageClient {...baseProps} />);
    fireEvent.click(screen.getByTestId("map-page-header-filters-button"));
    const statusContainer = screen.getByTestId("map-v0-status-pills");
    expect(within(statusContainer).getAllByRole("button")).toHaveLength(4);
    const sourceContainer = screen.getByTestId("map-v0-source-pills");
    expect(within(sourceContainer).getAllByRole("button")).toHaveLength(3);
  });

  it("el rail muestra 3 toggles de capa (Switch primitive) y 2 botones de basemap", () => {
    render(<MapPageClient {...baseProps} />);
    fireEvent.click(screen.getByTestId("map-page-header-filters-button"));
    const toggles = screen.getByTestId("map-v0-layer-toggles");
    expect(within(toggles).getAllByRole("switch")).toHaveLength(3);
    const basemap = screen.getByTestId("map-v0-basemap-buttons");
    expect(within(basemap).getAllByRole("button")).toHaveLength(2);
  });

  it("el buscador filtra parcelas por nombre (fuzzy includes)", () => {
    render(<MapPageClient {...baseProps} />);
    fireEvent.click(screen.getByTestId("map-page-header-filters-button"));
    const input = screen.getByTestId("map-v0-search-input");
    fireEvent.change(input, { target: { value: "esperanza" } });
    // El chip del header pasa de "3 Parcelas" a "1 Parcela"
    expect(screen.getByTestId("map-page-header-parcel-count").textContent).toMatch(/1 Parcela/);
  });

  it("el pill de cadencia filtra el listado al activarse", () => {
    render(<MapPageClient {...baseProps} />);
    fireEvent.click(screen.getByTestId("map-page-header-filters-button"));
    // Antes: 3 parcelas
    expect(screen.getByTestId("map-page-header-parcel-count").textContent).toMatch(/3 Parcelas/);
    // Activar filtro 'vencido' → quedan 1 parcela (parcelOverdue.id=1)
    fireEvent.click(screen.getByTestId("map-v0-status-pill-vencido"));
    expect(screen.getByTestId("map-page-header-parcel-count").textContent).toMatch(/1 Parcela/);
  });
});

describe("MapPageClient — KPIs (v2.1 S6)", () => {
  it("muestra los 4 KPIs derivados CLIENT-SIDE cuando hay eventos locales", () => {
    render(<MapPageClient {...baseProps} fumigationEvents={baseEvents} />);
    const overlay = screen.getByTestId("map-kpi-overlay");
    expect(overlay).toBeInTheDocument();
    // 2 eventos, 8 ha, 16 L, 3 vuelos
    expect(within(overlay).getByText("2")).toBeInTheDocument();
    expect(within(overlay).getByText(/8\.0 ha/)).toBeInTheDocument();
    expect(within(overlay).getByText(/16\.0 L/)).toBeInTheDocument();
    expect(within(overlay).getByText("3")).toBeInTheDocument();
  });

  it("cae al summary server-side cuando no hay eventos locales", () => {
    render(
      <MapPageClient
        {...baseProps}
        fumigationEvents={[]}
        fumigationsSummary={{ count: 99, areaHa: 12.5, volumeL: 25, flights: 0 }}
      />
    );
    const overlay = screen.getByTestId("map-kpi-overlay");
    expect(within(overlay).getByText("99")).toBeInTheDocument();
    expect(within(overlay).getByText(/12\.5 ha/)).toBeInTheDocument();
  });

  it("no renderiza el overlay si no hay ni eventos ni summary", () => {
    render(<MapPageClient {...baseProps} fumigationEvents={[]} fumigationsSummary={undefined} />);
    expect(screen.queryByTestId("map-kpi-overlay")).not.toBeInTheDocument();
  });
});

describe("MapPageClient — TimeRange", () => {
  it("renderiza el TimeRange cuando hay meses disponibles", () => {
    render(<MapPageClient {...baseProps} />);
    expect(screen.getByTestId("map-time-range-container")).toBeInTheDocument();
  });

  it("no renderiza el TimeRange si no hay meses", () => {
    render(<MapPageClient {...baseProps} fumigationsByMonth={[]} />);
    expect(screen.queryByTestId("map-time-range-container")).not.toBeInTheDocument();
  });
});

describe("MapPageClient — selected parcel", () => {
  it("muestra el detalle de la parcela seleccionada en el rail derecho", () => {
    render(<MapPageClient {...baseProps} fumigationEvents={baseEvents} />);
    // Click en la parcela 1 de la lista
    fireEvent.click(screen.getByTestId("parcels-list-item-1"));
    expect(screen.getByTestId("selected-parcel-status")).toBeInTheDocument();
    expect(screen.getByTestId("selected-parcel-view-detail")).toBeInTheDocument();
    expect(screen.getByTestId("selected-parcel-view-detail").getAttribute("href")).toBe("/parcels/1");
  });

  it("muestra el count de eventos y ha en el detalle cuando hay eventos", () => {
    render(<MapPageClient {...baseProps} fumigationEvents={baseEvents} />);
    fireEvent.click(screen.getByTestId("parcels-list-item-1"));
    // El detalle de la parcela 1 muestra: 1 aplic. (el evento id=100) y 5.0 ha.
    // Ambos textos también aparecen en el ParcelsList item — necesitamos
    // buscar dentro del bloque del detalle. Anclamos con data-testid.
    const detail = screen.getByTestId("selected-parcel-detail");
    expect(within(detail).getByText(/1 aplic\./)).toBeInTheDocument();
    expect(within(detail).getByText(/5\.0 ha/)).toBeInTheDocument();
  });

  it("no rompe si se selecciona una parcela y luego se cambia de filtro que la incluye", () => {
    render(<MapPageClient {...baseProps} />);
    fireEvent.click(screen.getByTestId("parcels-list-item-1"));
    expect(screen.getByTestId("selected-parcel-view-detail")).toBeInTheDocument();
    // Aplicar un filtro que SÍ incluya la parcela 1 (vencido).
    fireEvent.click(screen.getByTestId("map-page-header-filters-button"));
    fireEvent.click(screen.getByTestId("map-v0-status-pill-vencido"));
    // El detalle se mantiene: la parcela sigue seleccionada y sigue
    // pasando el filtro.
    expect(screen.getByTestId("selected-parcel-view-detail")).toBeInTheDocument();
    expect(screen.getByTestId("map-page-header-parcel-count").textContent).toMatch(/1 Parcela/);
  });
});
