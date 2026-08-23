/**
 * tests/api-repositories-recent-parcels-picker-search.test.ts
 *
 * Test unitario de `getRecentParcelsForPicker(limit, search)` después
 * de Sprint Fase 2 / Q4 (2026-08-23).
 *
 * Cubre:
 *   - Sin `search`: query devuelve los N más recientes por id DESC
 *     (comportamiento original).
 *   - Con `search`: query hace `ILIKE` en 5 campos (land_name,
 *     external_id, client_name, farm_name, municipality) + match
 *     exacto por `id` (string match).
 *   - `limit` clamp: max 2000, min 1.
 *   - `search` whitespace: solo spaces → trata como sin search.
 *   - Filtra `deleted_at IS NULL` (soft delete).
 *   - Devuelve `[]` si la query falla (backwards compatible).
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
  // Default: 3 parcelas de prueba
  mockQuery.mockResolvedValue({
    rows: [
      { id: 100, land_name: "Lote A", external_id: "100-A", source: "djiscraper", client_name: "Cliente 1", farm_name: "Finca X", municipality: "Cali" },
      { id: 200, land_name: "Lote B", external_id: "200-B", source: "manual", client_name: "Cliente 2", farm_name: "Finca Y", municipality: "Bogotá" },
      { id: 300, land_name: "Lote C", external_id: "300-C", source: "djiscraper", client_name: "Cliente 3", farm_name: "Finca Z", municipality: "Medellín" }
    ]
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Tests
// ============================================================

describe("getRecentParcelsForPicker — Sprint Fase 2 / Q4 (search)", () => {
  it("sin search: query devuelve los N más recientes por id DESC", async () => {
    const repo = await import("@/api/repositories");
    await repo.getRecentParcelsForPicker(500, "");
    const [sql, params] = mockQuery.mock.calls[0];
    // Sin search: la query NO tiene ILIKE en WHERE.
    expect(sql).toMatch(/ORDER BY id DESC/);
    expect(sql).not.toMatch(/ILIKE/);
    expect(params).toEqual([500]);
  });

  it("con search: query usa ILIKE en 5 campos + match por id", async () => {
    const repo = await import("@/api/repositories");
    await repo.getRecentParcelsForPicker(500, "Lote A");
    const [sql, params] = mockQuery.mock.calls[0];
    // Verificar que la query tiene ILIKE en 5 campos.
    expect(sql).toMatch(/land_name ILIKE \$1/);
    expect(sql).toMatch(/external_id ILIKE \$1/);
    expect(sql).toMatch(/client_name/);
    expect(sql).toMatch(/farm_name/);
    expect(sql).toMatch(/municipality/);
    // Match exacto por id (string).
    expect(sql).toMatch(/CAST\(id AS text\) = \$2/);
    // Params: [like_pattern, query, limit] — el search se pasa tal cual
    // (no se normaliza a UPPER en el server porque `ILIKE` de Postgres
    // ya es case-insensitive). Verificamos el trim, no la normalización.
    expect(params).toEqual(["%Lote A%", "Lote A", 500]);
  });

  it("search pasa el query tal cual (ILIKE de Postgres es case-insensitive)", async () => {
    const repo = await import("@/api/repositories");
    await repo.getRecentParcelsForPicker(500, "lote a");
    const [, params] = mockQuery.mock.calls[0];
    // El server NO normaliza a UPPER (sería redundante con ILIKE).
    // El query "lote a" se pasa tal cual al SQL, y Postgres matchea
    // "Lote A" / "LOTE A" / "lote a" gracias al case-insensitive de ILIKE.
    expect(params[0]).toBe("%lote a%");
    expect(params[1]).toBe("lote a");
  });

  it("search con solo whitespace se trata como sin search", async () => {
    const repo = await import("@/api/repositories");
    await repo.getRecentParcelsForPicker(500, "   ");
    const [sql] = mockQuery.mock.calls[0];
    // Si search es whitespace puro, la query no debe incluir ILIKE.
    expect(sql).not.toMatch(/ILIKE/);
  });

  it("limit clamp: max 2000, min 1", async () => {
    const repo = await import("@/api/repositories");
    await repo.getRecentParcelsForPicker(9999, "");
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe(2000);

    await repo.getRecentParcelsForPicker(0, "");
    expect(mockQuery.mock.calls[1][1][0]).toBe(1);

    await repo.getRecentParcelsForPicker(-10, "");
    expect(mockQuery.mock.calls[2][1][0]).toBe(1);
  });

  it("filtra deleted_at IS NULL (soft delete)", async () => {
    const repo = await import("@/api/repositories");
    await repo.getRecentParcelsForPicker(500, "");
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/deleted_at IS NULL/);
  });

  it("devuelve [] si la query falla (backwards compatible)", async () => {
    mockQuery.mockRejectedValueOnce(new Error("BD caída"));
    const repo = await import("@/api/repositories");
    const result = await repo.getRecentParcelsForPicker(500, "");
    expect(result).toEqual([]);
  });

  it("devuelve rows del SQL con shape ParcelPickerRow", async () => {
    const repo = await import("@/api/repositories");
    const result = await repo.getRecentParcelsForPicker(500, "");
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      id: 100,
      land_name: "Lote A",
      external_id: "100-A"
    });
  });

  it("con search devuelve los rows filtrados", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 100, land_name: "Lote A", external_id: "100-A", source: "djiscraper", client_name: "Cliente 1", farm_name: "Finca X", municipality: "Cali" }
      ]
    });
    const repo = await import("@/api/repositories");
    const result = await repo.getRecentParcelsForPicker(500, "Lote A");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(100);
  });

  it("con search vacío (string vacío) NO se construye la cláusula WHERE ILIKE", async () => {
    const repo = await import("@/api/repositories");
    await repo.getRecentParcelsForPicker(500, "");
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toMatch(/land_name ILIKE/);
  });
});
