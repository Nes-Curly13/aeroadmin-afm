/**
 * tests/api-admin-parcels-import-commit.test.ts
 *
 * Unit tests del route handler POST /api/admin/parcels/import/commit.
 * Mockeamos createManualParcelsBulk y requireRole.
 *
 * Cubre:
 *   - Auth (401/403)
 *   - Body inválido (no JSON, falta parcels, > 1000)
 *   - Validación de inputs delegados al repo
 *   - Success 201 con {created: [...]}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Mocks
// ============================================================

const mockBulkCreate = vi.fn();
vi.mock("@/api/repositories", () => ({
  createManualParcelsBulk: (...args: unknown[]) => mockBulkCreate(...args)
}));

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args)
}));

const { POST } = await import("@/app/api/admin/parcels/import/commit/route");

// ============================================================
// Helpers
// ============================================================

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/admin/parcels/import/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

const validParcel = {
  name: "Lote 1",
  geometry: {
    type: "Polygon",
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
  }
};

// ============================================================
// Tests
// ============================================================

describe("POST /api/admin/parcels/import/commit", () => {
  beforeEach(() => {
    mockBulkCreate.mockReset();
    mockRequireRole.mockReset();
    mockRequireRole.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sin sesión → 401", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("UNAUTHENTICATED"), { code: "UNAUTHENTICATED" })
    );
    const res = await POST(makeRequest({ parcels: [validParcel] }) as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(401);
  });

  it("body sin 'parcels' → 400", async () => {
    const res = await POST(makeRequest({}) as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/parcels/);
  });

  it("parcels vacío → 400", async () => {
    const res = await POST(makeRequest({ parcels: [] }) as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(400);
  });

  it("parcels > 1000 → 400 (límite MVP)", async () => {
    const huge = Array.from({ length: 1001 }, () => validParcel);
    const res = await POST(makeRequest({ parcels: huge }) as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/1000/);
  });

  it("body no es JSON válido → 400", async () => {
    const req = new Request("http://localhost:3000/api/admin/parcels/import/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "no es JSON"
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(400);
  });

  it("validation error del repo → 400 con mensaje", async () => {
    mockBulkCreate.mockRejectedValueOnce(
      new Error("Parcela #1 (Lote X): land_name es obligatorio")
    );
    const res = await POST(makeRequest({ parcels: [validParcel] }) as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/land_name/);
  });

  it("happy path: 201 con created[]", async () => {
    mockBulkCreate.mockResolvedValueOnce([
      { id: 100, land_name: "Lote 1" },
      { id: 101, land_name: "Lote 2" }
    ]);
    const res = await POST(
      makeRequest({ parcels: [validParcel, { ...validParcel, name: "Lote 2" }] }) as unknown as import("next/server").NextRequest
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toHaveLength(2);
    expect(body.created[0].id).toBe(100);
    expect(mockBulkCreate).toHaveBeenCalledTimes(1);
    // Verificamos que el repo recibió los 2 parcels
    const callArgs = mockBulkCreate.mock.calls[0][0] as unknown[];
    expect(callArgs).toHaveLength(2);
  });
});
