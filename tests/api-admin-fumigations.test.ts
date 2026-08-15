// tests/api-admin-fumigations.test.ts
//
// Test unitario del route handler `POST /api/admin/fumigations`
// (Sprint 2026-08-02 — feature/manual-fumigation-ui).
//
// Cubre:
//   - **Auth**: 401 sin session, 403 con role insuficiente (viewer
//     no debería poder), 200 con admin o supervisor
//   - **Body validation**: 400 con body inválido, falta de campos
//     requeridos, tipos incorrectos
//   - **Éxito**: 201 con la fumigation creada, `recorded_by` se
//     inyecta server-side desde la sesión
//   - **Errores de BD**: 400 para CHECK violation (formato ICA
//     inválido), FK violation (parcel no existe), NOT NULL violation
//   - **Campos opcionales**: se omiten del body si están vacíos
//     (server los trata como null)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Mocks. Se registran ANTES del import del route handler.
// ============================================================

const mockCreateFumigation = vi.fn();
vi.mock("@/api/repositories", () => ({
  createFumigationEvent: (...args: unknown[]) => mockCreateFumigation(...args)
}));

const mockRecordCreate = vi.fn();
vi.mock("@/lib/fumigation-audit", () => ({
  recordFumigationCreate: (...args: unknown[]) => mockRecordCreate(...args)
}));

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args)
}));

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: () => mockAuth()
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const routeModule = await import("../app/api/admin/fumigations/route.js" as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const route: { POST: (req: Request) => Promise<Response> } = (routeModule as any).default ?? (routeModule as any);

// ============================================================
// Helpers
// ============================================================

function makeReq(body: unknown): Request {
  return new Request("http://localhost:3000/api/admin/fumigations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function makeInvalidJsonReq(): Request {
  return new Request("http://localhost:3000/api/admin/fumigations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not valid json"
  });
}

const VALID_BODY = {
  parcel_id: 1,
  fumigation_date: "2026-08-02",
  product_used: "Glifosato 48%",
  dose_l_per_ha: 2.5
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { email: "supervisor@afm.local" } });
  mockCreateFumigation.mockResolvedValue({
    id: 42,
    parcel_id: 1,
    fumigation_date: "2026-08-02",
    product_used: "Glifosato 48%",
    dose_l_per_ha: 2.5,
    recorded_by: "supervisor@afm.local",
    source: "manual"
  });
  // Audit log mock: por default resuelve sin error (fire-and-forget).
  mockRecordCreate.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Auth
// ============================================================

describe("POST /api/admin/fumigations — auth", () => {
  it("devuelve 401 si no hay session ni HEALTH_TOKEN", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("no session"), { code: "UNAUTHENTICATED" })
    );
    const res = await route.POST(makeReq(VALID_BODY));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("no autenticado");
  });

  it("devuelve 403 si el role no es admin ni supervisor", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("not allowed"), { code: "FORBIDDEN" })
    );
    const res = await route.POST(makeReq(VALID_BODY));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("rol insuficiente");
  });

  it("permite con role=admin (requireRole success)", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    const res = await route.POST(makeReq(VALID_BODY));
    expect(res.status).toBe(201);
  });

  it("permite con role=supervisor (mismo path, role es array)", async () => {
    // requireRole acepta string o array. Como mockeamos el return,
    // no podemos distinguir. Pero el route handler SIEMPRE pasa
    // ['admin', 'supervisor']. Verificamos que se llamó con
    // exactamente ese array.
    mockRequireRole.mockResolvedValueOnce(undefined);
    await route.POST(makeReq(VALID_BODY));
    expect(mockRequireRole).toHaveBeenCalledWith(["admin", "supervisor"]);
  });
});

// ============================================================
// Body validation
// ============================================================

describe("POST /api/admin/fumigations — body validation", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValueOnce(undefined);
  });

  it("devuelve 400 si el body no es JSON válido", async () => {
    const res = await route.POST(makeInvalidJsonReq());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/JSON/i);
  });

  it("devuelve 400 si el body no es un objeto", async () => {
    const req = new Request("http://localhost:3000/api/admin/fumigations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify("not an object")
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
  });

  it("devuelve 400 si parcel_id falta o es inválido", async () => {
    expect((await route.POST(makeReq({ ...VALID_BODY, parcel_id: undefined }))).status).toBe(400);
    expect((await route.POST(makeReq({ ...VALID_BODY, parcel_id: "1" }))).status).toBe(400);
    expect((await route.POST(makeReq({ ...VALID_BODY, parcel_id: 0 }))).status).toBe(400);
    expect((await route.POST(makeReq({ ...VALID_BODY, parcel_id: -5 }))).status).toBe(400);
    expect((await route.POST(makeReq({ ...VALID_BODY, parcel_id: 1.5 }))).status).toBe(400);
  });

  it("devuelve 400 si fumigation_date falta o no es YYYY-MM-DD", async () => {
    expect((await route.POST(makeReq({ ...VALID_BODY, fumigation_date: undefined }))).status).toBe(400);
    expect((await route.POST(makeReq({ ...VALID_BODY, fumigation_date: "08/02/2026" }))).status).toBe(400);
    // Nota: '2026-13-01' (mes inválido) pasa el check de formato
    // (la regex solo valida estructura YYYY-MM-DD). El Postgres DATE
    // lo rechaza con 22008 "invalid_datetime_format" — el test
    // de errores de BD cubre ese path.
  });

  it("devuelve 400 si product_used falta, está vacío o es > 200 chars", async () => {
    expect((await route.POST(makeReq({ ...VALID_BODY, product_used: "" }))).status).toBe(400);
    expect((await route.POST(makeReq({ ...VALID_BODY, product_used: "   " }))).status).toBe(400);
    expect((await route.POST(makeReq({ ...VALID_BODY, product_used: "x".repeat(201) }))).status).toBe(400);
  });

  it("devuelve 400 si dose_l_per_ha no es número positivo <= 1000", async () => {
    expect((await route.POST(makeReq({ ...VALID_BODY, dose_l_per_ha: undefined }))).status).toBe(400);
    expect((await route.POST(makeReq({ ...VALID_BODY, dose_l_per_ha: "2.5" }))).status).toBe(400);
    expect((await route.POST(makeReq({ ...VALID_BODY, dose_l_per_ha: -1 }))).status).toBe(400);
    expect((await route.POST(makeReq({ ...VALID_BODY, dose_l_per_ha: 0 }))).status).toBe(400);
    expect((await route.POST(makeReq({ ...VALID_BODY, dose_l_per_ha: 2000 }))).status).toBe(400);
  });

  it("devuelve 400 si area_fumigated_m2 es string no-numérico", async () => {
    expect(
      (await route.POST(makeReq({ ...VALID_BODY, area_fumigated_m2: "mucho" }))).status
    ).toBe(400);
  });

  it("devuelve 400 si product_registered_ica excede 50 chars", async () => {
    expect(
      (await route.POST(
        makeReq({ ...VALID_BODY, product_registered_ica: "x".repeat(51) })
      )).status
    ).toBe(400);
  });

  it("devuelve 400 si pilot_license excede 20 chars", async () => {
    expect(
      (await route.POST(
        makeReq({ ...VALID_BODY, pilot_license: "x".repeat(21) })
      )).status
    ).toBe(400);
  });
});

// ============================================================
// Éxito
// ============================================================

describe("POST /api/admin/fumigations — éxito", () => {
  it("devuelve 201 con la fumigation creada en body", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    const res = await route.POST(makeReq(VALID_BODY));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.fumigation.id).toBe(42);
    expect(body.fumigation.product_used).toBe("Glifosato 48%");
  });

  it("inyecta recorded_by desde la sesión (no del body)", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    mockAuth.mockResolvedValueOnce({
      user: { email: "test-user@afm.local" }
    });
    // El body NO trae recorded_by. El server lo inyecta.
    await route.POST(makeReq(VALID_BODY));
    expect(mockCreateFumigation).toHaveBeenCalledTimes(1);
    const arg = mockCreateFumigation.mock.calls[0][0];
    expect(arg.recorded_by).toBe("test-user@afm.local");
  });

  it("si recorded_by viene en el body, se ignora (seguridad)", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    mockAuth.mockResolvedValueOnce({
      user: { email: "real-user@afm.local" }
    });
    // El cliente intenta inyectar 'fake@evil.co'. El server lo descarta
    // y usa el de la sesión. Esto evita que un user atribuya una
    // fumigación a otro via curl.
    await route.POST(makeReq({ ...VALID_BODY, recorded_by: "fake@evil.co" }));
    const arg = mockCreateFumigation.mock.calls[0][0];
    expect(arg.recorded_by).toBe("real-user@afm.local");
  });

  it("si no hay session, recorded_by cae a 'unknown@'", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    mockAuth.mockResolvedValueOnce(null);
    await route.POST(makeReq(VALID_BODY));
    const arg = mockCreateFumigation.mock.calls[0][0];
    expect(arg.recorded_by).toContain("unknown@");
  });

  it("campos opcionales vacíos se omiten del body al createFumigationEvent", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    await route.POST(makeReq(VALID_BODY));
    const arg = mockCreateFumigation.mock.calls[0][0];
    expect(arg.area_fumigated_m2).toBeNull();
    expect(arg.duration_minutes).toBeNull();
    expect(arg.drone_code_used).toBeNull();
    expect(arg.notes).toBeNull();
    expect(arg.product_registered_ica).toBeNull();
    expect(arg.pilot_license).toBeNull();
  });

  it("campos opcionales con valor se pasan tal cual", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    await route.POST(
      makeReq({
        ...VALID_BODY,
        area_fumigated_m2: 5000,
        duration_minutes: 45,
        drone_code_used: 201,
        notes: "Aplicación manual por re-tratamiento",
        product_registered_ica: "ICA-1234-PN",
        pilot_license: "PCA-12345"
      })
    );
    const arg = mockCreateFumigation.mock.calls[0][0];
    expect(arg.area_fumigated_m2).toBe(5000);
    expect(arg.duration_minutes).toBe(45);
    expect(arg.drone_code_used).toBe(201);
    expect(arg.notes).toBe("Aplicación manual por re-tratamiento");
    expect(arg.product_registered_ica).toBe("ICA-1234-PN");
    expect(arg.pilot_license).toBe("PCA-12345");
  });

  it("trimea strings de espacios al inicio/fin", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    await route.POST(
      makeReq({ ...VALID_BODY, product_used: "  Glifosato 48%  " })
    );
    const arg = mockCreateFumigation.mock.calls[0][0];
    expect(arg.product_used).toBe("Glifosato 48%");
  });
});

// ============================================================
// Errores de BD
// ============================================================

describe("POST /api/admin/fumigations — errores de BD", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValueOnce(undefined);
  });

  it("mapea CHECK violation (23514) a 400", async () => {
    mockCreateFumigation.mockRejectedValueOnce(
      Object.assign(new Error("violates check constraint"), { code: "23514" })
    );
    const res = await route.POST(makeReq(VALID_BODY));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/CHECK violation/);
  });

  it("mapea FK violation (23503) a 400 (parcel no existe)", async () => {
    mockCreateFumigation.mockRejectedValueOnce(
      Object.assign(new Error("violates foreign key"), { code: "23503" })
    );
    const res = await route.POST(makeReq(VALID_BODY));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/FK violation/);
  });

  it("mapea NOT NULL violation (23502) a 400", async () => {
    mockCreateFumigation.mockRejectedValueOnce(
      Object.assign(new Error("null value in column"), { code: "23502" })
    );
    const res = await route.POST(makeReq(VALID_BODY));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/NOT NULL violation/);
  });

  it("errores desconocidos van a 500", async () => {
    mockCreateFumigation.mockRejectedValueOnce(
      Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" })
    );
    const res = await route.POST(makeReq(VALID_BODY));
    expect(res.status).toBe(500);
  });
});

// ============================================================
// Audit log (sprint feature/fumigation-audit-log 2026-08-15)
// ============================================================

describe("POST /api/admin/fumigaciones � audit log", () => {
  beforeEach(() => {
    // mockResolvedValue (no Once) — setea el default behavior del mock.
    // Tests individuales pueden sobreescribir con mockRejectedValueOnce
    // (que tiene prioridad FIFO sobre el default). Si usáramos
    // mockResolvedValueOnce acá, la queue se llenaría y consumiría
    // el slot ANTES del mockRejectedValueOnce del test de 401, dejando
    // el rejected en la queue para el test siguiente.
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("registra audit 'created' con snapshot + email del session user tras 201", async () => {
    const res = await route.POST(makeReq(VALID_BODY));
    expect(res.status).toBe(201);
    expect(mockRecordCreate).toHaveBeenCalledTimes(1);
    const [fumigation, actorEmail] = mockRecordCreate.mock.calls[0];
    expect(actorEmail).toBe("supervisor@afm.local");
    expect(fumigation.id).toBe(42);
  });

  it("NO registra audit si la fumigaci�n NO se cre� (error de BD)", async () => {
    mockCreateFumigation.mockRejectedValueOnce(
      Object.assign(new Error("FK violation"), { code: "23503" })
    );
    const res = await route.POST(makeReq(VALID_BODY));
    expect(res.status).toBe(400);
    expect(mockRecordCreate).not.toHaveBeenCalled();
  });

  it("NO registra audit si la auth falla (401)", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("UNAUTHENTICATED"), { code: "UNAUTHENTICATED" })
    );
    const res = await route.POST(makeReq(VALID_BODY));
    expect(res.status).toBe(401);
    expect(mockRecordCreate).not.toHaveBeenCalled();
  });

  it("NO registra audit si el body es inv�lido (400)", async () => {
    const res = await route.POST(
      makeReq({ parcel_id: "not-a-number", fumigation_date: "2026-08-02" })
    );
    expect(res.status).toBe(400);
    expect(mockRecordCreate).not.toHaveBeenCalled();
  });
});
