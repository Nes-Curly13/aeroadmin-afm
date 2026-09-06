// tests/api-admin-clients-zod.test.ts
//
// Tests del route handler `POST /api/admin/clients` con zod validation.
// Sprint S11+ / zod PR #2.
//
// Cubre:
//   - Auth: 401 sin session, 403 con role insuficiente
//   - Body validation via createClientBodySchema: 400 con body inválido
//   - Éxito: 201 con la client creada
//   - Errores: 409 en name duplicado, 500 en error inesperado
//
// Por que este test es valioso:
//   - Antes del zod refactor, el body validation eran 18 lineas de
//     if-checks. Un test por branch (whitespace-only, null notes,
//     notes > max length, etc) se sentia redundante.
//   - Despues: un zod schema cubre todos los branches. Este test
//     valida el END-TO-END (auth + parse + repo call) sin re-implementar
//     la logica de validacion.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Mocks. Se registran ANTES del import del route handler.
// ============================================================

const mockCreateClient = vi.fn();
const mockSearchClients = vi.fn();
vi.mock("@/api/repositories", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
  searchClients: (...args: unknown[]) => mockSearchClients(...args)
}));

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args)
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const routeModule = await import("../app/api/admin/clients/route.js" as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const route: { POST: (req: Request) => Promise<Response> } =
  (routeModule as any).default ?? (routeModule as any);

// ============================================================
// Helpers
// ============================================================

function makeReq(body: unknown): Request {
  return new Request("http://localhost:3000/api/admin/clients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateClient.mockResolvedValue({
    id: 1,
    name: "Ingenio La Cabaña",
    notes: null,
    created_by_email: "admin@aeroadmin.local"
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Auth
// ============================================================

describe("POST /api/admin/clients — auth", () => {
  it("1. devuelve 401 si no hay session", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("no session"), { code: "UNAUTHENTICATED" })
    );
    const res = await route.POST(
      makeReq({ name: "X", created_by_email: "a@b.c" })
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("no autenticado");
  });

  it("2. devuelve 403 con role insuficiente", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), { code: "FORBIDDEN" })
    );
    const res = await route.POST(
      makeReq({ name: "X", created_by_email: "a@b.c" })
    );
    expect(res.status).toBe(403);
  });
});

// ============================================================
// Body validation (zod)
// ============================================================

describe("POST /api/admin/clients — body validation via zod", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValueOnce(undefined);
  });

  it("3. devuelve 400 si el body no es JSON válido", async () => {
    const req = new Request("http://localhost:3000/api/admin/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid"
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
  });

  it("4. devuelve 400 si el body no es un objeto (array, string, null)", async () => {
    const req1 = new Request("http://localhost:3000/api/admin/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["not", "an", "object"])
    });
    expect((await route.POST(req1)).status).toBe(400);
    const req2 = new Request("http://localhost:3000/api/admin/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(null)
    });
    expect((await route.POST(req2)).status).toBe(400);
  });

  it("5. devuelve 400 si name falta, esta vacio, o es whitespace-only", async () => {
    expect((await route.POST(makeReq({ created_by_email: "a@b.c" }))).status).toBe(400);
    expect((await route.POST(makeReq({ name: "", created_by_email: "a@b.c" }))).status).toBe(400);
    expect((await route.POST(makeReq({ name: "   ", created_by_email: "a@b.c" }))).status).toBe(400);
  });

  it("6. devuelve 400 si created_by_email falta", async () => {
    expect((await route.POST(makeReq({ name: "X" }))).status).toBe(400);
    expect((await route.POST(makeReq({ name: "X", created_by_email: "" }))).status).toBe(400);
  });

  it("7. devuelve 400 si name excede 200 chars", async () => {
    const res = await route.POST(
      makeReq({ name: "x".repeat(201), created_by_email: "a@b.c" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    // zod format: "<path>: <message>"
    expect(body.error).toMatch(/name/);
  });

  it("8. devuelve 400 con field path si notes no es string", async () => {
    const res = await route.POST(
      makeReq({ name: "X", notes: 123, created_by_email: "a@b.c" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/notes/);
  });

  it("9. response de 400 incluye `issues` array (zod PR #2 enhancement)", async () => {
    const res = await route.POST(makeReq({ name: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    // Backward compat: error message existe
    expect(body.error).toBeTruthy();
    // New: issues array con path y message
    expect(body.issues).toBeDefined();
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Éxito
// ============================================================

describe("POST /api/admin/clients — éxito", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValueOnce(undefined);
  });

  it("10. devuelve 201 con la client creada", async () => {
    const res = await route.POST(
      makeReq({ name: "Ingenio La Cabaña", created_by_email: "admin@aeroadmin.local" })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.client.id).toBe(1);
  });

  it("11. trimea name antes de enviar al repo", async () => {
    await route.POST(
      makeReq({ name: "  Cliente X  ", created_by_email: "a@b.c" })
    );
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    const arg = mockCreateClient.mock.calls[0][0];
    expect(arg.name).toBe("Cliente X");
  });

  it("12. notes null cuando se omite, string cuando viene", async () => {
    // Sin notes
    await route.POST(makeReq({ name: "X", created_by_email: "a@b.c" }));
    expect(mockCreateClient.mock.calls[0][0].notes).toBeNull();
    // Con notes
    mockRequireRole.mockResolvedValueOnce(undefined);
    await route.POST(
      makeReq({ name: "X", notes: "nota importante", created_by_email: "a@b.c" })
    );
    expect(mockCreateClient.mock.calls[1][0].notes).toBe("nota importante");
  });
});

// ============================================================
// Errores
// ============================================================

describe("POST /api/admin/clients — errores", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValueOnce(undefined);
  });

  it("13. name duplicado (UNIQUE) → 409", async () => {
    mockCreateClient.mockRejectedValueOnce(
      Object.assign(new Error("unique violation"), { code: "23505" })
    );
    const res = await route.POST(
      makeReq({ name: "Duplicado", created_by_email: "a@b.c" })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Ya existe|duplicado/i);
  });

  it("14. error inesperado → 500", async () => {
    mockCreateClient.mockRejectedValueOnce(
      Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" })
    );
    const res = await route.POST(
      makeReq({ name: "X", created_by_email: "a@b.c" })
    );
    expect(res.status).toBe(500);
  });
});
