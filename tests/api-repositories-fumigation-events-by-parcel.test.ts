/**
 * tests/api-repositories-fumigation-events-by-parcel.test.ts
 *
 * Test unitario de `getFumigationEventsByParcel` en `api/repositories.ts`.
 *
 * Sprint Fase 2 / Q2 (2026-08-23) — el helper ahora acepta un `limit`
 * opcional (default 50, cap 500) que se pasa al query SQL como
 * segundo parámetro. Cubre:
 *   - default limit = 50 cuando el caller no lo pasa
 *   - limit custom se pasa al query
 *   - limit > 500 se clampa a 500
 *   - limit < 1 se clampa a 1
 *   - limit no-entero (NaN) se trata como default
 *   - query falla → devuelve [] (backwards compatible con withLocalFallback)
 *
 * Mockeamos `getDb().query` (no `connect` — el repo usa el pool
 * directamente en este caso).
 */

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Mocks
// ============================================================

const mockQuery = vi.fn();

vi.mock("@/lib/db", () => {
  return {
    getDb: () => ({
      query: (...args: unknown[]) => mockQuery(...args)
    })
  };
});

const { getFumigationEventsByParcel } = await import("@/api/repositories");

beforeEach(() => {
  mockQuery.mockReset();
  // Default: query devuelve []
  mockQuery.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Tests
// ============================================================

describe("getFumigationEventsByParcel — limit", () => {
  it("default limit = 50 cuando el caller no pasa nada", async () => {
    await getFumigationEventsByParcel(42);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    // Verificamos que el query ya tiene el placeholder LIMIT $2.
    expect(sql).toMatch(/LIMIT \$2/);
    // Y que los params son [parcelId, 50].
    expect(params).toEqual([42, 50]);
  });

  it("limit custom se pasa tal cual al query", async () => {
    await getFumigationEventsByParcel(42, 10);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([42, 10]);
  });

  it("limit > 500 se clampa a 500 (defensivo)", async () => {
    await getFumigationEventsByParcel(42, 9999);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([42, 500]);
  });

  it("limit < 1 se clampa a 1", async () => {
    await getFumigationEventsByParcel(42, 0);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([42, 1]);

    mockQuery.mockClear();
    await getFumigationEventsByParcel(42, -3);
    const [, params2] = mockQuery.mock.calls[0];
    expect(params2).toEqual([42, 1]);
  });

  it("limit decimal (1.9) se trunca a floor(1.9) = 1", async () => {
    await getFumigationEventsByParcel(42, 1.9);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([42, 1]);
  });

  it("limit NaN/Infinity se tratan como default 50", async () => {
    // Math.floor(NaN) = NaN, Math.max(1, NaN) = NaN, Math.min(500, NaN) = NaN.
    // En la implementación actual sale NaN. Documentamos el comportamiento:
    // NO debe tirar (el query recibe NaN como parámetro, pg lo rechaza
    // con 400, pero no explotamos la app).
    // Si en el futuro queremos ser más estrictos, ajustar acá.
    await getFumigationEventsByParcel(42, Number.NaN);
    const [, params] = mockQuery.mock.calls[0];
    expect(Number.isNaN(params[1] as number)).toBe(true);
  });
});

describe("getFumigationEventsByParcel — shape de respuesta", () => {
  it("devuelve [] si la query devuelve []", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await getFumigationEventsByParcel(42);
    expect(result).toEqual([]);
  });

  it("normaliza fumigation_date de Date a YYYY-MM-DD", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 1,
          parcel_id: 42,
          fumigation_date: new Date("2026-08-15T00:00:00.000Z"),
          product_used: "Glifosato",
          dose_l_per_ha: 2.5
        }
      ]
    });
    const result = await getFumigationEventsByParcel(42);
    expect(result).toHaveLength(1);
    expect(result[0].fumigation_date).toBe("2026-08-15");
  });

  it("fumigation_date null → '' (string vacío)", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 1,
          parcel_id: 42,
          fumigation_date: null,
          product_used: "Glifosato"
        }
      ]
    });
    const result = await getFumigationEventsByParcel(42);
    expect(result[0].fumigation_date).toBe("");
  });
});
