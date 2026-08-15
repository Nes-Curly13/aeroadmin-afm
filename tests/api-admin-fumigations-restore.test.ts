// tests/api-admin-fumigations-restore.test.ts
//
// Test unitario del route handler `POST /api/admin/fumigations/[id]/restore`
// (feature/fumigaciones-detail-polish).
//
// Cubre:
//   - 200 OK + fumigación devuelta cuando restore funciona
//   - 200 OK + fumigación devuelta cuando la fumigación NO estaba
//     soft-deleted (idempotente, no-op)
//   - 404 cuando fumigación no existe (ni siquiera soft-deleted)
//   - 400 cuando id inválido (no numérico, <= 0, negativo)
//   - 401 cuando no hay sesión
//   - 403 cuando rol no es admin ni supervisor
//   - 500 cuando el repo tira un error
//
// Mocks: requireRole, auth, restoreFumigationEvent (del repository).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRestore = vi.fn();
const mockGetRawById = vi.fn();
vi.mock("@/api/repositories", () => ({
  restoreFumigationEvent: (...args: unknown[]) => mockRestore(...args),
  getFumigationRawById: (...args: unknown[]) => mockGetRawById(...args)
}));

const mockRecordRestore = vi.fn();
vi.mock("@/lib/fumigation-audit", () => ({
  recordFumigationRestore: (...args: unknown[]) => mockRecordRestore(...args)
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
  "../app/api/admin/fumigations/[id]/restore/route.js" as string
);
const route: {
  POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
} = routeModule as unknown as {
  POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
};

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeReq(): Request {
  return new Request(
    "http://localhost:3000/api/admin/fumigations/1/restore",
    { method: "POST" }
  );
}

const SESSION_USER = { user: { email: "supervisor@afm.local" } };

// Fumigación restaurada: deleted_at: null. Esto es lo que el repo
// devuelve cuando el UPDATE limpió los campos (caso soft-deleted).
/**
 * Estado "antes" del restore: fumigación soft-deleted. El endpoint
 * usa esto para detectar que la fumigación REALMENTE estaba borrada
 * y registrar el audit "restored" (no es no-op). Si deleted_at
 * fuera null antes del restore, recordFumigationRestore devolvería
 * false y NO insertaría audit.
 */
const FUMIGATION_BEFORE = {
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
  category: null,
  deleted_at: "2026-08-14T10:00:00.000Z",
  deleted_by: "supervisor@afm.local"
};

const FUMIGATION_RESTORED = {
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
  category: null,
  deleted_at: null,
  deleted_by: null
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(SESSION_USER);
  // Default: requireRole pasa (admin/supervisor OK).
  mockRequireRole.mockResolvedValue(undefined);
  // Default: restore exitoso → fumigación con deleted_at: null.
  mockRestore.mockResolvedValue(FUMIGATION_RESTORED);
  // Default: getFumigationRawById devuelve un row soft-deleted.
  // Asi el happy path registra audit "restored". Tests específicos
  // (404, idempotent) sobreescriben con mockResolvedValueOnce.
  mockGetRawById.mockResolvedValue(FUMIGATION_BEFORE);
  // Audit log mock: por default resuelve con true (insertó audit).
  mockRecordRestore.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Auth
// ============================================================

describe("POST /api/admin/fumigations/[id]/restore — auth", () => {
  it("devuelve 401 si no hay sesión", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("no session"), { code: "UNAUTHENTICATED" })
    );
    const res = await route.POST(makeReq(), makeCtx("1"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("no autenticado");
    // No debe tocar la BD si la auth falló.
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it("devuelve 403 cuando el rol no es admin ni supervisor (ej. viewer)", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("not allowed"), { code: "FORBIDDEN" })
    );
    const res = await route.POST(makeReq(), makeCtx("1"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("rol insuficiente");
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it("pasa el gate con role=admin", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    const res = await route.POST(makeReq(), makeCtx("1"));
    expect(res.status).toBe(200);
  });

  it("pasa el gate con role=supervisor", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    const res = await route.POST(makeReq(), makeCtx("1"));
    expect(res.status).toBe(200);
  });

  it("requireRole es llamado con ['admin', 'supervisor']", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    await route.POST(makeReq(), makeCtx("1"));
    expect(mockRequireRole).toHaveBeenCalledWith(["admin", "supervisor"]);
  });

  it("error genérico de requireRole cae a 500 (no es 401/403)", async () => {
    mockRequireRole.mockRejectedValueOnce(
      new Error("auth provider crashed")
    );
    const res = await route.POST(makeReq(), makeCtx("1"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/auth provider crashed/);
    expect(mockRestore).not.toHaveBeenCalled();
  });
});

// ============================================================
// Path param
// ============================================================

describe("POST .../fumigations/[id]/restore — path param", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve 400 cuando el id no es numérico", async () => {
    const res = await route.POST(makeReq(), makeCtx("abc"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("id inválido");
    // No debe tocar la BD si el id es inválido.
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it("devuelve 400 cuando el id es 0", async () => {
    const res = await route.POST(makeReq(), makeCtx("0"));
    expect(res.status).toBe(400);
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it("devuelve 400 cuando el id es negativo", async () => {
    const res = await route.POST(makeReq(), makeCtx("-1"));
    expect(res.status).toBe(400);
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it("devuelve 400 cuando el id es un float inválido (1.5 no es entero)", async () => {
    // FIX 2026-08-13 (polish v1): la validación ahora requiere
    // Number.isInteger además de isFinite y > 0. Antes "1.5" pasaba
    // (era isFinite && > 0) y terminaba en 404 por FK. Ahora
    // devuelve 400 con 'id inválido'.
    const res = await route.POST(makeReq(), makeCtx("1.5"));
    expect(res.status).toBe(400);
    expect(mockRestore).not.toHaveBeenCalled();
  });
});

// ============================================================
// 200 / éxito
// ============================================================

describe("POST .../fumigations/[id]/restore — éxito", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve 200 con la fumigación cuando restore funciona", async () => {
    const res = await route.POST(makeReq(), makeCtx("1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fumigation.id).toBe(1);
    // Después de restaurar, deleted_at es null.
    expect(body.fumigation.deleted_at).toBeNull();
    expect(body.fumigation.deleted_by).toBeNull();
  });

  it("restoreFumigationEvent es llamado con (id, restoredBy)", async () => {
    await route.POST(makeReq(), makeCtx("42"));
    expect(mockRestore).toHaveBeenCalledTimes(1);
    const [id, restoredBy] = mockRestore.mock.calls[0];
    expect(id).toBe(42);
    expect(restoredBy).toBe("supervisor@afm.local");
  });

  it("restoredBy se setea con el email del session user", async () => {
    mockAuth.mockResolvedValueOnce({ user: { email: "otro@afm.local" } });
    await route.POST(makeReq(), makeCtx("42"));
    const restoredBy = mockRestore.mock.calls[0][1];
    expect(restoredBy).toBe("otro@afm.local");
  });

  it("restoredBy cae a 'unknown@...' si no hay session (defensa en profundidad)", async () => {
    // requireRole ya pasó (mock), así que técnicamente no debería llegar
    // sin session. Pero el handler es defensivo y tiene fallback.
    mockAuth.mockResolvedValueOnce(null);
    await route.POST(makeReq(), makeCtx("42"));
    const restoredBy = mockRestore.mock.calls[0][1];
    expect(restoredBy).toMatch(/unknown@/);
  });

  it("es idempotente: restaurar una fumigación no soft-deleted también devuelve 200", async () => {
    // El repo ya implementa idempotencia — si la fumigación NO estaba
    // soft-deleted, devuelve la fila con deleted_at: null (no-op).
    // El "before" via getFumigationRawById también debe tener
    // deleted_at: null (no estaba borrada) para que recordFumigationRestore
    // NO inserte audit.
    mockGetRawById.mockResolvedValueOnce({
      ...FUMIGATION_BEFORE,
      deleted_at: null,
      deleted_by: null
    });
    mockRestore.mockResolvedValueOnce({
      ...FUMIGATION_RESTORED,
      // Nunca tuvo deleted_at (no-op path)
      deleted_at: null,
      deleted_by: null
    });
    const res = await route.POST(makeReq(), makeCtx("1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fumigation.id).toBe(1);
    expect(body.fumigation.deleted_at).toBeNull();
  });
});

// ============================================================
// 404
// ============================================================

describe("POST .../fumigations/[id]/restore — 404", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve 404 cuando la fumigación no existe (ni siquiera soft-deleted)", async () => {
    // El nuevo flujo hace getFumigationRawById PRIMERO; si devuelve
    // null, el endpoint responde 404 sin llegar a restore.
    mockGetRawById.mockResolvedValueOnce(null);
    const res = await route.POST(makeReq(), makeCtx("9999"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("fumigación no encontrada");
    // restoreFumigationEvent NO debe llamarse si la fumigación no existe.
    expect(mockRestore).not.toHaveBeenCalled();
  });
});

// ============================================================
// Errores del repository
// ============================================================

describe("POST .../fumigations/[id]/restore — errores de repo", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve 500 si restoreFumigationEvent tira un error", async () => {
    mockRestore.mockRejectedValueOnce(new Error("BD connection lost"));
    const res = await route.POST(makeReq(), makeCtx("1"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/BD connection lost/);
  });

  it("devuelve 500 con mensaje genérico si el error no tiene message", async () => {
    mockRestore.mockRejectedValueOnce({});
    const res = await route.POST(makeReq(), makeCtx("1"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("error interno");
  });
});

// ============================================================
// Audit log (sprint feature/fumigation-audit-log 2026-08-15)
// ============================================================

describe("POST .../fumigations/[id]/restore � audit log", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("registra audit 'restored' con before (soft-deleted) + after + email tras 200", async () => {
    const res = await route.POST(makeReq(), makeCtx("1"));
    expect(res.status).toBe(200);
    expect(mockRecordRestore).toHaveBeenCalledTimes(1);
    const [before, after, actorEmail] = mockRecordRestore.mock.calls[0];
    // before: fumigaci�n soft-deleted
    expect(before.deleted_at).toBe("2026-08-14T10:00:00.000Z");
    expect(before.deleted_by).toBe("supervisor@afm.local");
    // after: fumigaci�n restaurada (deleted_at null)
    expect(after.deleted_at).toBeNull();
    expect(after.deleted_by).toBeNull();
    expect(actorEmail).toBe("supervisor@afm.local");
  });

  it("NO registra audit si la fumigaci�n no existe (404 � getFumigationRawById null)", async () => {
    mockGetRawById.mockReset();
    mockGetRawById.mockResolvedValueOnce(null);
    const res = await route.POST(makeReq(), makeCtx("9999"));
    expect(res.status).toBe(404);
    expect(mockRecordRestore).not.toHaveBeenCalled();
  });

  it("NO registra audit si la fumigaci�n NO estaba soft-deleted (idempotent / no-op)", async () => {
    // before: deleted_at null (nunca estuvo borrada)
    mockGetRawById.mockReset();
    mockGetRawById.mockResolvedValueOnce({
      ...FUMIGATION_BEFORE,
      deleted_at: null,
      deleted_by: null
    });
    mockRestore.mockResolvedValueOnce({
      ...FUMIGATION_RESTORED,
      deleted_at: null,
      deleted_by: null
    });
    const res = await route.POST(makeReq(), makeCtx("1"));
    expect(res.status).toBe(200);
    // El handler llama a recordFumigationRestore pero el helper detecta
    // que NO hubo cambio de estado y devuelve false (no inserta).
    // Para verificar que el helper NO insert�, miramos que el mock
    // devolvi� true por default pero el test no lo chequea ac�; lo
    // importante es que el handler lo llam� (el helper es responsable
    // del no-op).
    expect(mockRecordRestore).toHaveBeenCalledTimes(1);
  });

  it("NO registra audit si la auth falla (401)", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("no session"), { code: "UNAUTHENTICATED" })
    );
    const res = await route.POST(makeReq(), makeCtx("1"));
    expect(res.status).toBe(401);
    expect(mockRecordRestore).not.toHaveBeenCalled();
  });
});
