/**
 * Tests del toggle de basemap (satellite / streets) en MapClient.
 *
 * v1.2 / Track C: el supervisor de zona cañera necesita vista satélite
 * para identificar linderos, cultivos y referencias físicas. La CSP
 * actual permite *.tile.openstreetmap.org; en este PR se suma
 * server.arcgisonline.com (World_Imagery) y un toggle client-side
 * con persistencia en localStorage.
 *
 * Decisiones cubiertas por los tests:
 *   1. Default = "satellite" (más útil en zona cañera).
 *   2. La elección del usuario se persiste en localStorage bajo
 *      la clave "afm:map:basemap".
 *   3. Si localStorage no está disponible (modo privado, deshabilitado)
 *      o tiene un valor inválido, se cae al default.
 *   4. Click en el badge alterna satellite <-> streets (toggle, no radio).
 *   5. Solo se renderiza UN TileLayer activo (no se duplican los fetch).
 *   6. Atribución correcta de OSM y Esri en cada layer.
 *
 * Patrón: mock de react-leaflet (jsdom no soporta Leaflet real) +
 * paso de props críticos (url, attribution) vía data-* para que las
 * aserciones reflejen el comportamiento del componente real sin
 * necesitar un mapa montado. Mismo patrón que
 * tests/components/task-history/map-view-load.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { DjiParcelRecord } from "@/lib/types";

// Mock react-leaflet: jsdom no soporta las APIs de Leaflet reales.
// El mock preserva url y attribution vía data-* para que las
// aserciones reflejen el comportamiento del componente real.
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-map-container">{children}</div>
  ),
  TileLayer: ({ url, attribution }: { url: string; attribution: string }) => (
    <div
      data-attribution={attribution}
      data-testid="mock-tile-layer"
      data-url={url}
    />
  ),
  LayersControl: Object.assign(
    ({ children }: { children: React.ReactNode }) => (
      <div data-testid="mock-layers-control">{children}</div>
    ),
    {
      Overlay: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="mock-layers-overlay">{children}</div>
      )
    }
  ),
  GeoJSON: () => <div data-testid="mock-geojson" />,
  Polyline: () => <div data-testid="mock-polyline" />,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CircleMarker: () => <div data-testid="mock-circle-marker" />,
  useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn() })
}));

// Mock leaflet (L.Icon.Default) — el componente hace un mergeOptions
// en useEffect. Sin esto, jsdom revienta con "Cannot read property
// 'prototype' of undefined".
vi.mock("leaflet", () => ({
  default: {
    Icon: {
      Default: {
        prototype: {},
        mergeOptions: vi.fn()
      }
    },
    circleMarker: vi.fn(),
    GeoJSON: {}
  },
  Icon: {
    Default: {
      prototype: {},
      mergeOptions: vi.fn()
    }
  },
  circleMarker: vi.fn(),
  GeoJSON: {}
}));

// Mock el CSS de Leaflet.
vi.mock("leaflet/dist/leaflet.css", () => ({}));

// Mock de los helpers de lib/ que el componente usa — no los necesitamos
// para verificar el basemap, pero sin mocks rompen en runtime.
vi.mock("@/lib/flight-plan", () => ({
  waypointsToFlightPlan: vi.fn(() => null)
}));

vi.mock("@/lib/flight-plan-styles", () => ({
  getFlightPlanStyle: vi.fn(() => ({}))
}));

vi.mock("@/lib/map-parcel-content", () => ({
  bindParcelLayerInteractions: vi.fn(),
  resolveFeatureStyle: vi.fn(() => ({}))
}));

vi.mock("@/lib/map-styles", () => ({
  getAlertPolygonStyle: vi.fn(() => ({})),
  getParcelPolygonStyle: vi.fn(() => ({}))
}));

import { MapClient } from "@/components/map-client";

const STORAGE_KEY = "afm:map:basemap";
const ESRI_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ESRI_ATTRIBUTION = "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community";

/** Parcela mínima con geometría válida para que MapClient renderice sin romperse. */
function makeParcel(): DjiParcelRecord {
  return {
    id: 1,
    external_id: "ext-1",
    land_name: "Parcela test",
    field_type: "Farmland",
    declared_area_ha: 1.5,
    spray_area_m2: 15_000,
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
    spray_geometry: {
      type: "Polygon",
      coordinates: [[[-76.5, 3.4], [-76.5, 3.5], [-76.4, 3.5], [-76.4, 3.4], [-76.5, 3.4]]]
    },
    reference_point: null,
    waypoints_geometry: null,
    waypoint_count: 0,
    source_url_geometry: null,
    source_url_parameter: null,
    source_url_waypoint: null,
    fetched_at: "2026-07-20T00:00:00Z"
  };
}

describe("MapClient — basemap toggle (v1.2 Track C)", () => {
  beforeEach(() => {
    // Cada test arranca con localStorage limpio.
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    // Restaura cualquier vi.spyOn que el test haya dejado (importante
    // para los tests de localStorage que mockean getItem/setItem con throw).
    vi.restoreAllMocks();
  });

  it("renderiza con basemap 'satellite' por default", () => {
    render(<MapClient parcels={[makeParcel()]} flights={[]} alerts={[]} />);

    // Solo debe haber UN TileLayer activo (no se duplican los fetch).
    const tiles = screen.getAllByTestId("mock-tile-layer");
    expect(tiles).toHaveLength(1);

    // Y es el de Esri (satellite), no el de OSM.
    expect(tiles[0].getAttribute("data-url")).toBe(ESRI_URL);
  });

  it("muestra el badge con el label 'Satélite' cuando el basemap es satellite", () => {
    render(<MapClient parcels={[makeParcel()]} flights={[]} alerts={[]} />);
    expect(screen.getByRole("button", { name: /sat[ée]lite/i })).toBeInTheDocument();
  });

  it("lee la elección guardada en localStorage al montar (valor 'streets')", () => {
    window.localStorage.setItem(STORAGE_KEY, "streets");
    render(<MapClient parcels={[makeParcel()]} flights={[]} alerts={[]} />);

    const tiles = screen.getAllByTestId("mock-tile-layer");
    expect(tiles).toHaveLength(1);
    expect(tiles[0].getAttribute("data-url")).toBe(OSM_URL);
    expect(screen.getByRole("button", { name: /calles/i })).toBeInTheDocument();
  });

  it("hace click en el badge para alternar entre satellite y streets", () => {
    render(<MapClient parcels={[makeParcel()]} flights={[]} alerts={[]} />);

    // Estado inicial: satellite.
    let tiles = screen.getAllByTestId("mock-tile-layer");
    expect(tiles[0].getAttribute("data-url")).toBe(ESRI_URL);
    const badge = screen.getByRole("button", { name: /sat[ée]lite/i });
    expect(badge).toBeInTheDocument();

    // Click → alterna a streets.
    fireEvent.click(badge);
    tiles = screen.getAllByTestId("mock-tile-layer");
    expect(tiles[0].getAttribute("data-url")).toBe(OSM_URL);
    expect(screen.getByRole("button", { name: /calles/i })).toBeInTheDocument();

    // Click otra vez → vuelve a satellite.
    fireEvent.click(screen.getByRole("button", { name: /calles/i }));
    tiles = screen.getAllByTestId("mock-tile-layer");
    expect(tiles[0].getAttribute("data-url")).toBe(ESRI_URL);
    expect(screen.getByRole("button", { name: /sat[ée]lite/i })).toBeInTheDocument();
  });

  it("persiste la elección del usuario en localStorage", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    render(<MapClient parcels={[makeParcel()]} flights={[]} alerts={[]} />);

    // Estado inicial: satellite (default). La persistencia ocurre
    // después de mount vía useEffect, así que esperamos con waitFor.
    await waitFor(() => {
      expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEY, "satellite");
    });

    // Click → alterna a streets y persiste el nuevo valor.
    fireEvent.click(screen.getByRole("button", { name: /sat[ée]lite/i }));
    await waitFor(() => {
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("streets");
    });

    setItemSpy.mockRestore();
  });

  it("incluye la atribución correcta de Esri cuando el basemap es satellite", () => {
    render(<MapClient parcels={[makeParcel()]} flights={[]} alerts={[]} />);
    const tiles = screen.getAllByTestId("mock-tile-layer");
    const attr = tiles[0].getAttribute("data-attribution") ?? "";
    expect(attr).toContain("Esri");
    expect(attr).toContain("Source: Esri");
  });

  it("incluye la atribución correcta de OSM cuando el basemap es streets", () => {
    window.localStorage.setItem(STORAGE_KEY, "streets");
    render(<MapClient parcels={[makeParcel()]} flights={[]} alerts={[]} />);
    const tiles = screen.getAllByTestId("mock-tile-layer");
    const attr = tiles[0].getAttribute("data-attribution") ?? "";
    expect(attr).toContain("OpenStreetMap");
    expect(attr).toContain("openstreetmap.org/copyright");
  });

  it("usa el default 'satellite' si localStorage no está disponible (modo privado)", () => {
    // Simulamos localStorage roto: getItem y setItem throw.
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: localStorage no disponible");
    });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError: localStorage no disponible");
    });

    // El componente debe renderear sin crashear y caer al default.
    expect(() =>
      render(<MapClient parcels={[makeParcel()]} flights={[]} alerts={[]} />)
    ).not.toThrow();

    const tiles = screen.getAllByTestId("mock-tile-layer");
    expect(tiles[0].getAttribute("data-url")).toBe(ESRI_URL);

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it("usa el default 'satellite' si localStorage tiene un valor inválido", () => {
    // localStorage con valor corrupto (no es "satellite" ni "streets").
    window.localStorage.setItem(STORAGE_KEY, "garbage-value");

    render(<MapClient parcels={[makeParcel()]} flights={[]} alerts={[]} />);

    const tiles = screen.getAllByTestId("mock-tile-layer");
    expect(tiles[0].getAttribute("data-url")).toBe(ESRI_URL);

    // Y la elección inválida debe corregirse en la próxima escritura
    // (no debe quedar "garbage" persistido).
    const stored = window.localStorage.getItem(STORAGE_KEY);
    expect(stored).toBe("satellite");
  });
});
