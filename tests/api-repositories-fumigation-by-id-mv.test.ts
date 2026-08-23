/**
 * tests/api-repositories-fumigation-by-id-mv.test.ts
 *
 * Test unitario de `getFumigationById` después del cambio a MV
 * `mv_fumigation_flight_centroids` (Sprint Fase 2 / Q3, 2026-08-23).
 *
 * Verifica que la SQL:
 *   - Hace LEFT JOIN contra `mv_fumigation_flight_centroids` (no
 *     contra `dji_flights` + ST_Centroid on-the-fly).
 *   - Proyecta `mv.n_matched_flights`, `mv.lat`, `mv.lng` directamente.
 *   - NO incluye `count(fl.id)::int` ni `ST_Centroid(ST_Collect(...))`.
 *   - Mantiene los demás JOINs (categoría, application_type, invoices).
 *   - Filtra `f.deleted_at IS NULL` (soft delete).
 *
 * Mockeamos `getDb` con un result fijo. Como `getFumigationById` no
 * está exportado directamente (es interno al módulo), lo ejercitamos
 * via la cache wrapper o via re-import dinámico.
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

beforeEach(() => {
  mockQuery.mockReset();
  // Default: simula la query con MV — n_matched_flights, lat, lng
  // vienen de la MV.
  mockQuery.mockResolvedValue({
    rows: [
      {
        id: 100,
        parcel_id: 42,
        fumigation_date: "2026-08-15",
        product_used: "Glifosato",
        dose_l_per_ha: "2.5",
        area_fumigated_m2: null,
        drone_code_used: null,
        duration_minutes: null,
        notes: null,
        human_notes: null,
        recorded_by: "admin@aeroadmin.local",
        product_registered_ica: null,
        pilot_license: null,
        recorded_at: "2026-08-15T10:00:00.000Z",
        source: "djiscraper",
        category_id: null,
        flight_ids: [1001, 1002, 1003],
        application_type_id: null,
        vehicle_plate: null,
        n_matched_flights: 3,
        lat: "4.5678",
        lng: "-75.1234",
        category: null,
        application_type: null,
        invoices: []
      }
    ]
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Tests
// ============================================================

describe("getFumigationById — Q3 usa MV mv_fumigation_flight_centroids", () => {
  it("el query hace LEFT JOIN a mv_fumigation_flight_centroids", async () => {
    const repo = await import("@/api/repositories");
    await repo.getFumigationById(100);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/LEFT JOIN\s+mv_fumigation_flight_centroids\s+mv/);
  });

  it("proyecta mv.n_matched_flights, mv.lat, mv.lng", async () => {
    const repo = await import("@/api/repositories");
    await repo.getFumigationById(100);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/mv\.n_matched_flights/);
    expect(sql).toMatch(/mv\.lat/);
    expect(sql).toMatch(/mv\.lng/);
  });

  it("NO usa ST_Centroid on-the-fly (lo delega a la MV)", async () => {
    const repo = await import("@/api/repositories");
    await repo.getFumigationById(100);
    const [sql] = mockQuery.mock.calls[0];
    // El ST_Centroid(ST_Collect(...)) ya NO aparece en el query principal
    // (lo calcula la MV al refrescarse, no por request).
    expect(sql).not.toMatch(/ST_Centroid\(ST_Collect\(/);
  });

  it("NO hace JOIN directo a dji_flights", async () => {
    const repo = await import("@/api/repositories");
    await repo.getFumigationById(100);
    const [sql] = mockQuery.mock.calls[0];
    // Antes: LEFT JOIN dji_flights fl ON fl.flight_id = ANY(f.flight_ids)
    // Ahora: solo LEFT JOIN a la MV.
    expect(sql).not.toMatch(/LEFT JOIN dji_flights/);
    expect(sql).not.toMatch(/dji_flights\s+fl/);
  });

  it("devuelve el row con n_matched_flights/lat/lng normalizados", async () => {
    const repo = await import("@/api/repositories");
    const result = await repo.getFumigationById(100);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(100);
    expect(result!.parcel_id).toBe(42);
    expect(result!.n_matched_flights).toBe(3);
    expect(Number(result!.lat)).toBeCloseTo(4.5678, 3);
    expect(Number(result!.lng)).toBeCloseTo(-75.1234, 3);
  });

  it("fumigación sin fila en MV (manual): n_matched_flights=0, lat/lng=null", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 200,
          parcel_id: 50,
          fumigation_date: "2026-08-10",
          product_used: "Manual",
          dose_l_per_ha: "3.0",
          area_fumigated_m2: null,
          drone_code_used: 0,
          duration_minutes: null,
          notes: null,
          human_notes: null,
          recorded_by: "operador",
          product_registered_ica: null,
          pilot_license: null,
          recorded_at: "2026-08-10T10:00:00.000Z",
          source: "manual",
          category_id: null,
          flight_ids: null,
          application_type_id: null,
          vehicle_plate: null,
          n_matched_flights: 0,
          lat: null,
          lng: null,
          category: null,
          application_type: null,
          invoices: []
        }
      ]
    });
    const repo = await import("@/api/repositories");
    const result = await repo.getFumigationById(200);
    expect(result!.n_matched_flights).toBe(0);
    expect(result!.lat).toBeNull();
    expect(result!.lng).toBeNull();
    // flight_ids null → fumigación manual, sin mapa (la UI muestra
    // "Sin mapa").
    expect(result!.flight_ids).toBeNull();
  });

  it("devuelve null si la query no devuelve rows (no existe o soft-deleted)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const repo = await import("@/api/repositories");
    const result = await repo.getFumigationById(999);
    expect(result).toBeNull();
  });

  it("el query filtra f.deleted_at IS NULL", async () => {
    const repo = await import("@/api/repositories");
    await repo.getFumigationById(100);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/f\.deleted_at IS NULL/);
  });

  it("mantiene los LEFT JOINs de categoría y application_type", async () => {
    const repo = await import("@/api/repositories");
    await repo.getFumigationById(100);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/LEFT JOIN fumigation_categories cat/);
    expect(sql).toMatch(/LEFT JOIN application_types at/);
  });

  it("mantiene el aggregate de invoices (jsonb_agg de fumigation_invoices)", async () => {
    const repo = await import("@/api/repositories");
    await repo.getFumigationById(100);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/jsonb_agg\(row_to_json\(inv\)/);
    expect(sql).toMatch(/FROM fumigation_invoices inv/);
  });
});
