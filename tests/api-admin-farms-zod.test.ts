// tests/api-admin-farms-zod.test.ts
//
// Tests del route handler `POST /api/admin/farms` con zod validation.
// Sprint S11+ / zod PR #2.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateFarm = vi.fn();
const mockSearchFarms = vi.fn();
vi.mock("@/api/repositories", () => ({
  createFarm: (...args: unknown[]) => mockCreateFarm(...args),
  searchFarms: (...args: unknown[]) => mockSearchFarms(...args)
}));

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args)
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const routeModule = await import("../app/api/admin/farms/route.js" as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const route: { POST: (req: Request) => Promise<Response> } =
  (routeModule as any).default ?? (routeModule as any);

function makeReq(body: unknown): Request {
  return new Request("http://localhost:3000/api/admin/farms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

const VALID_BODY = {
  client_id: 1,
  name: "Finca La Esperanza",
  created_by_email: "admin@aeroadmin.local"
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateFarm.mockResolvedValue({
    id: 1,
    client_id: 1,
    name: "Finca La Esperanza",
    municipality: null,
    department: null,
    created_by_email: "admin@aeroadmin.local"
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Auth
// ============================================================

describe("POST /api/admin/farms — auth", () => {
  it("1. devuelve 401 sin session", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("no session"), { code: "UNAUTHENTICATED" })
    );
    const res = await route.POST(makeReq(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it("2. devuelve 403 con role insuficiente", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), { code: "FORBIDDEN" })
    );
    const res = await route.POST(makeReq(VALID_BODY));
    expect(res.status).toBe(403);
  });
});

// ============================================================
// Body validation
// ============================================================

describe("POST /api/admin/farms — body validation via zod", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValueOnce(undefined);
  });

  it("3. devuelve 400 si client_id no es positive integer", async () => {
    expect((await route.POST(makeReq({ ...VALID_BODY, client_id: 0 }))).status).toBe(400);
    expect((await route.POST(makeReq({ ...VALID_BODY, client_id: -1 }))).status).toBe(400);
    expect((await route.POST(makeReq({ ...VALID_BODY, client_id: 1.5 }))).status).toBe(400);
    expect((await route.POST(makeReq({ ...VALID_BODY, client_id: "1" }))).status).toBe(400);
  });

  it("4. devuelve 400 si name falta, vacio, o whitespace", async () => {
    expect((await route.POST(makeReq({ ...VALID_BODY, name: "" }))).status).toBe(400);
    expect((await route.POST(makeReq({ ...VALID_BODY, name: "   " }))).status).toBe(400);
    expect((await route.POST(makeReq({ ...VALID_BODY, name: 123 }))).status).toBe(400);
  });

  it("5. devuelve 400 si created_by_email falta", async () => {
    expect((await route.POST(makeReq({ ...VALID_BODY, created_by_email: "" }))).status).toBe(400);
  });

  it("6. devuelve 400 si municipality no es string (zod path)", async () => {
    const res = await route.POST(
      makeReq({ ...VALID_BODY, municipality: 123 })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/municipality/);
  });

  it("7. response 400 incluye issues array con path", async () => {
    const res = await route.POST(makeReq({ client_id: 1, name: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.issues).toBeDefined();
    expect(body.issues.length).toBeGreaterThan(0);
    expect(body.issues[0].path).toContain("name");
  });

  it("8. acepta name con espacios, los trimea antes de enviar al repo", async () => {
    await route.POST(
      makeReq({ ...VALID_BODY, name: "  Finca  " })
    );
    const arg = mockCreateFarm.mock.calls[0][0];
    expect(arg.name).toBe("Finca");
  });
});

// ============================================================
// Éxito
// ============================================================

describe("POST /api/admin/farms — éxito", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValueOnce(undefined);
  });

  it("9. devuelve 201 con la farm creada", async () => {
    const res = await route.POST(makeReq(VALID_BODY));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.farm.id).toBe(1);
  });

  it("10. municipality/department null cuando se omiten", async () => {
    await route.POST(makeReq(VALID_BODY));
    const arg = mockCreateFarm.mock.calls[0][0];
    expect(arg.municipality).toBeNull();
    expect(arg.department).toBeNull();
  });

  it("11. municipality/department con valor se pasan al repo", async () => {
    await route.POST(
      makeReq({ ...VALID_BODY, municipality: "Candelaria", department: "Valle" })
    );
    const arg = mockCreateFarm.mock.calls[0][0];
    expect(arg.municipality).toBe("Candelaria");
    expect(arg.department).toBe("Valle");
  });
});

// ============================================================
// Errores
// ============================================================

describe("POST /api/admin/farms — errores", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValueOnce(undefined);
  });

  it("12. (client_id, name) duplicado → 409", async () => {
    mockCreateFarm.mockRejectedValueOnce(
      Object.assign(new Error("unique violation"), { code: "23505" })
    );
    const res = await route.POST(makeReq(VALID_BODY));
    expect(res.status).toBe(409);
  });
});
