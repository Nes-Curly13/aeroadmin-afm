/**
 * tests/api-admin-dji-vehicles.test.ts
 *
 * Test unitario de los endpoints:
 *   - GET  /api/admin/dji-vehicles
 *   - POST /api/admin/dji-vehicles
 *
 * Sprint S7 — feature/s7-schema-extension / Fase 1 / PR-B.
 *
 * Cubre:
 *   - GET: happy path con search + limit
 *   - GET: search vacío devuelve lista default (sin search, el repo
 *     decide si devolver recientes)
 *   - GET: limit clamping (max 50, min 1)
 *   - GET: 401 si no autenticado, 403 si rol insuficiente
 *   - GET: 500 si el repo falla
 *   - POST: happy path → 201 + vehicle
 *   - POST: idempotente (plate existente) → 200 + vehicle existente
 *   - POST: plate faltante → 400
 *   - POST: plate formato inválido (regex) → 400
 *   - POST: normalización a UPPER
 *   - POST: 401/403 auth
 *   - POST: 500 si repo falla
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Mocks
// ============================================================

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args)
}));

const mockSearchDjiVehicles = vi.fn();
const mockCreateDjiVehicle = vi.fn();
const mockFindDjiVehicleByPlate = vi.fn();

vi.mock("@/api/repositories", () => ({
  searchDjiVehicles: (...args: unknown[]) => mockSearchDjiVehicles(...args),
  createDjiVehicle: (...args: unknown[]) => mockCreateDjiVehicle(...args),
  findDjiVehicleByPlate: (...args: unknown[]) => mockFindDjiVehicleByPlate(...args)
}));

beforeEach(() => {
  mockRequireRole.mockReset();
  mockSearchDjiVehicles.mockReset();
  mockCreateDjiVehicle.mockReset();
  mockFindDjiVehicleByPlate.mockReset();
  // Default: role OK
  mockRequireRole.mockResolvedValue({ role: "admin" });
});

afterEach(() => {
  vi.clearAllMocks();
});

const SAMPLE_VEHICLE = {
  id: 1,
  plate: "ABC-1234",
  description: "Toyota Hilux 2020",
  is_active: true,
  created_at: "2026-08-20T10:00:00.000Z"
};

// ============================================================
// GET /api/admin/dji-vehicles
// ============================================================

describe("GET /api/admin/dji-vehicles", () => {
  it("happy path: search + limit", async () => {
    mockSearchDjiVehicles.mockResolvedValueOnce([SAMPLE_VEHICLE]);
    const { GET } = await import("@/app/api/admin/dji-vehicles/route");
    const req = new Request("http://x/api/admin/dji-vehicles?search=ABC&limit=5", {
      method: "GET"
    });
    const res = await GET(req);
    const body = (await res.json()) as { vehicles: unknown[] };
    expect(res.status).toBe(200);
    expect(body.vehicles).toHaveLength(1);
    expect(mockSearchDjiVehicles).toHaveBeenCalledWith("ABC", 5);
  });

  it("search vacío → searchDjiVehicles con string vacío", async () => {
    mockSearchDjiVehicles.mockResolvedValueOnce([]);
    const { GET } = await import("@/app/api/admin/dji-vehicles/route");
    const req = new Request("http://x/api/admin/dji-vehicles", { method: "GET" });
    const res = await GET(req);
    expect(res.status).toBe(200);
    // El route pasa el search sin trim interno (trim en el URL parser).
    expect(mockSearchDjiVehicles).toHaveBeenCalledWith("", 10);
  });

  it("limit fuera de rango se clampa (max 50, min 1)", async () => {
    mockSearchDjiVehicles.mockResolvedValue([]);
    const { GET } = await import("@/app/api/admin/dji-vehicles/route");
    // limit=999 → 50
    const r1 = await GET(
      new Request("http://x/api/admin/dji-vehicles?limit=999", { method: "GET" })
    );
    expect(r1.status).toBe(200);
    expect(mockSearchDjiVehicles).toHaveBeenLastCalledWith("", 50);
    // limit=0 → 1
    const r2 = await GET(
      new Request("http://x/api/admin/dji-vehicles?limit=0", { method: "GET" })
    );
    expect(r2.status).toBe(200);
    expect(mockSearchDjiVehicles).toHaveBeenLastCalledWith("", 1);
    // limit=abc → fallback a 10
    const r3 = await GET(
      new Request("http://x/api/admin/dji-vehicles?limit=abc", { method: "GET" })
    );
    expect(r3.status).toBe(200);
    expect(mockSearchDjiVehicles).toHaveBeenLastCalledWith("", 10);
  });

  it("401 si no autenticado", async () => {
    const e = new Error("no auth") as Error & { code: string };
    e.code = "UNAUTHENTICATED";
    mockRequireRole.mockRejectedValueOnce(e);
    const { GET } = await import("@/app/api/admin/dji-vehicles/route");
    const res = await GET(new Request("http://x/api/admin/dji-vehicles", { method: "GET" }));
    expect(res.status).toBe(401);
  });

  it("403 si rol insuficiente", async () => {
    const e = new Error("forbidden") as Error & { code: string };
    e.code = "FORBIDDEN";
    mockRequireRole.mockRejectedValueOnce(e);
    const { GET } = await import("@/app/api/admin/dji-vehicles/route");
    const res = await GET(new Request("http://x/api/admin/dji-vehicles", { method: "GET" }));
    expect(res.status).toBe(403);
  });

  it("500 si el repo falla", async () => {
    mockSearchDjiVehicles.mockRejectedValueOnce(new Error("BD caída"));
    const { GET } = await import("@/app/api/admin/dji-vehicles/route");
    const res = await GET(new Request("http://x/api/admin/dji-vehicles", { method: "GET" }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/BD caída/);
  });
});

// ============================================================
// POST /api/admin/dji-vehicles
// ============================================================

describe("POST /api/admin/dji-vehicles", () => {
  it("happy path: crea vehicle nuevo → 201", async () => {
    mockFindDjiVehicleByPlate.mockResolvedValueOnce(null);
    mockCreateDjiVehicle.mockResolvedValueOnce(SAMPLE_VEHICLE);
    const { POST } = await import("@/app/api/admin/dji-vehicles/route");
    const req = new Request("http://x/api/admin/dji-vehicles", {
      method: "POST",
      body: JSON.stringify({ plate: "abc-1234", description: "Toyota" })
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { vehicle: { plate: string } };
    expect(body.vehicle.plate).toBe("ABC-1234");
    // Server normaliza a UPPER antes de pasar al repo.
    expect(mockFindDjiVehicleByPlate).toHaveBeenCalledWith("ABC-1234");
    expect(mockCreateDjiVehicle).toHaveBeenCalledWith({
      plate: "ABC-1234",
      description: "Toyota"
    });
  });

  it("idempotente: plate existente → 200 con el row existente", async () => {
    mockFindDjiVehicleByPlate.mockResolvedValueOnce(SAMPLE_VEHICLE);
    const { POST } = await import("@/app/api/admin/dji-vehicles/route");
    const req = new Request("http://x/api/admin/dji-vehicles", {
      method: "POST",
      body: JSON.stringify({ plate: "ABC-1234" })
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    // NO llama a create si ya existe.
    expect(mockCreateDjiVehicle).not.toHaveBeenCalled();
    const body = (await res.json()) as { vehicle: { id: number } };
    expect(body.vehicle.id).toBe(1);
  });

  it("plate faltante → 400", async () => {
    const { POST } = await import("@/app/api/admin/dji-vehicles/route");
    const req = new Request("http://x/api/admin/dji-vehicles", {
      method: "POST",
      body: JSON.stringify({})
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/plate requerido/);
  });

  it("plate formato inválido → 400 (regex)", async () => {
    const { POST } = await import("@/app/api/admin/dji-vehicles/route");
    const cases: Array<[string, string]> = [
      ["AB", "muy corto (3-12 chars)"],
      ["ABCDEFGHIJKLMN", "muy largo"],
      ["ABC 1234", "espacio no permitido"],
      ["abc.1234", "punto no permitido"]
    ];
    for (const [plate, hint] of cases) {
      const req = new Request("http://x/api/admin/dji-vehicles", {
        method: "POST",
        body: JSON.stringify({ plate })
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/plate inválido/);
      // solo doc — el comentario ayuda a debuggear si un case falla
      void hint;
    }
  });

  it("description > 200 chars → 400", async () => {
    const { POST } = await import("@/app/api/admin/dji-vehicles/route");
    const req = new Request("http://x/api/admin/dji-vehicles", {
      method: "POST",
      body: JSON.stringify({
        plate: "ABC-1234",
        description: "a".repeat(201)
      })
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("description null → OK (campo opcional)", async () => {
    mockFindDjiVehicleByPlate.mockResolvedValueOnce(null);
    mockCreateDjiVehicle.mockResolvedValueOnce({ ...SAMPLE_VEHICLE, description: null });
    const { POST } = await import("@/app/api/admin/dji-vehicles/route");
    const req = new Request("http://x/api/admin/dji-vehicles", {
      method: "POST",
      body: JSON.stringify({ plate: "ABC-1234", description: null })
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mockCreateDjiVehicle).toHaveBeenCalledWith({
      plate: "ABC-1234",
      description: null
    });
  });

  it("body inválido (no JSON) → 400", async () => {
    const { POST } = await import("@/app/api/admin/dji-vehicles/route");
    const req = new Request("http://x/api/admin/dji-vehicles", {
      method: "POST",
      body: "no es json"
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("401/403 auth", async () => {
    const e401 = new Error("no auth") as Error & { code: string };
    e401.code = "UNAUTHENTICATED";
    mockRequireRole.mockRejectedValueOnce(e401);
    const { POST } = await import("@/app/api/admin/dji-vehicles/route");
    const r1 = await POST(
      new Request("http://x/api/admin/dji-vehicles", {
        method: "POST",
        body: JSON.stringify({ plate: "ABC-1234" })
      })
    );
    expect(r1.status).toBe(401);

    const e403 = new Error("forbidden") as Error & { code: string };
    e403.code = "FORBIDDEN";
    mockRequireRole.mockRejectedValueOnce(e403);
    const r2 = await POST(
      new Request("http://x/api/admin/dji-vehicles", {
        method: "POST",
        body: JSON.stringify({ plate: "ABC-1234" })
      })
    );
    expect(r2.status).toBe(403);
  });

  it("500 si el repo falla", async () => {
    mockFindDjiVehicleByPlate.mockRejectedValueOnce(new Error("DB down"));
    const { POST } = await import("@/app/api/admin/dji-vehicles/route");
    const req = new Request("http://x/api/admin/dji-vehicles", {
      method: "POST",
      body: JSON.stringify({ plate: "ABC-1234" })
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it("plate vacio con espacios → 400", async () => {
    const { POST } = await import("@/app/api/admin/dji-vehicles/route");
    const req = new Request("http://x/api/admin/dji-vehicles", {
      method: "POST",
      body: JSON.stringify({ plate: "   " })
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
