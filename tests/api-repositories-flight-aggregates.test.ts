// Tests para getFlightAggregatesByDateRange (Sprint S8 Bloque B).
//
// La funcion hace un query agregado a `dji_flights` con filtros
// por start_at y deleted_at. Devuelve count, sum(volume), sum(area).
//
// Estos tests mockean el `db.query` para no pegar a Supabase.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { getFlightAggregatesByDateRange } from "@/api/repositories";

// Mock getDb
const mockQuery = vi.fn();
vi.mock("@/lib/db", () => ({
  getDb: () => ({ query: mockQuery })
}));

beforeEach(() => {
  mockQuery.mockReset();
});

describe("getFlightAggregatesByDateRange (S8 Bloque B)", () => {
  it("1. suma total de flights + volume + area en el rango", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        total_flights: "42",
        total_volume_l: "12.5",
        total_area_ha: "5.3"
      }]
    });
    const r = await getFlightAggregatesByDateRange(
      "2026-08-01T00:00:00.000Z",
      "2026-08-31T23:59:59.999Z"
    );
    expect(r).toEqual({
      total_flights: 42,
      total_volume_l: 12.5,
      total_area_ha: 5.3
    });
    // Verificar que el query filtra por rango y deleted_at
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM dji_flights");
    expect(sql).toContain("start_at >= $1::timestamptz");
    expect(sql).toContain("start_at <  $2::timestamptz");
    expect(sql).toContain("deleted_at IS NULL");
    expect(params[0]).toBe("2026-08-01T00:00:00.000Z");
    expect(params[1]).toBe("2026-08-31T23:59:59.999Z");
  });

  it("2. clamp defensivo para fechas invalidas → ceros", async () => {
    const r = await getFlightAggregatesByDateRange("not-a-date", "2026-08-31");
    expect(r).toEqual({
      total_flights: 0,
      total_volume_l: 0,
      total_area_ha: 0
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("3. clamp defensivo para empty rows → ceros", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await getFlightAggregatesByDateRange(
      "2026-08-01T00:00:00.000Z",
      "2026-08-31T00:00:00.000Z"
    );
    expect(r).toEqual({
      total_flights: 0,
      total_volume_l: 0,
      total_area_ha: 0
    });
  });

  it("4. COALESCE en SQL — nulls se tratan como 0", async () => {
    // El SQL usa COALESCE(SUM(spray_usage_ml)/1000, 0) — el test
    // verifica que el query SQL lo incluye (la conversion real la
    // hace la BD, no el cliente JS).
    mockQuery.mockResolvedValueOnce({
      rows: [{ total_flights: "0", total_volume_l: "0", total_area_ha: "0" }]
    });
    await getFlightAggregatesByDateRange(
      "2026-08-01T00:00:00.000Z",
      "2026-08-31T00:00:00.000Z"
    );
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("COALESCE(SUM(spray_usage_ml) / 1000.0, 0)");
    expect(sql).toContain("COALESCE(SUM(area_m2) / 10000.0, 0)");
  });
});
