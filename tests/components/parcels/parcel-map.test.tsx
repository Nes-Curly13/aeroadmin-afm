// tests/components/parcels/parcel-map.test.tsx
//
// Tests del ParcelMap (Sprint v0.1 — port del V0).
// Cubre:
//   - Render del container con role=application y aria-label.
//   - Loading state inicial (antes de que maplibre termine de inicializar).
//   - Mock de maplibre-gl: verifica que se llama con las opciones correctas
//     (incluyendo las interacciones DESHABILITADAS — el contrato del
//     "no interactions excepto zoom limitado" del spec).
//   - Source/layer del polígono se agrega cuando geom es Polygon.
//   - Source/layer del polígono se agrega cuando geom es MultiPolygon.
//   - NO se agrega parcel source cuando geom es null.
//   - Source/layer de flights se agrega siempre (con o sin geom).
//   - fitBounds se llama cuando hay geom.
//   - Cleanup en unmount: map.remove().
//   - data-slot="parcel-map" presente.
//
// Patrón de mock: similar a `tests/components/map/maplibre-view.test.tsx`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Mock maplibre-gl. Devolvemos un Map no-op + clases necesarias.
// Importante: necesitamos capturar las options del constructor para
// verificar que las interacciones están bien configuradas.
const constructorCalls: Array<Record<string, unknown>> = [];

const mockMapInstance: Record<string, ReturnType<typeof vi.fn>> = {};
mockMapInstance.addControl = vi.fn();
mockMapInstance.addSource = vi.fn();
mockMapInstance.addLayer = vi.fn();
mockMapInstance.on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
  // Disparar load async para que el componente termine de inicializar
  // (igual que en maplibre-view.test.tsx).
  if (event === "load") {
    Promise.resolve().then(() => handler());
  }
  return mockMapInstance as unknown as import("maplibre-gl").Map;
});
mockMapInstance.off = vi.fn();
mockMapInstance.once = vi.fn();
mockMapInstance.remove = vi.fn();
mockMapInstance.setStyle = vi.fn();
mockMapInstance.setLayoutProperty = vi.fn();
mockMapInstance.getLayer = vi.fn(() => undefined as unknown);
mockMapInstance.getSource = vi.fn(() => undefined as unknown);
mockMapInstance.getCanvas = vi.fn(() => ({ style: { cursor: "" } } as unknown as HTMLCanvasElement));
mockMapInstance.setFeatureState = vi.fn();
mockMapInstance.removeFeatureState = vi.fn();
mockMapInstance.flyTo = vi.fn();
mockMapInstance.fitBounds = vi.fn();
mockMapInstance.queryRenderedFeatures = vi.fn(() => [] as never);

function MockMap(opts: Record<string, unknown>) {
  constructorCalls.push(opts);
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

import { ParcelMap } from "@/components/parcels/parcel-map";

// =====================================================================
// Fixtures
// =====================================================================

const SQUARE_POLYGON: GeoJSON.Polygon = {
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
};

const MULTI_POLYGON: GeoJSON.MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [-76.53, 3.45],
        [-76.525, 3.45],
        [-76.525, 3.455],
        [-76.53, 3.455],
        [-76.53, 3.45]
      ]
    ],
    [
      [
        [-76.51, 3.45],
        [-76.505, 3.45],
        [-76.505, 3.455],
        [-76.51, 3.455],
        [-76.51, 3.45]
      ]
    ]
  ]
};

beforeEach(() => {
  vi.clearAllMocks();
  constructorCalls.length = 0;
});

afterEach(() => {
  cleanup();
});

// =====================================================================
// Tests
// =====================================================================

describe("ParcelMap", () => {
  it("renderiza el container con role=application y aria-label", () => {
    render(<ParcelMap geom={SQUARE_POLYGON} color="#0b5f2d" flights={[]} />);
    const container = screen.getByRole("application", { name: "Geometría de la parcela" });
    expect(container).toBeInTheDocument();
  });

  it("muestra el loading state inicial (antes del map.on('load'))", () => {
    // El loading se muestra en el primer render y desaparece cuando
    // `ready=true` (después del callback 'load' de maplibre). En
    // jsdom con el mock, el callback es async (Promise.resolve) —
    // verificamos que el loading se muestra SÍNCRONAMENTE en el render
    // inicial.
    render(<ParcelMap geom={SQUARE_POLYGON} color="#0b5f2d" flights={[]} />);
    expect(screen.getByTestId("parcel-map-loading")).toBeInTheDocument();
  });

  it("data-slot='parcel-map' está presente", () => {
    render(<ParcelMap geom={SQUARE_POLYGON} color="#0b5f2d" flights={[]} />);
    expect(screen.getByTestId("parcel-map").getAttribute("data-slot")).toBe("parcel-map");
  });

  it("inicializa el mapa con scrollZoom y doubleClickZoom activos, dragPan OFF", async () => {
    // "no interactions excepto zoom limitado" — el spec dice SOLO zoom.
    // Verificamos que las interacciones de navegación están OFF.
    render(<ParcelMap geom={SQUARE_POLYGON} color="#0b5f2d" flights={[]} />);
    // Esperar microtasks para que el dynamic import se resuelva.
    await vi.waitFor(() => {
      expect(constructorCalls.length).toBeGreaterThan(0);
    });
    const opts = constructorCalls[0]!;
    // Zoom limitado habilitado.
    expect(opts.scrollZoom).toBe(true);
    expect(opts.doubleClickZoom).toBe(true);
    // Resto OFF.
    expect(opts.dragPan).toBe(false);
    expect(opts.dragRotate).toBe(false);
    expect(opts.boxZoom).toBe(false);
    expect(opts.keyboard).toBe(false);
    expect(opts.touchZoomRotate).toBe(false);
    expect(opts.touchPitch).toBe(false);
    // Zoom limits.
    expect(opts.minZoom).toBe(10);
    expect(opts.maxZoom).toBe(18);
  });

  it("con Polygon: agrega source y layers de parcel con el color custom", async () => {
    render(<ParcelMap geom={SQUARE_POLYGON} color="#ff0000" flights={[]} />);
    await vi.waitFor(() => {
      // El callback 'load' agrega source + 3 layers (parcel-fill, parcel-line, flights-circle).
      expect(mockMapInstance.addSource).toHaveBeenCalledWith(
        "parcel",
        expect.objectContaining({ type: "geojson" })
      );
    });
    // Verificamos que el color del fill y del line son los del prop.
    const addLayerCalls = (mockMapInstance.addLayer as unknown as { mock: { calls: Array<[{ id: string; paint?: Record<string, unknown> }]> } }).mock.calls;
    const fillLayer = addLayerCalls.find((c) => c[0].id === "parcel-fill")?.[0];
    const lineLayer = addLayerCalls.find((c) => c[0].id === "parcel-line")?.[0];
    expect(fillLayer?.paint?.["fill-color"]).toBe("#ff0000");
    expect(lineLayer?.paint?.["line-color"]).toBe("#ff0000");
  });

  it("con MultiPolygon: también agrega source y layers de parcel", async () => {
    render(<ParcelMap geom={MULTI_POLYGON} color="#0b5f2d" flights={[]} />);
    await vi.waitFor(() => {
      expect(mockMapInstance.addSource).toHaveBeenCalledWith(
        "parcel",
        expect.objectContaining({ type: "geojson" })
      );
    });
  });

  it("con geom=null: NO agrega parcel source (modo fallback)", async () => {
    render(<ParcelMap geom={null} color="#0b5f2d" flights={[]} />);
    // Esperamos un tick para que el load handler corra.
    await new Promise((r) => setTimeout(r, 0));
    const addSourceCalls = (mockMapInstance.addSource as unknown as { mock: { calls: Array<[string]> } }).mock.calls;
    const parcelSourceCall = addSourceCalls.find((c) => c[0] === "parcel");
    expect(parcelSourceCall).toBeUndefined();
    // PERO flights source SÍ se agrega.
    const flightsSourceCall = addSourceCalls.find((c) => c[0] === "flights");
    expect(flightsSourceCall).toBeDefined();
  });

  it("agrega flights source y layer siempre (con o sin flights, lista vacía cuenta)", async () => {
    render(<ParcelMap geom={SQUARE_POLYGON} color="#0b5f2d" flights={[]} />);
    await vi.waitFor(() => {
      expect(mockMapInstance.addSource).toHaveBeenCalledWith(
        "flights",
        expect.objectContaining({ type: "geojson" })
      );
    });
  });

  it("fitBounds se llama cuando hay geom (Polygon)", async () => {
    render(<ParcelMap geom={SQUARE_POLYGON} color="#0b5f2d" flights={[]} />);
    await vi.waitFor(() => {
      expect(mockMapInstance.fitBounds).toHaveBeenCalled();
    });
  });

  it("fitBounds se llama con MultiPolygon también", async () => {
    render(<ParcelMap geom={MULTI_POLYGON} color="#0b5f2d" flights={[]} />);
    await vi.waitFor(() => {
      expect(mockMapInstance.fitBounds).toHaveBeenCalled();
    });
  });

  it("con geom=null: fitBounds NO se llama (modo fallback usa center+zoom)", async () => {
    render(<ParcelMap geom={null} color="#0b5f2d" flights={[]} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockMapInstance.fitBounds).not.toHaveBeenCalled();
    // En su lugar, center y zoom están seteados.
    const opts = constructorCalls[0]!;
    expect(opts.center).toBeDefined();
    expect(opts.zoom).toBeDefined();
  });

  it("con geom tipo Point (raro): no rompe, no agrega parcel source", async () => {
    const pointGeom: GeoJSON.Point = { type: "Point", coordinates: [-76.5, 3.45] };
    render(<ParcelMap geom={pointGeom} color="#0b5f2d" flights={[]} />);
    await new Promise((r) => setTimeout(r, 0));
    const addSourceCalls = (mockMapInstance.addSource as unknown as { mock: { calls: Array<[string]> } }).mock.calls;
    expect(addSourceCalls.find((c) => c[0] === "parcel")).toBeUndefined();
  });

  it("cleanup en unmount: llama map.remove()", async () => {
    const { unmount } = render(<ParcelMap geom={SQUARE_POLYGON} color="#0b5f2d" flights={[]} />);
    await vi.waitFor(() => {
      expect(constructorCalls.length).toBeGreaterThan(0);
    });
    unmount();
    expect(mockMapInstance.remove).toHaveBeenCalled();
  });

  it("pasa los flights al source (verificable en la llamada a addSource)", async () => {
    const flights = [
      { id: 1, lng: -76.53, lat: 3.45, pilot: "Juan" },
      { id: 2, lng: -76.52, lat: 3.46, pilot: "Carlos" }
    ];
    render(<ParcelMap geom={SQUARE_POLYGON} color="#0b5f2d" flights={flights} />);
    await vi.waitFor(() => {
      expect(mockMapInstance.addSource).toHaveBeenCalledWith(
        "flights",
        expect.objectContaining({
          data: expect.objectContaining({
            type: "FeatureCollection",
            features: expect.arrayContaining([
              expect.objectContaining({
                type: "Feature",
                properties: expect.objectContaining({ pilot: "Juan" })
              })
            ])
          })
        })
      );
    });
  });
});
