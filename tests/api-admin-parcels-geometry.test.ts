// tests/api-admin-parcels-geometry.test.ts
//
// Test unitario del route handler `PATCH /api/admin/parcels/[id]/geometry`
// (sprint 2026-08-04 — feature/parcel-onboarding, sub-sprint 1).
//
// Cubre:
//   - **Auth**: sin sesión → 401, viewer → 403, admin OK
//   - **Path param**: id inválido (no number, <=0) → 400
//   - **Body validation**:
//     1. JSON malformado → 400
//     2. change_reason faltante → 400
//     3. change_reason > 500 chars → 400
//     4. geometry tipo inválido (LineString) → 400
//     5. Polygon con menos de 4 vértices → 400
//   - **Success**: 200 + parcel con la nueva geometría
//   - **404**: parcel no existe (o está soft-deleted)
//   - **400**: el repo tira con code=VALIDATION (cualquier validación
//     que se salte el route handler)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { PATCH } = await import("@/app/api/admin/parcels/[id]/geometry/route");

const validGeom = {
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
};

const validBody = {
  geometry: validGeom,
  change_reason: "Operador corrigió el polígono después de verificar en campo"
};

function makeRequest(body: unknown, id = "42"): Request {
  return new Request(`http://localhost/api/admin/parcels/${id}/geometry`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockRequireRole.mockReset();
  mockInvalidate.mockReset();
  // Default: SELECT existencia devuelve 1 row → parcel existe.
  // UPDATE no tira.
  // Audit log best-effort: si la tabla no existe, el repo lo silencia.
  // getParcelById (el SELECT al final) devuelve la parcela con la
  // nueva geom.
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT id FROM dji_parcels") && sql.includes("deleted_at")) {
      return { rows: [{ id: 42 }] };
    }
    if (sql.includes("UPDATE dji_parcels")) {
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO djiag_audit_log")) {
      return { rows: [] };
    }
    if (sql.includes("FROM dji_parcels") && sql.includes("WHERE p.id =")) {
      return {
        rows: [
          {
            id: 42,
            land_name: "Lote 12",
            field_type: "Farmland",
            source: "manual",
            spray_geom: validGeom
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

describe("PATCH /api/admin/parcels/[id]/geometry — auth", () => {
  it("sin sesion → 401", async () => {
    mockRequireRole.mockRejectedValueOnce({ code: "UNAUTHENTICATED" });
    const res = await PATCH(makeRequest(validBody), {
      params: Promise.resolve({ id: "42" })
    });
    expect(res.status).toBe(401);
  });

  it("viewer → 403", async () => {
    mockRequireRole.mockRejectedValueOnce({ code: "FORBIDDEN" });
    const res = await PATCH(makeRequest(validBody), {
      params: Promise.resolve({ id: "42" })
    });
    expect(res.status).toBe(403);
  });

  it("admin → pasa el gate", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    const res = await PATCH(makeRequest(validBody), {
      params: Promise.resolve({ id: "42" })
    });
    expect(res.status).toBe(200);
  });
});

// ============================================================
// Path param + body
// ============================================================

describe("PATCH .../geometry — validation", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("id no numérico → 400", async () => {
    const res = await PATCH(makeRequest(validBody, "abc"), {
      params: Promise.resolve({ id: "abc" })
    });
    expect(res.status).toBe(400);
  });

  it("id <= 0 → 400", async () => {
    const res = await PATCH(makeRequest(validBody, "0"), {
      params: Promise.resolve({ id: "0" })
    });
    expect(res.status).toBe(400);
  });

  it("JSON malformado → 400", async () => {
    const res = await PATCH(makeRequest("{bad"), {
      params: Promise.resolve({ id: "42" })
    });
    expect(res.status).toBe(400);
  });

  it("change_reason faltante → 400", async () => {
    const res = await PATCH(
      makeRequest({ geometry: validGeom }),
      { params: Promise.resolve({ id: "42" }) }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/change_reason/);
  });

  it("change_reason > 500 chars → 400", async () => {
    const res = await PATCH(
      makeRequest({ ...validBody, change_reason: "x".repeat(501) }),
      { params: Promise.resolve({ id: "42" }) }
    );
    expect(res.status).toBe(400);
  });

  it("geometry tipo LineString → 400", async () => {
    const res = await PATCH(
      makeRequest({
        ...validBody,
        geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }
      }),
      { params: Promise.resolve({ id: "42" }) }
    );
    expect(res.status).toBe(400);
  });

  it("Polygon con 3 vertices (sin cierre) → 400", async () => {
    const res = await PATCH(
      makeRequest({
        ...validBody,
        geometry: {
          type: "Polygon",
          coordinates: [[[0, 0], [1, 0], [0, 0]]]
        }
      }),
      { params: Promise.resolve({ id: "42" }) }
    );
    expect(res.status).toBe(400);
  });
});

// ============================================================
// Success + 404
// ============================================================

describe("PATCH .../geometry — success & 404", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("parcel existe → 200 + parcel devuelto", async () => {
    const res = await PATCH(makeRequest(validBody), {
      params: Promise.resolve({ id: "42" })
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { parcel: { id: number; source: string } };
    expect(body.parcel.id).toBe(42);
  });

  it("UPDATE con la nueva geom", async () => {
    await PATCH(makeRequest(validBody), {
      params: Promise.resolve({ id: "42" })
    });
    const updateCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("UPDATE dji_parcels")
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual([42, JSON.stringify(validGeom)]);
  });

  it("llama invalidateAfterParcelMutation", async () => {
    await PATCH(makeRequest(validBody), {
      params: Promise.resolve({ id: "42" })
    });
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });

  it("parcel no existe (o soft-deleted) → 404", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id FROM dji_parcels") && sql.includes("deleted_at")) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const res = await PATCH(makeRequest(validBody), {
      params: Promise.resolve({ id: "999" })
    });
    expect(res.status).toBe(404);
  });

  it("best-effort: audit log falla → el PATCH sigue siendo 200", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id FROM dji_parcels") && sql.includes("deleted_at")) {
        return { rows: [{ id: 42 }] };
      }
      if (sql.includes("UPDATE dji_parcels")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO djiag_audit_log")) {
        throw new Error("table djiag_audit_log does not exist");
      }
      if (sql.includes("FROM dji_parcels") && sql.includes("WHERE p.id =")) {
        return { rows: [{ id: 42, source: "manual" }] };
      }
      return { rows: [] };
    });
    const res = await PATCH(makeRequest(validBody), {
      params: Promise.resolve({ id: "42" })
    });
    expect(res.status).toBe(200);
  });
});
