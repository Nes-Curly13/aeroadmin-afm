// tests/api-admin-parcels-create.test.ts
//
// Test unitario del route handler `POST /api/admin/parcels`
// (sprint 2026-08-04 — feature/parcel-onboarding, sub-sprint 1).
//
// Cubre:
//   - **Auth**: sin sesión → 401, viewer → 403, admin OK
//   - **Body validation**:
//     1. JSON malformado → 400
//     2. Body no-objeto → 400
//     3. `land_name` faltante → 400
//     4. `field_type` faltante → 400
//     5. `geometry` faltante o tipo inválido → 400
//     6. `luck_name` > 100 chars → 400
//   - **Success**: 201 con `parcel` devuelto (id, source='manual', etc.)
//   - **Error mapping**:
//     1. pg 23514 (CHECK) → 400
//     2. pg 23502 (NOT NULL) → 400
//     3. pg 23503 (FK) → 400
//     4. otro → 500

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Mocks (registrados ANTES del import del route)
// ============================================================

const mockQuery = vi.fn();
vi.mock("@/lib/db", () => ({
  getDb: () => ({ query: mockQuery })
}));

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args)
}));

const mockInvalidate = vi.fn();
vi.mock("@/lib/cache", () => ({
  invalidateAfterParcelMutation: () => mockInvalidate()
}));

// Importamos DESPUÉS de los mocks. `dynamic = "force-dynamic"` no aplica
// en tests (no hay Next runtime).
const { POST } = await import("@/app/api/admin/parcels/route");

// ============================================================
// Helpers
// ============================================================

const validBody = {
  land_name: "Lote 12 — Suerte 3",
  field_type: "Farmland",
  luck_name: "Suerte 3",
  client_name: "Ingenio La Cabaña",
  farm_name: "Hacienda El Edén",
  municipality: "Palmira",
  variety: "CC 85-92",
  crop_type: "Caña de azúcar",
  owner_name: "Juan Pérez",
  geometry: {
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
  }
};

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/parcels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockRequireRole.mockReset();
  mockInvalidate.mockReset();
  // Default: el INSERT devuelve un row con id=1, getParcelById lo lee.
  // El SELECT del getParcelById necesita muchos campos — devolvemos
  // un objeto con todos los campos que djiParcelsQuery espera.
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("INSERT INTO dji_parcels")) {
      return { rows: [{ id: 1 }] };
    }
    if (sql.includes("FROM dji_parcels") && sql.includes("WHERE p.id =")) {
      return {
        rows: [
          {
            id: 1,
            external_id: "manual-test-uuid",
            land_name: "Lote 12 — Suerte 3",
            field_type: "Farmland",
            source: "manual",
            luck_name: "Suerte 3",
            client_name: "Ingenio La Cabaña",
            farm_name: "Hacienda El Edén",
            municipality: "Palmira",
            variety: "CC 85-92",
            crop_type: "Caña de azúcar",
            owner_name: "Juan Pérez",
            deleted_at: null
          }
        ]
      };
    }
    return { rows: [] };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Auth
// ============================================================

describe("POST /api/admin/parcels — auth", () => {
  it("sin sesion → 401", async () => {
    mockRequireRole.mockRejectedValueOnce({ code: "UNAUTHENTICATED" });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("no autenticado");
  });

  it("viewer (no admin) → 403", async () => {
    mockRequireRole.mockRejectedValueOnce({ code: "FORBIDDEN" });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("rol insuficiente");
  });

  it("admin → pasa el gate", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(201);
  });
});

// ============================================================
// Body validation
// ============================================================

describe("POST /api/admin/parcels — body validation", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("JSON malformado → 400", async () => {
    const res = await POST(makeRequest("{invalid"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("body JSON invalido");
  });

  it("body no-objeto → 400", async () => {
    const res = await POST(makeRequest("[]"));
    expect(res.status).toBe(400);
  });

  it("land_name faltante → 400", async () => {
    const { land_name, ...rest } = validBody;
    void land_name;
    const res = await POST(makeRequest(rest));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/land_name/);
  });

  it("field_type faltante → 400", async () => {
    const { field_type, ...rest } = validBody;
    void field_type;
    const res = await POST(makeRequest(rest));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/field_type/);
  });

  it("geometry faltante → 400", async () => {
    const { geometry, ...rest } = validBody;
    void geometry;
    const res = await POST(makeRequest(rest));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/geometry/);
  });

  it("geometry tipo invalido (LineString) → 400", async () => {
    const res = await POST(
      makeRequest({
        ...validBody,
        geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }
      })
    );
    expect(res.status).toBe(400);
  });

  it("Polygon con menos de 4 vertices → 400", async () => {
    const res = await POST(
      makeRequest({
        ...validBody,
        geometry: {
          type: "Polygon",
          coordinates: [[[0, 0], [1, 0], [0, 0]]] // 3 = abierto
        }
      })
    );
    expect(res.status).toBe(400);
  });

  it("luck_name > 100 chars → 400", async () => {
    const res = await POST(
      makeRequest({ ...validBody, luck_name: "x".repeat(101) })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/luck_name/);
  });
});

// ============================================================
// Success path
// ============================================================

describe("POST /api/admin/parcels — success", () => {
  it("devuelve 201 + parcel con source='manual' y external_id='manual-*'", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      parcel: { id: number; source: string; external_id: string };
    };
    expect(body.parcel.id).toBe(1);
    expect(body.parcel.source).toBe("manual");
    expect(body.parcel.external_id).toMatch(/^manual-/);
  });

  it("ejecuta el INSERT con el body shape esperado", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    await POST(makeRequest(validBody));
    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO dji_parcels")
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    // params: [externalId, land_name, field_type, null, null, luck_name, ...]
    expect(params[1]).toBe("Lote 12 — Suerte 3");
    expect(params[2]).toBe("Farmland");
    expect(params[5]).toBe("Suerte 3");
  });

  it("llama invalidateAfterParcelMutation despues del commit", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    await POST(makeRequest(validBody));
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// Error mapping (pg error codes)
// ============================================================

describe("POST /api/admin/parcels — error mapping", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("pg 23514 (CHECK violation) → 400 con mensaje del error", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO dji_parcels")) {
        const err = new Error("check violation: luck_name > 100") as Error & {
          code: string;
        };
        err.code = "23514";
        throw err;
      }
      return { rows: [] };
    });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(400);
  });

  it("pg 23502 (NOT NULL violation) → 400", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO dji_parcels")) {
        const err = new Error("null value in column 'land_name'") as Error & {
          code: string;
        };
        err.code = "23502";
        throw err;
      }
      return { rows: [] };
    });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(400);
  });

  it("pg 23503 (FK violation) → 400", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO dji_parcels")) {
        const err = new Error("FK violation") as Error & { code: string };
        err.code = "23503";
        throw err;
      }
      return { rows: [] };
    });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(400);
  });

  it("error desconocido → 500", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO dji_parcels")) {
        throw new Error("DB explosion");
      }
      return { rows: [] };
    });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; detail?: string };
    expect(body.error).toBe("error interno");
    expect(body.detail).toBe("DB explosion");
  });
});
