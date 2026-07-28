// Tests básicos del MapLibreView (mocks de maplibre-gl).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Mock de maplibre-gl. El componente hace `await import("maplibre-gl")`
// y crea el Map en un useEffect, así que necesitamos una clase fake que
// no toque WebGL. Devolvemos un Map no-op + NavigationControl + ScaleControl
// + Popup mínimos.
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
mockMapInstance.getLayer = vi.fn(() => undefined as unknown);
mockMapInstance.getSource = vi.fn(() => undefined as unknown);
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
  waypoint_count: 0
};

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
