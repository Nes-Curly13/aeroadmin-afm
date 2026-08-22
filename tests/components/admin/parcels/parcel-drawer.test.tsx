// tests/components/admin/parcels/parcel-drawer.test.tsx
//
// Test unitario del `ParcelDrawer` (sprint 2026-08-04,
// feature/parcel-onboarding + bug fix 2026-08-22 fix/parcel-drawer-click-bug).
//
// Este test NO ejercita el flow real de clicks sobre un canvas de MapLibre
// (eso se cubre con e2e/Playwright). El objetivo es verificar el CONTRATO
// del setup: orden de operaciones, uso del callback `ready` de terra-draw,
// y deshabilitar `map.doubleClickZoom` antes de setear el modo.
//
// Por qué este test existe:
//   En el bug original (`setMode("polygon")` se llamaba antes de que
//   `draw.on("ready", ...)` se disparara), los clicks del operador no
//   se traducían a vértices del polígono. El test bloquea que alguien
//   revierta el fix por accidente: si movemos `setMode` afuera del
//   `ready` callback, este test falla con un mensaje claro.
//
// Estrategia de mocking:
//   - `maplibre-gl` se mockea con un constructor que captura los handlers
//     de `on("load", ...)`, `on("...", ...)`, expone un mock de
//     `doubleClickZoom`, y permite "disparar" el load manualmente.
//   - `terra-draw` y `terra-draw-maplibre-gl-adapter` se mockean
//     completamente — el test no necesita la lógica real de terra-draw,
//     solo queremos verificar QUÉ se invoca y EN QUÉ ORDEN.
//   - `maplibre-gl/dist/maplibre-gl.css` se ignora via `css: false` en
//     vitest.config.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

// =====================================================================
// Mocks
// =====================================================================

// Capturadores de los handlers del map para poder dispararlos manualmente.
type AnyHandler = (event?: unknown) => void;
const loadHandlers: AnyHandler[] = [];
const otherHandlers: Record<string, AnyHandler[]> = {};

const mockMapInstance = {
  on: vi.fn((event: string, handler: AnyHandler) => {
    if (event === "load") {
      loadHandlers.push(handler);
    } else {
      (otherHandlers[event] ||= []).push(handler);
    }
    return mockMapInstance;
  }),
  once: vi.fn(),
  off: vi.fn(),
  remove: vi.fn(),
  doubleClickZoom: {
    disable: vi.fn(),
    enable: vi.fn(),
    isEnabled: vi.fn(() => true)
  },
  dragPan: { isEnabled: () => true, enable: vi.fn(), disable: vi.fn() },
  dragRotate: { isEnabled: () => true, enable: vi.fn(), disable: vi.fn() },
  getCanvas: vi.fn(() => ({})),
  getContainer: vi.fn(() => ({}))
};

const MapMock = vi.fn(function (this: unknown) {
  return mockMapInstance;
});

// Mock de maplibre-gl. Exporta default con `Map` y un named export `Map`.
vi.mock("maplibre-gl", () => {
  return {
    default: { Map: MapMock },
    Map: MapMock
  };
});

// Mock del adapter: solo guardamos la instancia para inspeccionarla.
const mockAdapterInstance = { kind: "adapter" };
const TerraDrawMapLibreGLAdapterMock = vi.fn(function (this: unknown) {
  return mockAdapterInstance;
});
vi.mock("terra-draw-maplibre-gl-adapter", () => ({
  TerraDrawMapLibreGLAdapter: TerraDrawMapLibreGLAdapterMock
}));

// Mock de terra-draw: TerraDraw expone `on`, `start`, `setMode`, `stop`,
// `addFeatures`, `getSnapshot`, `clear`. Capturamos los handlers del
// `on("ready", ...)` y del `on("finish", ...)` para dispararlos.
type EventHandler = (...args: unknown[]) => void;
let readyHandlers: EventHandler[] = [];
let finishHandlers: EventHandler[] = [];
let changeHandlers: EventHandler[] = [];

const mockDrawInstance = {
  start: vi.fn(() => {
    // Simula el contrato real de terra-draw: `start()` invoca el
    // callback `ready` que el adapter pasa a `register({onReady, ...})`.
    // Pero en nuestro mock el `ready` se dispara vía `draw.on("ready")`,
    // no por el adapter. Por eso dejamos `start()` como no-op y
    // disparamos los `ready` handlers desde el test.
  }),
  stop: vi.fn(),
  setMode: vi.fn(),
  on: vi.fn((event: string, handler: EventHandler) => {
    if (event === "ready") readyHandlers.push(handler);
    else if (event === "finish") finishHandlers.push(handler);
    else if (event === "change") changeHandlers.push(handler);
    return mockDrawInstance;
  }),
  off: vi.fn(),
  addFeatures: vi.fn(),
  getSnapshot: vi.fn(() => []),
  clear: vi.fn()
};

const TerraDrawMock = vi.fn(function (this: unknown) {
  return mockDrawInstance;
});
const TerraDrawPolygonModeMock = vi.fn(function (this: unknown) {
  return { mode: "polygon" };
});

vi.mock("terra-draw", () => ({
  TerraDraw: TerraDrawMock,
  TerraDrawPolygonMode: TerraDrawPolygonModeMock
}));

// =====================================================================
// Test
// =====================================================================

const { ParcelDrawer } = await import(
  "@/components/admin/parcels/parcel-drawer"
);

beforeEach(() => {
  // Reset state entre tests
  loadHandlers.length = 0;
  Object.keys(otherHandlers).forEach((k) => {
    otherHandlers[k].length = 0;
  });
  readyHandlers = [];
  finishHandlers = [];
  changeHandlers = [];
  vi.clearAllMocks();
});

afterEach(() => {
  // No-op: solo por simetría con otros tests
});

describe("ParcelDrawer — inicialización (bug fix 2026-08-22)", () => {
  it("crea un TerraDraw y un TerraDrawMapLibreGLAdapter", () => {
    render(<ParcelDrawer onPolygonChange={() => {}} />);
    // Disparar el "load" del map para que se ejecute el callback
    act(() => {
      loadHandlers.forEach((h) => h());
    });
    expect(TerraDrawMapLibreGLAdapterMock).toHaveBeenCalledTimes(1);
    expect(TerraDrawMock).toHaveBeenCalledTimes(1);
    expect(TerraDrawPolygonModeMock).toHaveBeenCalledTimes(1);
  });

  it("llama a start() DESPUÉS de registrar el listener de 'ready'", () => {
    render(<ParcelDrawer onPolygonChange={() => {}} />);
    act(() => {
      loadHandlers.forEach((h) => h());
    });

    // 1. Se registró el listener `ready` antes de start()
    expect(mockDrawInstance.on).toHaveBeenCalledWith(
      "ready",
      expect.any(Function)
    );
    // 2. start() se llamó
    expect(mockDrawInstance.start).toHaveBeenCalledTimes(1);

    // 3. El listener de ready se registró ANTES que start() — esto es
    //    crítico: si invertimos el orden, el ready se dispara antes de
    //    que tengamos un handler.
    const onCalls = mockDrawInstance.on.mock.invocationCallOrder as number[];
    const startCalls = mockDrawInstance.start.mock
      .invocationCallOrder as number[];
    expect(onCalls.length).toBeGreaterThan(0);
    expect(startCalls.length).toBeGreaterThan(0);
    const readyInvocationOrder = onCalls[0];
    const startInvocationOrder = startCalls[0];
    expect(readyInvocationOrder).toBeLessThan(startInvocationOrder);
  });

  it("dentro del callback 'ready' se llama a map.doubleClickZoom.disable()", () => {
    render(<ParcelDrawer onPolygonChange={() => {}} />);
    act(() => {
      loadHandlers.forEach((h) => h());
    });
    // Antes del ready, no se llamó disable
    expect(mockMapInstance.doubleClickZoom.disable).not.toHaveBeenCalled();
    // Disparar los ready handlers manualmente
    act(() => {
      readyHandlers.forEach((h) => h());
    });
    // Ahora sí
    expect(mockMapInstance.doubleClickZoom.disable).toHaveBeenCalledTimes(1);
  });

  it("dentro del callback 'ready' se llama a draw.setMode('polygon')", () => {
    render(<ParcelDrawer onPolygonChange={() => {}} />);
    act(() => {
      loadHandlers.forEach((h) => h());
    });
    // Antes del ready, no se llamó setMode
    expect(mockDrawInstance.setMode).not.toHaveBeenCalled();
    // Disparar los ready handlers manualmente
    act(() => {
      readyHandlers.forEach((h) => h());
    });
    expect(mockDrawInstance.setMode).toHaveBeenCalledTimes(1);
    expect(mockDrawInstance.setMode).toHaveBeenCalledWith("polygon");
  });

  it("el orden dentro de 'ready' es: disable dblclick → setMode", () => {
    render(<ParcelDrawer onPolygonChange={() => {}} />);
    act(() => {
      loadHandlers.forEach((h) => h());
    });
    act(() => {
      readyHandlers.forEach((h) => h());
    });

    // El `disable` debe haberse llamado ANTES que `setMode` — sino
    // el primer doble-click podría llegar antes del disable y disparar
    // el zoom del browser en vez de cerrar el polígono.
    const disableOrder = mockMapInstance.doubleClickZoom.disable.mock
      .invocationCallOrder as number[];
    const setModeOrder = mockDrawInstance.setMode.mock
      .invocationCallOrder as number[];
    expect(disableOrder[0]).toBeLessThan(setModeOrder[0]);
  });

  it("si recibe initialPolygon, lo carga via addFeatures DENTRO del 'ready'", () => {
    const initialPolygon = {
      type: "Polygon" as const,
      coordinates: [
        [
          [-76.31, 3.47],
          [-76.30, 3.47],
          [-76.30, 3.48],
          [-76.31, 3.48],
          [-76.31, 3.47]
        ]
      ]
    };
    const onPolygonChange = vi.fn();

    render(
      <ParcelDrawer
        onPolygonChange={onPolygonChange}
        initialPolygon={initialPolygon}
      />
    );
    act(() => {
      loadHandlers.forEach((h) => h());
    });
    // Antes del ready, addFeatures no se llamó
    expect(mockDrawInstance.addFeatures).not.toHaveBeenCalled();
    expect(onPolygonChange).not.toHaveBeenCalled();
    // Disparar ready
    act(() => {
      readyHandlers.forEach((h) => h());
    });
    // Después del ready, sí
    expect(mockDrawInstance.addFeatures).toHaveBeenCalledTimes(1);
    const [features] = mockDrawInstance.addFeatures.mock.calls[0];
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({
      type: "Feature",
      geometry: initialPolygon,
      properties: { mode: "polygon" }
    });
    expect(onPolygonChange).toHaveBeenCalledWith(initialPolygon);
  });

  it("registra un handler de 'finish' dentro del callback 'ready'", () => {
    render(<ParcelDrawer onPolygonChange={() => {}} />);
    act(() => {
      loadHandlers.forEach((h) => h());
    });
    // Antes del ready, no hay finish handler
    expect(finishHandlers).toHaveLength(0);
    // Disparar ready
    act(() => {
      readyHandlers.forEach((h) => h());
    });
    // Después del ready, sí
    expect(finishHandlers.length).toBeGreaterThanOrEqual(1);
  });
});
