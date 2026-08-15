// tests/api-admin-fumigations-patch.test.ts
//
// Test unitario del route handler `PATCH /api/admin/fumigations/[id]`
// (feature/fumigacion-detail-v2 / sub-3, testeado en sub-4).
//
// Cubre:
//   - 200 OK + fumigación actualizada (PATCH sparse)
//   - 400 si body incluye campo inmutable (parcel_id, source, ...)
//   - 400 si validación falla (product_used vacío, dose_l_per_ha negativo, etc.)
//   - 400 si category_id no es integer positivo
//   - 404 si fumigación no existe
//   - 401/403 según auth
//   - Mapeo de errores PG: 23514 → 400, 23503 → 400, 23502 → 400
//   - Body sparse: si solo se manda product_used, no se sobreescriben los otros
//
// Mocks: requireRole, updateFumigationEvent.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdate = vi.fn();
const mockGetById = vi.fn();
vi.mock("@/api/repositories", () => ({
  updateFumigationEvent: (...args: unknown[]) => mockUpdate(...args),
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
  "../app/api/admin/fumigations/[id]/route.js" as string
);
const route: { PATCH: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> } =
  (routeModule as unknown as { PATCH: typeof route.PATCH });

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeReq(body: unknown): Request {
  return new Request("http://localhost:3000/api/admin/fumigations/1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function makeInvalidJsonReq(): Request {
  return new Request("http://localhost:3000/api/admin/fumigations/1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: "{ not valid json"
  });
}

const SESSION_USER = { user: { email: "supervisor@afm.local" } };

/**
 * Estado "antes" del PATCH. Usado por el handler para computar la
 * diff de audit log. Diferencias con FUMIGATION_UPDATED:
 *   - product_used: "Roundup" (antes) vs "Glifosato 48%" (después)
 *   - dose_l_per_ha: 2.0 (antes) vs 2.5 (después)
 *   - notes: "old" (antes) vs null (después)
 * Sprint 2026-08-15 — feature/fumigation-audit-log / sub-2.
 */
const FUMIGATION_BEFORE = {
  id: 1,
  parcel_id: 42,
  fumigation_date: "2026-08-13",
  product_used: "Roundup",
  dose_l_per_ha: 2.0,
  area_fumigated_m2: 12_345,
  drone_code_used: 201,
  duration_minutes: 45,
  notes: "old",
  human_notes: null,
  recorded_by: "supervisor@afm.local",
  product_registered_ica: "ICA-1234-PN",
  pilot_license: "PCA-12345",
  recorded_at: "2026-08-13T15:00:00.000Z",
  source: "manual" as const,
  category_id: 1
};

const FUMIGATION_UPDATED = {
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
  product_registered_ica: "ICA-1234-PN",
  pilot_license: "PCA-12345",
  recorded_at: "2026-08-13T15:00:00.000Z",
  source: "manual" as const,
  category_id: 1
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(SESSION_USER);
  mockRequireRole.mockResolvedValue(undefined);
  mockUpdate.mockResolvedValue(FUMIGATION_UPDATED);
  // Audit log mock: por default el "before" existe (devolvemos
  // FUMIGATION_BEFORE) y recordFumigationEdit resuelve con true
  // (indica que sí insertó audit). Tests específicos pueden
  // sobreescribir con mockResolvedValue(null) si quieren testear
  // el caso "fumigación no existe" → 404.
  mockGetById.mockResolvedValue(FUMIGATION_BEFORE);
  mockRecordEdit.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Auth
// ============================================================

describe("PATCH /api/admin/fumigations/[id] — auth", () => {
  it("devuelve 401 si no hay sesión", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("no session"), { code: "UNAUTHENTICATED" })
    );
    const res = await route.PATCH(
      makeReq({ product_used: "Otro producto" }),
      makeCtx("1")
    );
    expect(res.status).toBe(401);
  });

  it("devuelve 403 cuando el rol no es admin ni supervisor", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("not allowed"), { code: "FORBIDDEN" })
    );
    const res = await route.PATCH(
      makeReq({ product_used: "Otro producto" }),
      makeCtx("1")
    );
    expect(res.status).toBe(403);
  });

  it("requireRole es llamado con ['admin', 'supervisor']", async () => {
    await route.PATCH(
      makeReq({ product_used: "Otro producto" }),
      makeCtx("1")
    );
    expect(mockRequireRole).toHaveBeenCalledWith(["admin", "supervisor"]);
  });

  it("error genérico de auth cae a 500", async () => {
    mockRequireRole.mockRejectedValueOnce(new Error("auth crashed"));
    const res = await route.PATCH(
      makeReq({ product_used: "Otro producto" }),
      makeCtx("1")
    );
    expect(res.status).toBe(500);
  });
});

// ============================================================
// Path param
// ============================================================

describe("PATCH .../fumigations/[id] — path param", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve 400 si el id no es numérico", async () => {
    const res = await route.PATCH(
      makeReq({ product_used: "X" }),
      makeCtx("abc")
    );
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("devuelve 400 si el id es <= 0", async () => {
    const res = await route.PATCH(
      makeReq({ product_used: "X" }),
      makeCtx("0")
    );
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ============================================================
// Body parsing
// ============================================================

describe("PATCH .../fumigations/[id] — body parsing", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve 400 si el body no es JSON válido", async () => {
    const res = await route.PATCH(makeInvalidJsonReq(), makeCtx("1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/JSON/i);
  });

  it("devuelve 400 si el body no es un objeto", async () => {
    const req = new Request("http://localhost:3000/api/admin/fumigations/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify("not an object")
    });
    const res = await route.PATCH(req, makeCtx("1"));
    expect(res.status).toBe(400);
  });

  it("devuelve 400 si el body es null", async () => {
    const req = new Request("http://localhost:3000/api/admin/fumigations/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(null)
    });
    const res = await route.PATCH(req, makeCtx("1"));
    expect(res.status).toBe(400);
  });
});

// ============================================================
// Campos inmutables (lista negra explícita)
// ============================================================

describe("PATCH .../fumigations/[id] — campos inmutables", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it.each([
    "parcel_id",
    "source",
    "recorded_by",
    "flight_ids",
    "recorded_at",
    "deleted_at",
    "deleted_by"
  ])("rechaza con 400 el campo inmutable '%s'", async (field) => {
    const res = await route.PATCH(
      makeReq({ [field]: "cualquier valor" }),
      makeCtx("1")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/campo inmutable/);
    expect(body.error).toContain(field);
    // No debe llegar al repo.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("inmutable parcel_id: aunque venga con un valor válido, devuelve 400", async () => {
    const res = await route.PATCH(
      makeReq({ parcel_id: 99, product_used: "Glifosato" }),
      makeCtx("1")
    );
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ============================================================
// Validación de campos (tipos y rangos)
// ============================================================

describe("PATCH .../fumigations/[id] — validación", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve 400 si fumigation_date no es YYYY-MM-DD", async () => {
    const res = await route.PATCH(
      makeReq({ fumigation_date: "08/13/2026" }),
      makeCtx("1")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/fumigation_date/);
  });

  it("devuelve 400 si product_used está vacío (solo espacios)", async () => {
    const res = await route.PATCH(
      makeReq({ product_used: "   " }),
      makeCtx("1")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/product_used/);
  });

  it("devuelve 400 si product_used excede 200 chars", async () => {
    const res = await route.PATCH(
      makeReq({ product_used: "x".repeat(201) }),
      makeCtx("1")
    );
    expect(res.status).toBe(400);
  });

  it("devuelve 400 si dose_l_per_ha es negativo", async () => {
    const res = await route.PATCH(
      makeReq({ dose_l_per_ha: -1 }),
      makeCtx("1")
    );
    expect(res.status).toBe(400);
  });

  it("devuelve 400 si dose_l_per_ha es > 1000", async () => {
    const res = await route.PATCH(
      makeReq({ dose_l_per_ha: 2000 }),
      makeCtx("1")
    );
    expect(res.status).toBe(400);
  });

  it("devuelve 400 si dose_l_per_ha es string", async () => {
    const res = await route.PATCH(
      makeReq({ dose_l_per_ha: "2.5" }),
      makeCtx("1")
    );
    expect(res.status).toBe(400);
  });

  it("devuelve 400 si area_fumigated_m2 es negativo", async () => {
    const res = await route.PATCH(
      makeReq({ area_fumigated_m2: -100 }),
      makeCtx("1")
    );
    expect(res.status).toBe(400);
  });

  it("devuelve 400 si duration_minutes es negativo", async () => {
    const res = await route.PATCH(
      makeReq({ duration_minutes: -1 }),
      makeCtx("1")
    );
    expect(res.status).toBe(400);
  });

  it("devuelve 400 si drone_code_used no es entero positivo", async () => {
    expect(
      (await route.PATCH(makeReq({ drone_code_used: 0 }), makeCtx("1"))).status
    ).toBe(400);
    expect(
      (await route.PATCH(makeReq({ drone_code_used: 1.5 }), makeCtx("1"))).status
    ).toBe(400);
    expect(
      (await route.PATCH(makeReq({ drone_code_used: -1 }), makeCtx("1"))).status
    ).toBe(400);
  });

  it("devuelve 400 si notes no es string", async () => {
    const res = await route.PATCH(
      makeReq({ notes: 12345 }),
      makeCtx("1")
    );
    expect(res.status).toBe(400);
  });

  it("devuelve 400 si notes excede 2000 chars", async () => {
    const res = await route.PATCH(
      makeReq({ notes: "x".repeat(2001) }),
      makeCtx("1")
    );
    expect(res.status).toBe(400);
  });

  it("devuelve 400 si product_registered_ica excede 50 chars", async () => {
    const res = await route.PATCH(
      makeReq({ product_registered_ica: "x".repeat(51) }),
      makeCtx("1")
    );
    expect(res.status).toBe(400);
  });

  it("devuelve 400 si pilot_license excede 20 chars", async () => {
    const res = await route.PATCH(
      makeReq({ pilot_license: "x".repeat(21) }),
      makeCtx("1")
    );
    expect(res.status).toBe(400);
  });

  it("devuelve 400 si category_id no es entero positivo", async () => {
    expect(
      (await route.PATCH(makeReq({ category_id: 0 }), makeCtx("1"))).status
    ).toBe(400);
    expect(
      (await route.PATCH(makeReq({ category_id: 1.5 }), makeCtx("1"))).status
    ).toBe(400);
    expect(
      (await route.PATCH(makeReq({ category_id: -1 }), makeCtx("1"))).status
    ).toBe(400);
    expect(
      (await route.PATCH(makeReq({ category_id: "1" }), makeCtx("1"))).status
    ).toBe(400);
  });
});

// ============================================================
// Body sparse: solo se actualizan los campos provistos
// ============================================================

describe("PATCH .../fumigations/[id] — body sparse", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("si solo se manda product_used, el repo recibe solo ese campo", async () => {
    await route.PATCH(makeReq({ product_used: "Solo producto" }), makeCtx("1"));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [id, patch] = mockUpdate.mock.calls[0];
    expect(id).toBe(1);
    expect(patch).toEqual({ product_used: "Solo producto" });
  });

  it("si solo se manda category_id, el repo recibe solo ese campo", async () => {
    await route.PATCH(makeReq({ category_id: 3 }), makeCtx("1"));
    const [, patch] = mockUpdate.mock.calls[0];
    expect(patch).toEqual({ category_id: 3 });
  });

  it("product_used se trimea (espacios al inicio/fin)", async () => {
    await route.PATCH(
      makeReq({ product_used: "  Glifosato 48%  " }),
      makeCtx("1")
    );
    const [, patch] = mockUpdate.mock.calls[0];
    expect(patch.product_used).toBe("Glifosato 48%");
  });

  it("product_used: '' se normaliza a null (clear del campo)", async () => {
    await route.PATCH(makeReq({ product_used: "" }), makeCtx("1"));
    // Espera — el validador rechaza '' ANTES de llegar al repo
    // (porque product_used.trim().length === 0). Confirmamos ese comportamiento.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("product_used: null se pasa tal cual (clear intencional)", async () => {
    await route.PATCH(makeReq({ product_used: null }), makeCtx("1"));
    const [, patch] = mockUpdate.mock.calls[0];
    expect(patch.product_used).toBeNull();
  });

  it("notes: '' se normaliza a null (string vacío → null)", async () => {
    await route.PATCH(makeReq({ notes: "" }), makeCtx("1"));
    const [, patch] = mockUpdate.mock.calls[0];
    expect(patch.notes).toBeNull();
  });

  it("notes: '   ' se normaliza a null (espacios → null)", async () => {
    await route.PATCH(makeReq({ notes: "   " }), makeCtx("1"));
    const [, patch] = mockUpdate.mock.calls[0];
    expect(patch.notes).toBeNull();
  });

  it("category_id: null se pasa tal cual (clear intencional)", async () => {
    await route.PATCH(makeReq({ category_id: null }), makeCtx("1"));
    const [, patch] = mockUpdate.mock.calls[0];
    expect(patch.category_id).toBeNull();
  });

  it("body con múltiples campos: el patch los incluye todos", async () => {
    await route.PATCH(
      makeReq({
        product_used: "Producto A",
        dose_l_per_ha: 3.0,
        category_id: 2,
        notes: "Re-tratamiento por lluvia"
      }),
      makeCtx("1")
    );
    const [, patch] = mockUpdate.mock.calls[0];
    expect(patch).toEqual({
      product_used: "Producto A",
      dose_l_per_ha: 3.0,
      category_id: 2,
      notes: "Re-tratamiento por lluvia"
    });
  });
});

// ============================================================
// Éxito y 404
// ============================================================

describe("PATCH .../fumigations/[id] — éxito y 404", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve 200 con la fumigación actualizada", async () => {
    const res = await route.PATCH(
      makeReq({ product_used: "Glifosato 48%" }),
      makeCtx("1")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fumigation.id).toBe(1);
    expect(body.fumigation.product_used).toBe("Glifosato 48%");
  });

  it("devuelve 404 si la fumigación no existe (repo devuelve null)", async () => {
    mockUpdate.mockResolvedValueOnce(null);
    const res = await route.PATCH(
      makeReq({ product_used: "X" }),
      makeCtx("9999")
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("fumigación no encontrada");
  });
});

// ============================================================
// Mapeo de errores PG
// ============================================================

describe("PATCH .../fumigations/[id] — errores PG", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("CHECK violation (23514) → 400", async () => {
    mockUpdate.mockRejectedValueOnce(
      Object.assign(new Error("violates check constraint"), { code: "23514" })
    );
    const res = await route.PATCH(
      makeReq({ product_used: "X" }),
      makeCtx("1")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/CHECK violation/);
  });

  it("FK violation (23503) → 400 (category_id no existe)", async () => {
    mockUpdate.mockRejectedValueOnce(
      Object.assign(new Error("violates foreign key"), { code: "23503" })
    );
    const res = await route.PATCH(
      makeReq({ category_id: 999 }),
      makeCtx("1")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/FK violation/);
  });

  it("NOT NULL violation (23502) → 400", async () => {
    mockUpdate.mockRejectedValueOnce(
      Object.assign(new Error("null value in column"), { code: "23502" })
    );
    const res = await route.PATCH(
      makeReq({ product_used: "X" }),
      makeCtx("1")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/NOT NULL violation/);
  });

  it("error desconocido → 500", async () => {
    mockUpdate.mockRejectedValueOnce(
      Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" })
    );
    const res = await route.PATCH(
      makeReq({ product_used: "X" }),
      makeCtx("1")
    );
    expect(res.status).toBe(500);
  });
});

// ============================================================
// Audit log (sprint feature/fumigation-audit-log 2026-08-15)
// ============================================================

describe("PATCH .../fumigations/[id] � audit log", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("registra audit 'edited' con before + after + email del session user tras 200", async () => {
    const res = await route.PATCH(
      makeReq({ product_used: "Glifosato 48%", dose_l_per_ha: 2.5 }),
      makeCtx("1")
    );
    expect(res.status).toBe(200);
    expect(mockRecordEdit).toHaveBeenCalledTimes(1);
    const [before, after, actorEmail] = mockRecordEdit.mock.calls[0];
    expect(before).toEqual(FUMIGATION_BEFORE);
    expect(after).toEqual(FUMIGATION_UPDATED);
    expect(actorEmail).toBe("supervisor@afm.local");
  });

  it("NO registra audit si la fumigaci�n no existe (404 � getFumigationById null)", async () => {
    mockGetById.mockResolvedValueOnce(null);
    const res = await route.PATCH(
      makeReq({ product_used: "Otro" }),
      makeCtx("9999")
    );
    expect(res.status).toBe(404);
    expect(mockRecordEdit).not.toHaveBeenCalled();
  });

  it("NO registra audit si la fumigaci�n se soft-deleted entre fetch y update (404 � update null)", async () => {
    mockUpdate.mockResolvedValueOnce(null);
    const res = await route.PATCH(
      makeReq({ product_used: "Otro" }),
      makeCtx("1")
    );
    expect(res.status).toBe(404);
    expect(mockRecordEdit).not.toHaveBeenCalled();
  });

  it("NO registra audit si la auth falla (401)", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("no session"), { code: "UNAUTHENTICATED" })
    );
    const res = await route.PATCH(
      makeReq({ product_used: "Otro" }),
      makeCtx("1")
    );
    expect(res.status).toBe(401);
    expect(mockRecordEdit).not.toHaveBeenCalled();
  });

  it("NO registra audit si el body es inv�lido (campo inmutable)", async () => {
    const res = await route.PATCH(makeReq({ parcel_id: 999 }), makeCtx("1"));
    expect(res.status).toBe(400);
    expect(mockRecordEdit).not.toHaveBeenCalled();
  });
});
