// Tests del route handler POST /api/admin/fumigations/[id]/assign-parcel
// (2026-09-20 — asignación de parcela a fumigaciones huérfanas).
//
// Cubre:
//   - 200 OK + fumigación actualizada
//   - 400 si parcel_id falta / no es entero positivo
//   - 400 si el id no es numérico
//   - 400 si body no es JSON
//   - 404 si la fumigación no existe
//   - 400 si la parcela no existe (PARCEL_NOT_FOUND)
//   - 401 / 403 / 500 auth
//   - requireRole se llama con ['admin','supervisor']

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAssign = vi.fn();
const mockGetById = vi.fn();
vi.mock("@/api/repositories", () => ({
  assignFumigationParcel: (...args: unknown[]) => mockAssign(...args),
  getFumigationById: (...args: unknown[]) => mockGetById(...args)
}));

const mockRecordEdit = vi.fn();
vi.mock("@/lib/fumigation-audit", () => ({
  recordFumigationEdit: (...args: unknown[]) => mockRecordEdit(...args)
}));

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args)
}));

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: () => mockAuth()
}));

const routeModule = await import(
  "../app/api/admin/fumigations/[id]/assign-parcel/route.js" as string
);
const route: {
  POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
} = routeModule as unknown as {
  POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
};

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeReq(body: unknown): Request {
  return new Request("http://localhost:3000/api/admin/fumigations/1/assign-parcel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

const ORPHAN_BEFORE = {
  id: 7,
  parcel_id: null,
  fumigation_date: "2026-09-08",
  needs_parcel_assignment: true,
  assignment_note: "3 vuelos sin parcela",
  source: "import" as const
};

const ASSIGNED = {
  ...ORPHAN_BEFORE,
  parcel_id: 42,
  needs_parcel_assignment: false,
  assignment_note: null
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { email: "supervisor@afm.local" } });
  mockRequireRole.mockResolvedValue(undefined);
  mockGetById.mockResolvedValue(ORPHAN_BEFORE);
  mockAssign.mockResolvedValue(ASSIGNED);
  mockRecordEdit.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST assign-parcel — auth", () => {
  it("401 sin sesión", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("no session"), { code: "UNAUTHENTICATED" })
    );
    const res = await route.POST(makeReq({ parcel_id: 42 }), makeCtx("7"));
    expect(res.status).toBe(401);
  });

  it("403 con rol insuficiente", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("nope"), { code: "FORBIDDEN" })
    );
    const res = await route.POST(makeReq({ parcel_id: 42 }), makeCtx("7"));
    expect(res.status).toBe(403);
  });

  it("500 con error genérico de auth", async () => {
    mockRequireRole.mockRejectedValueOnce(new Error("boom"));
    const res = await route.POST(makeReq({ parcel_id: 42 }), makeCtx("7"));
    expect(res.status).toBe(500);
  });

  it("requireRole con ['admin','supervisor']", async () => {
    await route.POST(makeReq({ parcel_id: 42 }), makeCtx("7"));
    expect(mockRequireRole).toHaveBeenCalledWith(["admin", "supervisor"]);
  });
});

describe("POST assign-parcel — validación", () => {
  it("400 si el id no es numérico", async () => {
    const res = await route.POST(makeReq({ parcel_id: 42 }), makeCtx("abc"));
    expect(res.status).toBe(400);
    expect(mockAssign).not.toHaveBeenCalled();
  });

  it("400 si parcel_id falta", async () => {
    const res = await route.POST(makeReq({}), makeCtx("7"));
    expect(res.status).toBe(400);
    expect(mockAssign).not.toHaveBeenCalled();
  });

  it("400 si parcel_id no es entero positivo", async () => {
    for (const bad of [0, -1, 1.5, "42", null]) {
      const res = await route.POST(makeReq({ parcel_id: bad }), makeCtx("7"));
      expect(res.status).toBe(400);
    }
    expect(mockAssign).not.toHaveBeenCalled();
  });

  it("400 si el body no es JSON válido", async () => {
    const req = new Request("http://localhost:3000/api/admin/fumigations/7/assign-parcel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not json"
    });
    const res = await route.POST(req, makeCtx("7"));
    expect(res.status).toBe(400);
  });
});

describe("POST assign-parcel — comportamiento", () => {
  it("200 + fumigación asignada y registra el audit", async () => {
    const res = await route.POST(makeReq({ parcel_id: 42 }), makeCtx("7"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { fumigation: typeof ASSIGNED };
    expect(json.fumigation.parcel_id).toBe(42);
    expect(json.fumigation.needs_parcel_assignment).toBe(false);
    expect(mockAssign).toHaveBeenCalledWith(7, 42);
    expect(mockRecordEdit).toHaveBeenCalledWith(
      ORPHAN_BEFORE,
      ASSIGNED,
      "supervisor@afm.local"
    );
  });

  it("404 si la fumigación no existe", async () => {
    mockGetById.mockResolvedValueOnce(null);
    const res = await route.POST(makeReq({ parcel_id: 42 }), makeCtx("7"));
    expect(res.status).toBe(404);
    expect(mockAssign).not.toHaveBeenCalled();
  });

  it("400 si la parcela no existe (PARCEL_NOT_FOUND)", async () => {
    mockAssign.mockRejectedValueOnce(
      Object.assign(new Error("parcela no encontrada"), { code: "PARCEL_NOT_FOUND" })
    );
    const res = await route.POST(makeReq({ parcel_id: 999 }), makeCtx("7"));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/parcela/i);
  });

  it("500 si el repo falla con error inesperado", async () => {
    mockAssign.mockRejectedValueOnce(new Error("db down"));
    const res = await route.POST(makeReq({ parcel_id: 42 }), makeCtx("7"));
    expect(res.status).toBe(500);
  });
});
