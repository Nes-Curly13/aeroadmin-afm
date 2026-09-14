/**
 * tests/api-repositories-parcels-q-filter.test.ts
 *
 * Test unitario del parametro `q` agregado a `getParcelsNormalized` (UI-P0-5,
 * 2026-09-13). El bug original era que /admin/parcels filtraba solo las ~50
 * filas del initialData local; buscar "Palmira" no tocaba el resto del
 * dataset de 1213. La fix: server-side ILIKE en 6 columnas via `?q=` URL.
 *
 * Cubre:
 *   - Con q no-vacio: SQL contiene ILIKE sobre 6 columnas + param `%q%`.
 *   - Con q vacio / whitespace: SQL NO agrega ILIKE (filter desactivado).
 *   - `q` se combina con `missing_*` filters (AND).
 *   - `q` con valor vacio NO activa el camino uncached (sigue el cache).
 *
 * Mockeamos `getDb` para no tocar la BD; validamos la SQL que recibe.
 */

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Mocks
// ============================================================

const mockQuery = vi.fn();
const mockCached = vi.fn();

vi.mock("@/lib/db", () => {
  return {
    getDb: () => ({
      query: (...args: unknown[]) => mockQuery(...args)
    })
  };
});

// Mockeamos el wrapper cacheado para que en el test no falle
// `unstable_cache` (que requiere el runtime de Next.js). El test de
// "q no-vacio: camino uncached" verifica que este mock NO sea llamado
// cuando hay filtro q activo.
vi.mock("@/lib/cache", () => {
  return {
    fetchParcelsNormalizedCached: (...args: unknown[]) => mockCached(...args),
    fetchParcelsMetadataNoCache: () =>
      Promise.resolve({ data: [], total: 0, page: 1, limit: 0, totalPages: 0 })
  };
});

beforeEach(() => {
  mockQuery.mockReset();
  mockCached.mockReset();
  // Default: 1 parcela dummy para que la query no falle.
  // Devolvemos 2 responses: 1 para el SELECT, 1 para el COUNT.
  mockQuery
    .mockResolvedValueOnce({
      rows: [{ id: 1, land_name: "Lote A", external_id: "100-A", source: "djiscraper", client_name: "Cliente 1", farm_name: "Finca X", municipality: "Cali", variety: "CC 85-92" }]
    })
    .mockResolvedValueOnce({ rows: [{ total: 1 }] });
  // Para el camino cacheado (cuando q=''), devolvemos la misma shape.
  mockCached.mockResolvedValue({
    data: [{ id: 1, land_name: "Lote A" }],
    total: 1,
    page: 1,
    limit: 50,
    totalPages: 1
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Tests
// ============================================================

describe("getParcelsNormalized — UI-P0-5: filtro server-side por texto (q)", () => {
  it("con q='palmira': SQL contiene 6 ILIKE clauses sobre las columnas esperadas y el param %palmira%", async () => {
    const repo = await import("@/api/repositories");
    await repo.getParcelsNormalized(1, 50, { q: "palmira" });

    // La primera llamada es el SELECT (la segunda es COUNT).
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(typeof sql).toBe("string");
    const sqlStr = sql as string;

    // 6 columnas matcheadas (mismas que el filtro client-side legacy).
    expect(sqlStr).toMatch(/p\.land_name ILIKE/);
    expect(sqlStr).toMatch(/p\.external_id ILIKE/);
    expect(sqlStr).toMatch(/p\.client_name ILIKE/);
    expect(sqlStr).toMatch(/p\.farm_name ILIKE/);
    expect(sqlStr).toMatch(/p\.municipality ILIKE/);
    expect(sqlStr).toMatch(/p\.variety ILIKE/);

    // El param es `%palmira%` (un solo param reusado 6 veces).
    expect(params).toContain("%palmira%");

    // Soft delete sigue activo.
    expect(sqlStr).toMatch(/p\.deleted_at IS NULL/);
  });

  it("con q='' (vacio): SQL NO agrega ILIKE clauses (filter desactivado)", async () => {
    const repo = await import("@/api/repositories");
    await repo.getParcelsNormalized(1, 50, { q: "" });

    // q vacio + sin otros filtros = camino cacheado. NO debio
    // pegarle a la BD directa (mockQuery no debio ser llamado).
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockCached).toHaveBeenCalledTimes(1);
  });

  it("con q='   ' (whitespace): SQL NO agrega ILIKE clauses (trim + treated as empty)", async () => {
    const repo = await import("@/api/repositories");
    await repo.getParcelsNormalized(1, 50, { q: "   " });

    // whitespace-only se trata como vacio -> camino cacheado.
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockCached).toHaveBeenCalledTimes(1);
  });

  it("q se combina con missingClientName (AND en el WHERE)", async () => {
    const repo = await import("@/api/repositories");
    await repo.getParcelsNormalized(1, 50, {
      q: "palmira",
      missingClientName: true
    });

    const [sql, params] = mockQuery.mock.calls[0];
    const sqlStr = sql as string;

    // Ambos filtros presentes, combinados con AND.
    expect(sqlStr).toMatch(/ILIKE/);
    expect(sqlStr).toMatch(/client_name IS NULL OR client_name = ''/);
    expect(sqlStr).toMatch(/AND/);
    expect(params).toContain("%palmira%");
  });

  it("con q no-vacio: el camino es uncached (no llama fetchParcelsNormalizedCached)", async () => {
    // UI-P0-5: `q` con texto real activa el camino uncached para que el
    // WHERE se evalue (el cache solo soporta filtros especificos). Si
    // alguien refactorea y mueve `q` al wrapper cacheado, este test
    // rompe y obliga a tomar la decision explicita.
    const repo = await import("@/api/repositories");
    await repo.getParcelsNormalized(1, 50, { q: "palmira" });

    // El cache NO debio ser llamado (la query fue directo al mock de db).
    expect(mockCached).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(2); // SELECT + COUNT
  });
});
