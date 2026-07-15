/**
 * Load test del MapView del Task History (Sprint 2 / feature estrella).
 *
 * El endpoint /api/task-history puede devolver hasta ~1207 polígonos
 * (1 por parcela fumigada, en el peor caso). El MapView los renderiza
 * como CircleMarkers via react-leaflet.
 *
 * Este test cubre 3 contratos:
 *   (a) Render con 1207 features sintéticas (misma shape que produce
 *       `lib/djiag-spatial-aggregator.ts`). Mide tiempo de primer render.
 *       Threshold: 1500ms en jsdom. Si pasa, queda como guard de
 *       regresión contra un futuro cambio que vuelva el mapa O(n²).
 *   (b) Verifica que con 1207 parcelId únicos, no haya warnings de
 *       React por keys duplicadas. Si la fuente de datos se rompe
 *       (ej. JOIN que duplica filas), el test lo detecta antes que
 *       el usuario.
 *   (c) Verifica que polígonos con `geometry: null` no rompen el
 *       render y no producen markers (filtrado silencioso). Hay ~2
 *       parcelas con spray_geom NULL hoy (ver figma-vs-bd.md gap #1).
 *
 * jsdom no soporta `react-leaflet` real (necesita APIs de browser),
 * por eso mockeamos los componentes como passthroughs. El mock
 * preserva la shape de los props (center) para que las aserciones
 * sobre cantidad y unicidad reflejen el comportamiento del componente
 * real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Mock react-leaflet: jsdom no soporta las APIs de Leaflet (Map, TileLayer).
// Pasamos los props críticos a un div testeable para poder contar y
// verificar unicidad sin tener un mapa real.
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="mock-tile-layer" />,
  ZoomControl: () => <div data-testid="mock-zoom-control" />,
  CircleMarker: ({
    children,
    center,
    eventHandlers
  }: {
    children?: React.ReactNode;
    center: [number, number];
    eventHandlers?: { click?: (e: unknown) => void };
  }) => (
    <div
      data-center={`${center[0].toFixed(5)},${center[1].toFixed(5)}`}
      data-testid="task-history-map-marker"
      onClick={eventHandlers?.click as unknown as React.MouseEventHandler<HTMLDivElement>}
    >
      {children}
    </div>
  ),
  useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn() })
}));

// Mock el CSS de Leaflet: vitest tiene `css: false`, pero el import
// todavía se ejecuta — un mock explícito evita ruido en stderr.
vi.mock("leaflet/dist/leaflet.css", () => ({}));

import { MapView, type MapPolygon } from "@/components/task-history/map-view";

const VALLE_BBOX = {
  minLng: -76.7,
  maxLng: -75.9,
  minLat: 3.0,
  maxLat: 4.0
};

/** Centro pseudo-aleatorio determinístico en el Valle del Cauca. */
function randomCenter(seed: number): [number, number] {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  const r = x - Math.floor(x);
  const y = Math.sin(seed * 12345 + 67890) * 233280;
  const r2 = y - Math.floor(y);
  return [
    VALLE_BBOX.minLat + r * (VALLE_BBOX.maxLat - VALLE_BBOX.minLat),
    VALLE_BBOX.minLng + r2 * (VALLE_BBOX.maxLng - VALLE_BBOX.minLng)
  ];
}

interface MakeOpts {
  withNullGeom?: number;
  withDuplicates?: number;
}

function makePolygons(count: number, opts: MakeOpts = {}): MapPolygon[] {
  const arr: MapPolygon[] = [];
  for (let i = 1; i <= count; i++) {
    const [lat, lng] = randomCenter(i);
    arr.push({
      parcelId: i,
      landName: `Parcela #${i}`,
      areaHa: 0.5 + (i % 50) * 0.1,
      geometry: { type: "Point", coordinates: [lng, lat] as [number, number] },
      datesFumigated: ["2026-07-08", "2026-07-09"]
    });
  }
  // Inyectar null geoms al final (no perturban el orden por parcelId).
  if (opts.withNullGeom) {
    for (let i = 0; i < opts.withNullGeom; i++) {
      arr.push({
        parcelId: count + 1000 + i,
        landName: `NullGeom ${i}`,
        areaHa: 1.0,
        geometry: null,
        datesFumigated: []
      });
    }
  }
  // Inyectar duplicados (parcelId que ya existe en `arr`).
  if (opts.withDuplicates) {
    for (let i = 0; i < opts.withDuplicates; i++) {
      const [lat, lng] = randomCenter(i + 9000);
      arr.push({
        parcelId: 1 + i, // duplica los primeros N
        landName: `Dup ${i}`,
        areaHa: 0.5,
        geometry: { type: "Point", coordinates: [lng, lat] as [number, number] },
        datesFumigated: []
      });
    }
  }
  return arr;
}

describe("MapView — load test (Sprint 2 perf guard)", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Silenciar console.error para detectar warnings de React por keys
    // duplicadas (React los emite por console.error, no console.warn).
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    cleanup();
  });

  it("(a) renderiza 1207 markers por debajo del threshold de 1500ms", () => {
    const polygons = makePolygons(1207);
    const t0 = performance.now();
    render(<MapView polygons={polygons} />);
    const elapsed = performance.now() - t0;

    const markers = screen.getAllByTestId("task-history-map-marker");
    expect(markers).toHaveLength(1207);

    // Threshold del spec: 1500ms. Log de diagnóstico si está cerca del
    // límite (>=80% del threshold) para que un futuro dev vea el riesgo
    // antes de que se vuelva rojo.
    if (elapsed >= 1500 * 0.8) {
      // eslint-disable-next-line no-console
      console.warn(
        `[map-view-load] 1207 markers rendered in ${elapsed.toFixed(0)}ms ` +
          `(threshold 1500ms — using ${((elapsed / 1500) * 100).toFixed(0)}% of budget)`
      );
    }
    expect(elapsed).toBeLessThan(1500);
  });

  it("(b) no emite warnings de React por keys duplicadas con parcelIds únicos", () => {
    const polygons = makePolygons(1207);
    render(<MapView polygons={polygons} />);

    const duplicateKeyWarnings = consoleErrorSpy.mock.calls.filter((call) => {
      const msg = call[0];
      return (
        typeof msg === "string" &&
        /encountered two children with the same key/i.test(msg)
      );
    });
    expect(duplicateKeyWarnings).toHaveLength(0);
  });

  it("(c) filtra polígonos con geometry null sin crashear", () => {
    // 1200 válidos + 7 nulls (proporción 0.6% — similar a la realidad
    // de dji_parcels con spray_geom NULL hoy).
    const polygons = makePolygons(1200, { withNullGeom: 7 });
    expect(() => render(<MapView polygons={polygons} />)).not.toThrow();

    const markers = screen.getAllByTestId("task-history-map-marker");
    // Solo los 1200 con geometry válida renderean markers; los 7 nulls
    // se filtran silenciosamente.
    expect(markers).toHaveLength(1200);
  });
});
