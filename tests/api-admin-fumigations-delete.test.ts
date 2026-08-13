// tests/api-admin-fumigations-delete.test.ts
//
// Test unitario del route handler `DELETE /api/admin/fumigations/[id]`
// (feature/fumigacion-detail-v2 / sub-4).
//
// Cubre:
//   - 200 OK + fumigación devuelta cuando soft-delete funciona
//   - 404 cuando fumigación no existe
//   - 401 cuando no hay sesión
//   - 403 cuando rol es viewer (no admin/supervisor)
//   - 400 cuando id inválido (no numérico, <= 0)
//   - Idempotente: borrar dos veces devuelve 200 la segunda también
//   - `deleted_by` se setea con el email del session user
//
// Mocks: requireRole, auth, softDeleteFumigationEvent (del repository).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSoftDelete = vi.fn();
vi.mock("@/api/repositories", () => ({
  softDeleteFumigationEvent: (...args: unknown[]) => mockSoftDelete(...args)
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
  "../app/api/admin/fumigations/[id]/route.js" as string
);
const route: { DELETE: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> } =
  (routeModule as unknown as { DELETE: typeof route.DELETE });

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeReq(): Request {
  return new Request("http://localhost:3000/api/admin/fumigations/1", {
    method: "DELETE"
  });
}

const SESSION_USER = { user: { email: "supervisor@afm.local" } };

const FUMIGATION_DELETED = {
  id: 1,
  parcel_id: 42,
  fumigation_date: "2026-08-13",
  product_used: "Glifosato 48%",
  dose_l_per_ha: 2.5,
  area_fumigated_m2: 12_345,
  drone_code_used: 201,
  duration_minutes: 45,
  notes: null,
  human_notes: null,
  recorded_by: "supervisor@afm.local",
  product_registered_ica: null,
  pilot_license: null,
  recorded_at: "2026-08-13T15:00:00.000Z",
  source: "manual" as const,
  category_id: 1,
  deleted_at: "2026-08-14T10:00:00.000Z",
  deleted_by: "supervisor@afm.local"
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(SESSION_USER);
  // Default: requireRole pasa (admin/supervisor OK).
  mockRequireRole.mockResolvedValue(undefined);
  // Default: soft-delete exitoso.
  mockSoftDelete.mockResolvedValue(FUMIGATION_DELETED);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Auth
// ============================================================

describe("DELETE /api/admin/fumigations/[id] — auth", () => {
  it("devuelve 401 si no hay sesión", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("no session"), { code: "UNAUTHENTICATED" })
    );
    const res = await route.DELETE(makeReq(), makeCtx("1"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("no autenticado");
  });

  it("devuelve 403 cuando el rol no es admin ni supervisor (ej. viewer)", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("not allowed"), { code: "FORBIDDEN" })
    );
    const res = await route.DELETE(makeReq(), makeCtx("1"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("rol insuficiente");
  });

  it("pasa el gate con role=admin", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    const res = await route.DELETE(makeReq(), makeCtx("1"));
    expect(res.status).toBe(200);
  });

  it("pasa el gate con role=supervisor", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    const res = await route.DELETE(makeReq(), makeCtx("1"));
    expect(res.status).toBe(200);
  });

  it("requireRole es llamado con ['admin', 'supervisor']", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    await route.DELETE(makeReq(), makeCtx("1"));
    expect(mockRequireRole).toHaveBeenCalledWith(["admin", "supervisor"]);
  });

  it("error genérico de requireRole cae a 500", async () => {
    mockRequireRole.mockRejectedValueOnce(
      new Error("auth provider crashed")
    );
    const res = await route.DELETE(makeReq(), makeCtx("1"));
    expect(res.status).toBe(500);
  });
});

// ============================================================
// Path param
// ============================================================

describe("DELETE .../fumigations/[id] — path param", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve 400 cuando el id no es numérico", async () => {
    const res = await route.DELETE(makeReq(), makeCtx("abc"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("id inválido");
    // No debe tocar la BD si el id es inválido.
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });

  it("devuelve 400 cuando el id es <= 0", async () => {
    const res = await route.DELETE(makeReq(), makeCtx("0"));
    expect(res.status).toBe(400);
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });

  it("devuelve 400 cuando el id es negativo", async () => {
    const res = await route.DELETE(makeReq(), makeCtx("-1"));
    expect(res.status).toBe(400);
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });
});

// ============================================================
// 404 / éxito
// ============================================================

describe("DELETE .../fumigations/[id] — éxito y 404", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve 200 con la fumigación cuando soft-delete funciona", async () => {
    const res = await route.DELETE(makeReq(), makeCtx("1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fumigation.id).toBe(1);
    expect(body.fumigation.deleted_by).toBe("supervisor@afm.local");
  });

  it("devuelve 404 cuando la fumigación no existe", async () => {
    mockSoftDelete.mockResolvedValueOnce(null);
    const res = await route.DELETE(makeReq(), makeCtx("9999"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("fumigación no encontrada");
  });

  it("softDeleteFumigationEvent es llamado con (id, deletedBy)", async () => {
    await route.DELETE(makeReq(), makeCtx("42"));
    expect(mockSoftDelete).toHaveBeenCalledTimes(1);
    const [id, deletedBy] = mockSoftDelete.mock.calls[0];
    expect(id).toBe(42);
    expect(deletedBy).toBe("supervisor@afm.local");
  });

  it("deleted_by se setea con el email del session user", async () => {
    mockAuth.mockResolvedValueOnce({ user: { email: "otro@afm.local" } });
    await route.DELETE(makeReq(), makeCtx("42"));
    const deletedBy = mockSoftDelete.mock.calls[0][1];
    expect(deletedBy).toBe("otro@afm.local");
  });

  it("deleted_by cae a 'unknown@...' si no hay session (defensa en profundidad)", async () => {
    mockAuth.mockResolvedValueOnce(null);
    await route.DELETE(makeReq(), makeCtx("42"));
    const deletedBy = mockSoftDelete.mock.calls[0][1];
    expect(deletedBy).toMatch(/unknown@/);
  });
});

// ============================================================
// Idempotencia
// ============================================================

describe("DELETE .../fumigations/[id] — idempotencia", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("borrar dos veces la misma fumigación devuelve 200 en ambos calls", async () => {
    // softDelete es idempotente: la segunda vez la fumigación ya
    // está borrada pero el handler responde 200 con la fumigación.
    const res1 = await route.DELETE(makeReq(), makeCtx("1"));
    const res2 = await route.DELETE(makeReq(), makeCtx("1"));
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    // El repo se llama dos veces (cada DELETE genera un call).
    expect(mockSoftDelete).toHaveBeenCalledTimes(2);
  });

  it("si la fumigación ya está soft-deleted, la fumigación devuelta tiene deleted_at", async () => {
    // Simulamos que el repo devuelve la fumigación ya borrada.
    mockSoftDelete.mockResolvedValueOnce({
      ...FUMIGATION_DELETED,
      deleted_at: "2026-08-13T09:00:00.000Z", // ya estaba borrada antes
      deleted_by: "admin@afm.local"
    });
    const res = await route.DELETE(makeReq(), makeCtx("1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fumigation.deleted_at).toBe("2026-08-13T09:00:00.000Z");
  });
});

// ============================================================
// Errores del repository
// ============================================================

describe("DELETE .../fumigations/[id] — errores de repo", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve 500 si softDeleteFumigationEvent tira un error", async () => {
    mockSoftDelete.mockRejectedValueOnce(new Error("BD connection lost"));
    const res = await route.DELETE(makeReq(), makeCtx("1"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/BD connection lost/);
  });

  it("devuelve 500 con mensaje genérico si el error no tiene message", async () => {
    mockSoftDelete.mockRejectedValueOnce({});
    const res = await route.DELETE(makeReq(), makeCtx("1"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("error interno");
  });
});
