/**
 * tests/api-repositories-unassigned-parcels.test.ts
 *
 * Tests para listUnassignedParcels y bulkSetParcelClientFarm
 * (S11+ / PLAN-FUMIGACIONES-V2 / Fase 3.B).
 *
 * Cubre:
 *   - listUnassignedParcels: WHERE con client_id NULL OR farm_id NULL
 *   - listUnassignedParcels: paginación (page, pageSize, offset)
 *   - listUnassignedParcels: búsqueda (land_name, external_id)
 *   - listUnassignedParcels: cap de pageSize a 200
 *   - bulkSetParcelClientFarm: success per-row, partial failure
 *   - bulkSetParcelClientFarm: array vacío → []
 *
 * Mockeamos el pool de pg.
 */

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    query: (...args: unknown[]) => mockQuery(...args)
  })
}));

const { listUnassignedParcels, bulkSetParcelClientFarm } = await import(
  "@/api/repositories"
);

function mockQueryResolveOnce<T>(rows: T[]): void {
  mockQuery.mockResolvedValueOnce({ rows });
}

function mockQueryRejectOnce(err: Error): void {
  mockQuery.mockRejectedValueOnce(err);
}

beforeEach(() => {
  mockQuery.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================
// listUnassignedParcels
// ============================================================

describe("listUnassignedParcels", () => {
  it("devuelve parcelas y total cuando la BD responde", async () => {
    mockQueryResolveOnce([{ count: "3" }]); // count
    mockQueryResolveOnce([
      { id: 1, land_name: "Lote 1", external_id: "EXT-1", has_client: false, has_farm: false },
      { id: 2, land_name: "Lote 2", external_id: "EXT-2", has_client: true, has_farm: false }
    ]);
    const result = await listUnassignedParcels(1, 50, "");
    expect(result.total).toBe(3);
    expect(result.data).toHaveLength(2);
    expect(result.totalPages).toBe(1);
  });

  it("usa WHERE con client_id IS NULL OR farm_id IS NULL", async () => {
    mockQueryResolveOnce([{ count: "0" }]);
    mockQueryResolveOnce([]);
    await listUnassignedParcels(1, 50, "");
    const countSql = mockQuery.mock.calls[0][0] as string;
    expect(countSql).toContain("client_id IS NULL OR farm_id IS NULL");
  });

  it("con search: agrega LIKE en land_name y external_id", async () => {
    mockQueryResolveOnce([{ count: "0" }]);
    mockQueryResolveOnce([]);
    await listUnassignedParcels(1, 50, "lote 24");
    const countSql = mockQuery.mock.calls[0][0] as string;
    expect(countSql).toContain("ILIKE");
    expect(countSql).toContain("land_name");
    expect(countSql).toContain("external_id");
  });

  it("paginación: OFFSET = (page - 1) * pageSize", async () => {
    mockQueryResolveOnce([{ count: "100" }]);
    mockQueryResolveOnce([]);
    await listUnassignedParcels(3, 25, "");
    const pageSql = mockQuery.mock.calls[1][0] as string;
    expect(pageSql).toContain("LIMIT $");
    expect(pageSql).toContain("OFFSET $");
    const pageParams = mockQuery.mock.calls[1][1] as unknown[];
    expect(pageParams[pageParams.length - 1]).toBe(50); // OFFSET = 2 * 25
    expect(pageParams[pageParams.length - 2]).toBe(25); // LIMIT
  });

  it("cap de pageSize a 200 aunque se pida más", async () => {
    mockQueryResolveOnce([{ count: "0" }]);
    mockQueryResolveOnce([]);
    await listUnassignedParcels(1, 9999, "");
    const pageParams = mockQuery.mock.calls[1][1] as unknown[];
    expect(pageParams[pageParams.length - 2]).toBe(200);
  });

  it("mapea has_client y has_farm desde client_id/farm_id no-null", async () => {
    mockQueryResolveOnce([{ count: "3" }]);
    mockQueryResolveOnce([
      {
        id: 1,
        land_name: "Lote 1",
        external_id: "EXT-1",
        client_name: null,
        farm_name: null,
        municipality: "Palmira",
        data_validity: "unknown",
        client_id: null,
        farm_id: null
      },
      {
        id: 2,
        land_name: "Lote 2",
        external_id: "EXT-2",
        client_name: "Agro",
        farm_name: "La Esperanza",
        municipality: "Palmira",
        data_validity: "fresh",
        client_id: 5,
        farm_id: 10
      }
    ]);
    const result = await listUnassignedParcels(1, 50, "");
    expect(result.data[0].has_client).toBe(false);
    expect(result.data[0].has_farm).toBe(false);
    expect(result.data[1].has_client).toBe(true);
    expect(result.data[1].has_farm).toBe(true);
  });
});

// ============================================================
// bulkSetParcelClientFarm
// ============================================================

describe("bulkSetParcelClientFarm", () => {
  it("array vacío → [] sin tocar la BD", async () => {
    const result = await bulkSetParcelClientFarm({
      parcel_ids: [],
      client_id: 1,
      farm_id: 1,
      validated_by_email: "x@y.com"
    });
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("3 parcelas todas exitosas → 3 results con success=true", async () => {
    // 3 calls a setParcelClientFarm → 3 successful query results
    mockQueryResolveOnce([{ id: 1, client_id: 5, farm_id: 10 }]);
    mockQueryResolveOnce([{ id: 2, client_id: 5, farm_id: 10 }]);
    mockQueryResolveOnce([{ id: 3, client_id: 5, farm_id: 10 }]);
    const result = await bulkSetParcelClientFarm({
      parcel_ids: [1, 2, 3],
      client_id: 5,
      farm_id: 10,
      validated_by_email: "x@y.com"
    });
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.success)).toBe(true);
  });

  it("partial failure: 1 falla, 2 ok → 3 results con success mixto", async () => {
    mockQueryResolveOnce([{ id: 1, client_id: 5, farm_id: 10 }]);
    mockQueryRejectOnce(new Error("parcel 2 no existe"));
    mockQueryResolveOnce([{ id: 3, client_id: 5, farm_id: 10 }]);
    const result = await bulkSetParcelClientFarm({
      parcel_ids: [1, 2, 3],
      client_id: 5,
      farm_id: 10,
      validated_by_email: "x@y.com"
    });
    expect(result).toHaveLength(3);
    expect(result[0].success).toBe(true);
    expect(result[1].success).toBe(false);
    expect(result[1].error).toContain("parcel 2 no existe");
    expect(result[2].success).toBe(true);
  });
});
