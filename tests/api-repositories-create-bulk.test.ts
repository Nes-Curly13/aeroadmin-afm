/**
 * tests/api-repositories-create-bulk.test.ts
 *
 * Test unitario de la función `createManualParcelsBulk` en api/repositories.ts.
 * Cubre:
 *   - Happy path: 3 inserts en 1 transacción, source='imported'
 *   - Validación previa: si una feature falla, NO se abre la tx
 *   - Rollback: si el INSERT #2 falla, #1 también se revierte
 *   - Array vacío: devuelve []
 *
 * Mockeamos el pool de pg (getDb.connect) para no tocar la BD.
 */

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Mocks
// ============================================================

const mockConnect = vi.fn();
const mockRelease = vi.fn();
const mockInvalidate = vi.fn();

// Mock con factory que retorna SIEMPRE el mismo mockConnect (no se re-evalúa).
vi.mock("@/lib/db", () => {
  return {
    getDb: () => ({
      connect: () => mockConnect()
    })
  };
});

vi.mock("@/lib/cache", () => ({
  invalidateAfterParcelMutation: () => mockInvalidate()
}));

const { createManualParcelsBulk } = await import("@/api/repositories");

// ============================================================
// Helpers
// ============================================================

function makeClient(opts: { failOnNthInsert?: number } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let insertCount = 0;
  return {
    calls,
    client: {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        // El SQL real tiene leading whitespace + newlines (template literal).
        // Trim antes de matchear.
        const trimmed = sql.trimStart();
        const firstLine = trimmed.split("\n")[0].trim();
        calls.push({ sql: firstLine, params });
        const sqlUpper = trimmed.toUpperCase();
        if (sqlUpper.startsWith("BEGIN")) return { rows: [] };
        if (sqlUpper.startsWith("COMMIT")) return { rows: [] };
        if (sqlUpper.startsWith("ROLLBACK")) return { rows: [] };
        if (sqlUpper.startsWith("INSERT")) {
          insertCount++;
          if (opts.failOnNthInsert && insertCount === opts.failOnNthInsert) {
            throw new Error(`INSERT #${insertCount} failed`);
          }
          return { rows: [{ id: 100 + insertCount }] };
        }
        // SELECT after INSERT — return the full row
        if (sqlUpper.startsWith("SELECT")) {
          return {
            rows: [
              {
                id: 100 + insertCount,
                source: "imported",
                land_name: "imported-test",
                external_id: "imported-uuid"
              }
            ]
          };
        }
        return { rows: [] };
      }),
      release: mockRelease
    }
  };
}

const validGeom = {
  type: "Polygon" as const,
  coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
};

// ============================================================
// Tests
// ============================================================

describe("createManualParcelsBulk", () => {
  beforeEach(() => {
    mockConnect.mockReset();
    mockRelease.mockReset();
    mockInvalidate.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("array vacío → devuelve [] sin tocar la BD", async () => {
    const result = await createManualParcelsBulk([]);
    expect(result).toEqual([]);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("happy path: 3 INSERTs en 1 transacción, COMMIT, release", async () => {
    const { client, calls } = makeClient();
    mockConnect.mockResolvedValueOnce(client);
    const result = await createManualParcelsBulk([
      { land_name: "Lote 1", field_type: "Farmland", geometry: validGeom },
      { land_name: "Lote 2", field_type: "Farmland", geometry: validGeom },
      { land_name: "Lote 3", field_type: "Farmland", geometry: validGeom }
    ]);
    expect(result).toHaveLength(3);
    expect(calls.some((c) => c.sql === "BEGIN")).toBe(true);
    expect(calls.some((c) => c.sql === "COMMIT")).toBe(true);
    expect(calls.filter((c) => c.sql === "ROLLBACK").length).toBe(0);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });

  it("validación previa: si una feature es inválida, NO abre la tx", async () => {
    await expect(
      createManualParcelsBulk([
        { land_name: "OK", field_type: "Farmland", geometry: validGeom },
        // land_name vacío
        { land_name: "", field_type: "Farmland", geometry: validGeom }
      ])
    ).rejects.toThrow(/Parcela #2.*land_name/);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("rollback: si el INSERT #2 falla, ROLLBACK y nada queda", async () => {
    const { client, calls } = makeClient({ failOnNthInsert: 2 });
    mockConnect.mockResolvedValueOnce(client);
    await expect(
      createManualParcelsBulk([
        { land_name: "Lote 1", field_type: "Farmland", geometry: validGeom },
        { land_name: "Lote 2", field_type: "Farmland", geometry: validGeom },
        { land_name: "Lote 3", field_type: "Farmland", geometry: validGeom }
      ])
    ).rejects.toThrow(/INSERT #2 failed/);
    expect(calls.some((c) => c.sql === "BEGIN")).toBe(true);
    expect(calls.some((c) => c.sql === "ROLLBACK")).toBe(true);
    expect(calls.some((c) => c.sql === "COMMIT")).toBe(false);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    // invalidateAfterParcelMutation NO se llama (rollback)
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it("source='imported' (no 'manual')", async () => {
    const { client, calls } = makeClient();
    mockConnect.mockResolvedValueOnce(client);
    await createManualParcelsBulk([
      { land_name: "Lote 1", field_type: "Farmland", geometry: validGeom }
    ]);
    // El primer param del INSERT es external_id (UUID), el segundo es land_name
    const insert = calls.find((c) => c.sql.startsWith("INSERT"));
    expect(insert).toBeDefined();
    // El INSERT con source='imported' está hardcoded en el SQL — verificamos
    // que aparezca en el SQL mismo.
    expect(insert?.sql.toUpperCase()).toContain("INSERT");
    // Buscamos el SQL completo (no solo primera linea) para verificar el source
    const allCalls = client.query.mock.calls;
    const insertCall = allCalls.find(
      (c) => typeof c[0] === "string" && c[0].toUpperCase().includes("'IMPORTED'")
    );
    expect(insertCall).toBeDefined();
  });
});
