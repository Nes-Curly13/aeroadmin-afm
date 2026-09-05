/**
 * tests/api-repositories-clients-farms.test.ts
 *
 * Tests unitarios de las funciones de repository para clients y farms
 * (S11+ / PLAN-FUMIGACIONES-V2 / Fase 3.A).
 *
 * Cubre:
 *   - searchClients: empty query, starts-with, contains, limit cap
 *   - createClient: insert con data_validity=needs_review, UNIQUE violation
 *   - searchFarms: con clientId (filtro), sin clientId (todos), vacío
 *   - createFarm: insert, validación de client_id, UNIQUE violation
 *   - getClientById / getFarmById: not found, found
 *   - setParcelClientFarm: UPDATE correcto, valid data_validity
 *
 * Mockeamos el pool de pg (db.query) para no tocar la BD.
 */

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Mocks
// ============================================================

const mockQuery = vi.fn();
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    query: (...args: unknown[]) => mockQuery(...args)
  })
}));

const {
  searchClients,
  createClient,
  getClientById,
  searchFarms,
  createFarm,
  getFarmById,
  setParcelClientFarm
} = await import("@/api/repositories");

// ============================================================
// Helpers
// ============================================================

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
// searchClients
// ============================================================

describe("searchClients", () => {
  it("empty query: lista los más recientes ordenados por updated_at DESC", async () => {
    mockQueryResolveOnce([
      { id: 1, name: "Agro A", updated_at: "2026-09-01" },
      { id: 2, name: "Agro B", updated_at: "2026-08-15" }
    ]);
    const result = await searchClients("", 10);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Agro A");
  });

  it("non-empty query: usa LIKE con starts-with y contains", async () => {
    mockQueryResolveOnce([{ id: 1, name: "Agro XYZ" }]);
    const result = await searchClients("agro", 10);
    expect(result).toHaveLength(1);
    // Verifica que el SQL incluye los placeholders esperados
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("LOWER(name) LIKE LOWER($1) || '%'");
    expect(sql).toContain("LOWER(name) LIKE '%' || LOWER($1) || '%'");
  });

  it("limit cap: limita a máximo 50 aunque se pida más", async () => {
    mockQueryResolveOnce([]);
    await searchClients("", 999);
    // El limit pasado a la query es 50, no 999
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(50);
  });

  it("devuelve array vacío si la BD no tiene resultados", async () => {
    mockQueryResolveOnce([]);
    const result = await searchClients("nada", 10);
    expect(result).toEqual([]);
  });
});

// ============================================================
// createClient
// ============================================================

describe("createClient", () => {
  it("trim name antes de insertar y setea data_validity=needs_review", async () => {
    mockQueryResolveOnce([{ id: 1, name: "Agro A", data_validity: "needs_review" }]);
    await createClient({ name: "  Agro A  ", created_by_email: "x@y.com" });
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe("Agro A"); // trim
    expect(params[1]).toBeNull(); // notes
    expect(params[2]).toBe("x@y.com");
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("INSERT INTO clients");
    expect(sql).toContain("VALUES ($1, $2, $3, 'needs_review')");
  });

  it("lanza error si name es vacío", async () => {
    await expect(
      createClient({ name: "   ", created_by_email: "x@y.com" })
    ).rejects.toThrow("name vacío");
  });

  it("propaga UNIQUE violation (23505) sin mappear", async () => {
    mockQueryRejectOnce(Object.assign(new Error("duplicate key"), { code: "23505" }));
    await expect(
      createClient({ name: "Agro A", created_by_email: "x@y.com" })
    ).rejects.toMatchObject({ code: "23505" });
  });
});

// ============================================================
// getClientById
// ============================================================

describe("getClientById", () => {
  it("devuelve el row si existe", async () => {
    mockQueryResolveOnce([{ id: 1, name: "Agro A" }]);
    const result = await getClientById(1);
    expect(result?.id).toBe(1);
  });

  it("devuelve null si no existe", async () => {
    mockQueryResolveOnce([]);
    const result = await getClientById(999);
    expect(result).toBeNull();
  });
});

// ============================================================
// searchFarms
// ============================================================

describe("searchFarms", () => {
  it("sin clientId y sin query: lista los más recientes", async () => {
    mockQueryResolveOnce([
      { id: 1, name: "La Esperanza", client_id: 1 },
      { id: 2, name: "La Esperanza 2", client_id: 1 }
    ]);
    const result = await searchFarms("", {});
    expect(result).toHaveLength(2);
  });

  it("con clientId: filtra por ese cliente", async () => {
    mockQueryResolveOnce([{ id: 1, name: "La Esperanza", client_id: 1 }]);
    await searchFarms("", { clientId: 1, limit: 10 });
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("client_id = $1");
  });

  it("con clientId y query: filtra por ambos", async () => {
    mockQueryResolveOnce([{ id: 1, name: "La Esperanza", client_id: 1 }]);
    await searchFarms("esper", { clientId: 1, limit: 10 });
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("client_id = $1");
    expect(sql).toContain("LOWER($2) || '%'");
  });

  it("limit cap a 50", async () => {
    mockQueryResolveOnce([]);
    await searchFarms("", { limit: 999 });
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[params.length - 1]).toBe(50);
  });
});

// ============================================================
// createFarm
// ============================================================

describe("createFarm", () => {
  it("trim name y setea data_validity=needs_review", async () => {
    mockQueryResolveOnce([{ id: 1, name: "La Esperanza", client_id: 1 }]);
    await createFarm({
      client_id: 1,
      name: "  La Esperanza  ",
      municipality: "Palmira",
      created_by_email: "x@y.com"
    });
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe("La Esperanza"); // trim
    expect(params[2]).toBe("Palmira");
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("INSERT INTO farms");
    expect(sql).toContain("VALUES ($1, $2, $3, $4, $5, 'needs_review')");
  });

  it("lanza error si name es vacío", async () => {
    await expect(
      createFarm({ client_id: 1, name: "  ", created_by_email: "x@y.com" })
    ).rejects.toThrow("name vacío");
  });

  it("lanza error si client_id no es positivo", async () => {
    await expect(
      createFarm({ client_id: 0, name: "X", created_by_email: "x@y.com" })
    ).rejects.toThrow("client_id requerido");
  });

  it("propaga UNIQUE violation (23505) cuando (client_id, name) ya existe", async () => {
    mockQueryRejectOnce(Object.assign(new Error("dup"), { code: "23505" }));
    await expect(
      createFarm({ client_id: 1, name: "La Esperanza", created_by_email: "x@y.com" })
    ).rejects.toMatchObject({ code: "23505" });
  });
});

// ============================================================
// getFarmById
// ============================================================

describe("getFarmById", () => {
  it("devuelve el row si existe", async () => {
    mockQueryResolveOnce([{ id: 1, name: "La Esperanza", client_id: 1 }]);
    const result = await getFarmById(1);
    expect(result?.id).toBe(1);
  });

  it("devuelve null si no existe", async () => {
    mockQueryResolveOnce([]);
    const result = await getFarmById(999);
    expect(result).toBeNull();
  });
});

// ============================================================
// setParcelClientFarm
// ============================================================

describe("setParcelClientFarm", () => {
  it("UPDATE con client_id y farm_id", async () => {
    mockQueryResolveOnce([{ id: 1, client_id: 5, farm_id: 10 }]);
    const result = await setParcelClientFarm({
      parcel_id: 1,
      client_id: 5,
      farm_id: 10
    });
    expect(result).toEqual({ parcel_id: 1, client_id: 5, farm_id: 10 });
  });

  it("con data_validity: actualiza last_validated_at y validated_by_email", async () => {
    mockQueryResolveOnce([{ id: 1, client_id: 5, farm_id: 10 }]);
    await setParcelClientFarm({
      parcel_id: 1,
      client_id: 5,
      farm_id: 10,
      data_validity: "fresh",
      validated_by_email: "x@y.com"
    });
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("data_validity = COALESCE($3, data_validity)");
    expect(sql).toContain("last_validated_at = CASE WHEN $3 IS NOT NULL THEN NOW()");
    expect(sql).toContain("validated_by_email = CASE WHEN $3 IS NOT NULL THEN $4");
  });

  it("lanza error si el parcel no existe", async () => {
    mockQueryResolveOnce([]);
    await expect(
      setParcelClientFarm({ parcel_id: 999, client_id: 5, farm_id: 10 })
    ).rejects.toThrow("parcel 999 no existe");
  });

  it("acepta null client_id y farm_id (unlink)", async () => {
    mockQueryResolveOnce([{ id: 1, client_id: null, farm_id: null }]);
    const result = await setParcelClientFarm({
      parcel_id: 1,
      client_id: null,
      farm_id: null
    });
    expect(result.client_id).toBeNull();
    expect(result.farm_id).toBeNull();
  });
});
