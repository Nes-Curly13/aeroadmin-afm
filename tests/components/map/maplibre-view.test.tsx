// Tests básicos del MapLibreView (mocks de maplibre-gl).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// Mock de maplibre-gl. El componente hace `await import("maplibre-gl")`
// y crea el Map en un useEffect, así que necesitamos una clase fake que
// no toque WebGL. Devolvemos un Map no-op + NavigationControl + ScaleControl
// + Popup mínimos.
//
// v2.1 (sprint S6.1) — `getLayer` y `getSource` devuelven truthy para los
// ids de la capa de fumigaciones. Esto refleja el comportamiento de
// MapLibre en producción (después de `addLayer`/`addSource`, el layer/source
// existe y los efectos de visibility + data pueden operarlo). Sin esto,
// los tests que validan `setLayoutProperty`/`setData` no verían ninguna
// call (los toggles cortocircuitan si `getLayer`/`getSource` devuelven
// `undefined`).
const mockSetData = vi.fn();
const mockMapInstance: Record<string, ReturnType<typeof vi.fn>> = {};
mockMapInstance.addControl = vi.fn();
mockMapInstance.addSource = vi.fn();
mockMapInstance.addLayer = vi.fn();
mockMapInstance.on = vi.fn();
mockMapInstance.off = vi.fn();
mockMapInstance.once = vi.fn();
mockMapInstance.remove = vi.fn();
mockMapInstance.setStyle = vi.fn();
mockMapInstance.setLayoutProperty = vi.fn();
mockMapInstance.getLayer = vi.fn((id?: string) =>
  id === "fumigation-events-circle" ? { id } : undefined
);
mockMapInstance.getSource = vi.fn((id?: string) =>
  id === "fumigation-events" ? { setData: mockSetData } : undefined
);
mockMapInstance.getCanvas = vi.fn(() => ({ style: { cursor: "" } } as unknown as HTMLCanvasElement));
mockMapInstance.setFeatureState = vi.fn();
mockMapInstance.removeFeatureState = vi.fn();
mockMapInstance.flyTo = vi.fn();
mockMapInstance.fitBounds = vi.fn();
mockMapInstance.queryRenderedFeatures = vi.fn(() => [] as never);

function MockMap(_opts: unknown) {
  // Disparar load async para que el componente termine de inicializar.
  Promise.resolve().then(() => {
    const handler = (mockMapInstance.on as unknown as { mock: { calls: Array<[string, (...args: unknown[]) => void]> } }).mock.calls
      .find((c) => c[0] === "load")?.[1];
    handler?.();
  });
  return mockMapInstance as unknown as import("maplibre-gl").Map;
}

vi.mock("maplibre-gl", () => {
  return {
    default: {
      Map: MockMap,
      NavigationControl: vi.fn(),
      ScaleControl: vi.fn(),
      Popup: vi.fn().mockImplementation(function () {
        return { setLngLat: vi.fn().mockReturnThis(), setHTML: vi.fn().mockReturnThis(), addTo: vi.fn() };
      })
    },
    Map: MockMap,
    NavigationControl: vi.fn(),
    ScaleControl: vi.fn(),
    Popup: vi.fn()
  };
});

import { MapLibreView } from "@/components/map/maplibre-view";
import type { DjiParcelRecord } from "@/lib/types";
import type { MapFumigationEvent } from "@/lib/map-filter-types";

// Fixture mínima válida de DjiParcelRecord para los tests. Los campos
// que el componente NO usa quedan en null/default.
const baseParcel: DjiParcelRecord = {
  id: 1,
  external_id: "ext-1",
  land_name: "Porvenir STE 3",
  field_type: "Farmland",
  is_orchard: false,
  spray_geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-76.53, 3.45],
        [-76.52, 3.45],
        [-76.52, 3.46],
        [-76.53, 3.46],
        [-76.53, 3.45]
      ]
    ]
  },
  spray_area_m2: 50000,
  declared_area_ha: 5,
  drone_model_code: null,
  drone_model_name: null,
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
  reference_point: null
};

// Fixture de un evento de fumigación con coords (necesarias para que
// el `fumigationEventsToFeatureCollection` lo incluya como Point).
const baseFumigationEvent: MapFumigationEvent = {
  id: 9001,
  parcel_id: 1,
  executed_at: "2026-07-15",
  source: "manual",
  area_treated_ha: 3.2,
  volume_l: 6.4,
  flights_count: 2,
  lng: -76.525,
  lat: 3.455
};

/**
 * Helper: espera a que el Map termine de inicializar. El componente
 * monta el map en un useEffect que dispara el callback `on("load")`
 * en un microtask asíncrono. Sin este await, los tests verían el map
 * en estado `ready=false` y los data effects no habrían corrido.
 */
async function flushMapReady() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("MapLibreView", () => {
  it("renderiza el container con role=application y aria-label", () => {
    render(<MapLibreView parcels={[]} alerts={[]} flights={[]} />);
    const container = screen.getByRole("application", { name: "Mapa de parcelas de caña" });
    expect(container).toBeInTheDocument();
  });

  it("muestra el loading state inicial", () => {
    render(<MapLibreView parcels={[]} alerts={[]} flights={[]} />);
    expect(screen.getByText("Cargando cartografía…")).toBeInTheDocument();
  });

  it("renderiza el basemap badge (boton toggle satellite/streets)", () => {
    render(<MapLibreView parcels={[]} alerts={[]} flights={[]} />);
    const badge = screen.getByTestId("maplibre-basemap-badge");
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute("aria-label")).toMatch(/click para cambiar/i);
  });

  it("no rompe con parcels vacios", () => {
    expect(() => render(<MapLibreView parcels={[]} alerts={[]} flights={[]} />)).not.toThrow();
  });

  it("no rompe con parcels y fumigatedParcelIds", () => {
    const fumigated = new Set<number>([1, 2, 3]);
    expect(() =>
      render(
        <MapLibreView
          parcels={[baseParcel]}
          alerts={[]}
          flights={[]}
          fumigatedParcelIds={fumigated}
        />
      )
    ).not.toThrow();
  });

  it("se puede ocultar el control UI con hideControls", () => {
    render(<MapLibreView parcels={[]} alerts={[]} flights={[]} hideControls />);
    expect(screen.queryByTestId("maplibre-basemap-badge")).not.toBeInTheDocument();
  });
});

// v2.1 (sprint S6.1 — V0 events map) — capa de fumigaciones
describe("MapLibreView — fumigation events", () => {
  it("agrega source fumigation-events y layer fumigation-events-circle al init", async () => {
    render(<MapLibreView parcels={[]} alerts={[]} flights={[]} />);
    await flushMapReady();
    // El source se agrega con el id correcto.
    const sourceCalls = (mockMapInstance.addSource as unknown as { mock: { calls: Array<[string, unknown]> } }).mock.calls;
    expect(sourceCalls.map((c) => c[0])).toContain("fumigation-events");
    // La layer se agrega con el id correcto.
    const layerCalls = (mockMapInstance.addLayer as unknown as { mock: { calls: Array<[unknown]> } }).mock.calls;
    const layerIds = layerCalls.map((c) => (c[0] as { id: string }).id);
    expect(layerIds).toContain("fumigation-events-circle");
  });

  it("el layer fumigation-events-circle tiene paint expression de color por source (match djiscraper/import/manual)", async () => {
    render(<MapLibreView parcels={[]} alerts={[]} flights={[]} />);
    await flushMapReady();
    const layerCalls = (mockMapInstance.addLayer as unknown as { mock: { calls: Array<[unknown]> } }).mock.calls;
    const eventLayer = layerCalls.map((c) => c[0]).find((l) => (l as { id: string }).id === "fumigation-events-circle") as
      | { paint: Record<string, unknown> }
      | undefined;
    expect(eventLayer).toBeDefined();
    // El paint-color es un match expression con las 3 sources del V0.
    const colorExpr = eventLayer!.paint["circle-color"] as unknown[];
    expect(Array.isArray(colorExpr)).toBe(true);
    expect(colorExpr[0]).toBe("match");
    // El array del match debe incluir los 3 sources con sus colores hex.
    const json = JSON.stringify(colorExpr);
    expect(json).toContain("djiscraper");
    expect(json).toContain("#3b82f6");
    expect(json).toContain("import");
    expect(json).toContain("#a855f7");
    expect(json).toContain("manual");
    expect(json).toContain("#fbbf24");
  });

  it("el layer fumigation-events-circle tiene circle-radius interpolado por zoom (3→12)", async () => {
    render(<MapLibreView parcels={[]} alerts={[]} flights={[]} />);
    await flushMapReady();
    const layerCalls = (mockMapInstance.addLayer as unknown as { mock: { calls: Array<[unknown]> } }).mock.calls;
    const eventLayer = layerCalls.map((c) => c[0]).find((l) => (l as { id: string }).id === "fumigation-events-circle") as
      | { paint: Record<string, unknown> }
      | undefined;
    expect(eventLayer).toBeDefined();
    const radiusExpr = eventLayer!.paint["circle-radius"] as unknown[];
    expect(Array.isArray(radiusExpr)).toBe(true);
    expect(radiusExpr[0]).toBe("interpolate");
    // El rango de zoom debe incluir 3 (zoom bajo) y 12 (zoom alto).
    const json = JSON.stringify(radiusExpr);
    expect(json).toMatch(/3[,\]]/);
    expect(json).toContain("12");
  });

  it("showEvents=false oculta el layer (visibility: none)", async () => {
    render(<MapLibreView parcels={[]} alerts={[]} flights={[]} showEvents={false} />);
    await flushMapReady();
    // El componente llama setLayoutProperty(visibility, none) en el
    // toggle effect. Filtramos por la layer id correcta.
    const layoutCalls = (mockMapInstance.setLayoutProperty as unknown as {
      mock: { calls: Array<[string, string, string]> };
    }).mock.calls;
    const eventLayerCalls = layoutCalls.filter((c) => c[0] === "fumigation-events-circle");
    expect(eventLayerCalls.length).toBeGreaterThan(0);
    // El último call debería setear visibility = "none" (toggle off).
    const lastCall = eventLayerCalls[eventLayerCalls.length - 1];
    expect(lastCall[1]).toBe("visibility");
    expect(lastCall[2]).toBe("none");
  });

  it("showEvents=true (default) deja la layer visible (no se llama setLayoutProperty con 'none' para events)", async () => {
    render(<MapLibreView parcels={[]} alerts={[]} flights={[]} />);
    await flushMapReady();
    // Por default, showEvents=true → el toggle effect no debería haber
    // puesto visibility=none para la layer de events. Buscamos llamadas
    // que oculten esa layer específica.
    const layoutCalls = (mockMapInstance.setLayoutProperty as unknown as {
      mock: { calls: Array<[string, string, string]> };
    }).mock.calls;
    const eventHiddenCalls = layoutCalls.filter(
      (c) => c[0] === "fumigation-events-circle" && c[1] === "visibility" && c[2] === "none"
    );
    expect(eventHiddenCalls).toHaveLength(0);
  });

  it("pasa los fumigationEvents al source (data effect llama setData)", async () => {
    render(
      <MapLibreView
        parcels={[]}
        alerts={[]}
        flights={[]}
        fumigationEvents={[baseFumigationEvent]}
      />
    );
    await flushMapReady();
    // El data effect llama getSource("fumigation-events").setData(collection).
    // El mock a nivel de módulo devuelve `{ setData: mockSetData }` para
    // ese id, así que la call queda registrada en `mockSetData` y podemos
    // inspeccionarla directamente.
    expect(mockSetData).toHaveBeenCalled();
    const arg = mockSetData.mock.calls[0][0] as {
      type: string;
      features: Array<{ properties: Record<string, unknown> }>;
    };
    expect(arg.type).toBe("FeatureCollection");
    expect(arg.features).toHaveLength(1);
    expect(arg.features[0].properties.id).toBe(9001);
    expect(arg.features[0].properties.source).toBe("manual");
  });

  it("filtra eventos sin lng/lat (no los incluye como feature)", async () => {
    render(
      <MapLibreView
        parcels={[]}
        alerts={[]}
        flights={[]}
        fumigationEvents={[
          baseFumigationEvent,
          { ...baseFumigationEvent, id: 9003, lng: null, lat: null }
        ]}
      />
    );
    await flushMapReady();
    // El setData spy es el mismo mockSetData del módulo, así que la
    // última call refleja el último render.
    expect(mockSetData).toHaveBeenCalled();
    const lastCall = mockSetData.mock.calls[mockSetData.mock.calls.length - 1][0] as {
      features: unknown[];
    };
    // Solo el evento con coords debe quedar.
    expect(lastCall.features).toHaveLength(1);
  });

  it("bind click handler para fumigation-events-circle (mouseenter/mouseleave registrados)", async () => {
    render(<MapLibreView parcels={[]} alerts={[]} flights={[]} />);
    await flushMapReady();
    // El componente registra handlers via map.on("click", "fumigation-events-circle", ...)
    // y map.on("mouseenter", "fumigation-events-circle", ...). Filtramos las
    // calls de map.on.
    const onCalls = (mockMapInstance.on as unknown as {
      mock: { calls: Array<[string, string, ...unknown[]]> };
    }).mock.calls;
    const eventLayerHandlers = onCalls.filter((c) => c[1] === "fumigation-events-circle");
    const eventTypes = eventLayerHandlers.map((c) => c[0]);
    expect(eventTypes).toContain("click");
    expect(eventTypes).toContain("mouseenter");
    expect(eventTypes).toContain("mouseleave");
  });
});
