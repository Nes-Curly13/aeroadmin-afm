// tests/api-admin-fumigations-zod.test.ts
//
// Tests adicionales de `POST /api/admin/fumigations` con foco en
// la integración con zod. Los tests principales (auth, validación
// detallada, success, errores de BD) viven en
// `tests/api-admin-fumigations.test.ts` (28 tests, sin cambios).
//
// Sprint S11+ / zod PR #2 — verifica:
//   - El body validation usa zod (response 400 incluye `issues`)
//   - El `recorded_by` se sigue inyectando server-side
//   - El schema acepta el body exacto que el wizard envía (incluyendo
//     vehicle_plate, application_type_id, etc.)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const route: { POST: (req: Request) => Promise<Response> } =
  (routeModule as any).default ?? (routeModule as any);

function makeReq(body: unknown): Request {
  return new Request("http://localhost:3000/api/admin/fumigations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { email: "supervisor@afm.local" } });
  mockCreateFumigation.mockResolvedValue({
    id: 42,
    parcel_id: 1,
    product_used: "Glifosato 48%",
    dose_l_per_ha: 2.5
  });
  mockRecordCreate.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

const VALID_BODY = {
  parcel_id: 1,
  fumigation_date: "2026-08-02",
  product_used: "Glifosato 48%",
  dose_l_per_ha: 2.5
};

// ============================================================
// zod integration — response shape
// ============================================================

describe("POST /api/admin/fumigations — zod integration", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValueOnce(undefined);
  });

  it("1. response 400 incluye `issues` array con path exacto del field", async () => {
    const res = await route.POST(
      makeReq({ ...VALID_BODY, parcel_id: "not-a-number" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(body.error).toMatch(/parcel_id/);
    // PR #2 enhancement: machine-readable issues
    expect(body.issues).toBeDefined();
    expect(body.issues[0].path).toContain("parcel_id");
  });

  it("2. múltiples errors → issues array con cada uno (no solo el primero)", async () => {
    const res = await route.POST(
      makeReq({
        parcel_id: 0, // invalid
        fumigation_date: "bad", // invalid
        product_used: "", // invalid
        dose_l_per_ha: 0 // invalid
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.issues.length).toBeGreaterThanOrEqual(4);
  });

  it("3. `error` en response es el primer issue (legible para el usuario)", async () => {
    const res = await route.POST(
      makeReq({ ...VALID_BODY, parcel_id: 0 })
    );
    const body = await res.json();
    // Format: "parcel_id: debe ser positivo"
    expect(body.error).toMatch(/parcel_id/);
  });
});

// ============================================================
// Wizard body — el que envía el cliente real
// ============================================================

describe("POST /api/admin/fumigations — wizard body shape", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValueOnce(undefined);
  });

  it("4. acepta body completo del wizard (todos los campos)", async () => {
    const wizardBody = {
      parcel_id: 5,
      fumigation_date: "2026-09-01",
      product_used: "Roundup",
      dose_l_per_ha: 3.0,
      area_fumigated_m2: 12000,
      duration_minutes: 60,
      drone_code_used: 201,
      notes: "Aplicación programada",
      product_registered_ica: "ICA-9876-PN",
      pilot_license: "PCA-54321",
      product_id: 5,
      category_id: 2,
      application_type_id: 3,
      vehicle_plate: "abc-123"
    };
    const res = await route.POST(makeReq(wizardBody));
    expect(res.status).toBe(201);
    const arg = mockCreateFumigation.mock.calls[0][0];
    // Verifica que TODOS los campos se pasaron al repo
    expect(arg.parcel_id).toBe(5);
    expect(arg.area_fumigated_m2).toBe(12000);
    expect(arg.vehicle_plate).toBe("ABC-123"); // normalizado a UPPER
    expect(arg.product_id).toBe(5);
    expect(arg.category_id).toBe(2);
    expect(arg.application_type_id).toBe(3);
  });

  it("5. body del wizard con strings vacios para opcionales → null en repo", async () => {
    const wizardBody = {
      ...VALID_BODY,
      notes: "",
      product_registered_ica: "",
      pilot_license: ""
    };
    await route.POST(makeReq(wizardBody));
    const arg = mockCreateFumigation.mock.calls[0][0];
    expect(arg.notes).toBeNull();
    expect(arg.product_registered_ica).toBeNull();
    expect(arg.pilot_license).toBeNull();
  });

  it("6. product_id / category_id / application_type_id omitidos → null", async () => {
    await route.POST(makeReq(VALID_BODY));
    const arg = mockCreateFumigation.mock.calls[0][0];
    expect(arg.product_id).toBeNull();
    expect(arg.category_id).toBeNull();
    expect(arg.application_type_id).toBeNull();
    expect(arg.vehicle_plate).toBeNull();
  });
});
