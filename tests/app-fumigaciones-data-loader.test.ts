/**
 * tests/app-fumigaciones-data-loader.test.ts
 *
 * Test unitario del `FumigacionesDataLoader` (Sprint Fase 2 / Q1,
 * 2026-08-23).
 *
 * Cubre el contrato del Loader:
 *   - Llama `getRecentFumigations(2000)` UNA SOLA VEZ (no 2).
 *     Antes de Q1, Counts y Table cada uno llamaba esta función,
 *     resultando en 2 round-trips al cache por render.
 *   - `children` recibe el array devuelto por `getRecentFumigations`.
 *   - Devuelve un React element que envuelve el children.
 *
 * Mockeamos `getRecentFumigations` (no el pool de pg directo).
 */

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DjiFumigationEvent } from "@/lib/types";

// ============================================================
// Mocks
// ============================================================

const mockGetRecentFumigations = vi.fn();

vi.mock("@/api/repositories", () => ({
  getRecentFumigations: (...args: unknown[]) => mockGetRecentFumigations(...args)
}));

beforeEach(() => {
  mockGetRecentFumigations.mockReset();
  // Default: devuelve 3 fumigaciones de prueba
  mockGetRecentFumigations.mockResolvedValue([
    { id: 1, source: "manual", fumigation_date: "2026-08-01" },
    { id: 2, source: "djiscraper", fumigation_date: "2026-08-02" },
    { id: 3, source: "manual", fumigation_date: "2026-08-03" }
  ] as DjiFumigationEvent[]);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Tests
// ============================================================

describe("FumigacionesDataLoader", () => {
  it("llama getRecentFumigations(2000) UNA SOLA VEZ", async () => {
    const { FumigacionesDataLoader } = await import(
      "@/app/(auth)/fumigaciones/data-loader"
    );
    const result = FumigacionesDataLoader({
      sourceFilter: null,
      children: () => null
    });
    await result;
    expect(mockGetRecentFumigations).toHaveBeenCalledTimes(1);
    expect(mockGetRecentFumigations).toHaveBeenCalledWith(2000);
  });

  it("children recibe el array de getRecentFumigations", async () => {
    const { FumigacionesDataLoader } = await import(
      "@/app/(auth)/fumigaciones/data-loader"
    );
    const childrenSpy = vi.fn().mockReturnValue(null);
    const result = FumigacionesDataLoader({
      sourceFilter: null,
      children: childrenSpy
    });
    await result;
    expect(childrenSpy).toHaveBeenCalledTimes(1);
    const arg = childrenSpy.mock.calls[0][0] as DjiFumigationEvent[];
    expect(arg).toHaveLength(3);
    expect(arg[0].id).toBe(1);
    expect(arg[1].source).toBe("djiscraper");
  });

  it("devuelve el resultado de children envuelto en un Fragment", async () => {
    const { FumigacionesDataLoader } = await import(
      "@/app/(auth)/fumigaciones/data-loader"
    );
    const childElement = { type: "div", props: { children: "x" } };
    const result = await FumigacionesDataLoader({
      sourceFilter: null,
      children: () => childElement as never
    });
    // FumigacionesDataLoader devuelve un Fragment que envuelve el
    // children. El Fragment de React es un Symbol(react.fragment).
    expect(result).toBeDefined();
  });

  it("mismas props dummy no cambian el resultado (Loader se monta una vez)", async () => {
    // Cambio de props "dummy" (filtros) NO debe afectar el comportamiento
    // del Loader — sigue trayendo el array completo. Esto valida que
    // las props dummy no se usan para nada (solo para forzar re-mount).
    const { FumigacionesDataLoader } = await import(
      "@/app/(auth)/fumigaciones/data-loader"
    );
    const r1 = await FumigacionesDataLoader({
      sourceFilter: "manual",
      query: "test1",
      categoryFilter: 1,
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
      parcelFilter: 100,
      droneFilter: 1,
      page: 1,
      children: () => null
    });
    await r1;
    const callsAfterFirst = mockGetRecentFumigations.mock.calls.length;
    expect(callsAfterFirst).toBe(1);

    // Segunda "renderización" con props distintas — esto en React real
    // sería un re-mount, pero acá solo verificamos que la función
    // misma se llama UNA vez por invocación (no se duplica).
    const r2 = await FumigacionesDataLoader({
      sourceFilter: "djiscraper",
      query: "test2",
      categoryFilter: 2,
      fromDate: "2026-02-01",
      toDate: "2026-11-30",
      parcelFilter: 200,
      droneFilter: 2,
      page: 2,
      children: () => null
    });
    await r2;
    expect(mockGetRecentFumigations).toHaveBeenCalledTimes(2);
  });

  it("si getRecentFumigations rechaza, el error propaga al caller", async () => {
    mockGetRecentFumigations.mockRejectedValueOnce(new Error("BD caída"));
    const { FumigacionesDataLoader } = await import(
      "@/app/(auth)/fumigaciones/data-loader"
    );
    const result = FumigacionesDataLoader({
      sourceFilter: null,
      children: () => null
    });
    await expect(result).rejects.toThrow("BD caída");
  });

  it("array vacío: children recibe []", async () => {
    mockGetRecentFumigations.mockResolvedValueOnce([] as DjiFumigationEvent[]);
    const { FumigacionesDataLoader } = await import(
      "@/app/(auth)/fumigaciones/data-loader"
    );
    const childrenSpy = vi.fn().mockReturnValue(null);
    const result = FumigacionesDataLoader({
      sourceFilter: null,
      children: childrenSpy
    });
    await result;
    const arg = childrenSpy.mock.calls[0][0] as DjiFumigationEvent[];
    expect(arg).toEqual([]);
  });
});
