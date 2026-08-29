// Tests del endpoint /api/admin/products
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock next-auth
const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args)
}));

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: () => mockAuth()
}));

// Mock repo functions
const mockSearch = vi.fn();
const mockCreate = vi.fn();
const mockFindByName = vi.fn();
vi.mock("@/api/repositories", () => ({
  searchDjiProducts: (...args: unknown[]) => mockSearch(...args),
  createDjiProduct: (...args: unknown[]) => mockCreate(...args),
  findDjiProductByName: (...args: unknown[]) => mockFindByName(...args)
}));

import { GET, POST } from "@/app/api/admin/products/route";

beforeEach(() => {
  mockRequireRole.mockReset();
  mockSearch.mockReset();
  mockCreate.mockReset();
  mockFindByName.mockReset();
  mockAuth.mockReset();
  mockRequireRole.mockResolvedValue(undefined);
  // Default auth mock: returns admin session. Tests que no quieren
  // session pueden sobreescribir con mockAuth.mockResolvedValueOnce(null).
  mockAuth.mockResolvedValue({ user: { email: "admin@aeroadmin.local" } });
});

function makeReq(method: "GET" | "POST", url: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
}

describe("GET /api/admin/products", () => {
  it("1. happy path: devuelve productos del search", async () => {
    mockSearch.mockResolvedValueOnce([
      {
        id: 1,
        name: "Glifosato 48% LCE",
        category: "herbicida",
        active_ingredient: "Glifosato",
        ica_registration: "ICA-12345",
        display_color: "#84cc16",
        notes: null,
        is_active: true,
        created_by: "system@dji-import",
        created_at: "2026-08-29T00:00:00Z",
        updated_at: "2026-08-29T00:00:00Z"
      }
    ]);
    const req = makeReq("GET", "https://x.com/api/admin/products?search=Glif");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.products).toHaveLength(1);
    expect(json.products[0].name).toBe("Glifosato 48% LCE");
  });

  it("2. 401 cuando no autenticado", async () => {
    const e = new Error("UNAUTHENTICATED") as Error & { code: string };
    e.code = "UNAUTHENTICATED";
    mockRequireRole.mockRejectedValueOnce(e);
    const req = makeReq("GET", "https://x.com/api/admin/products");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/admin/products", () => {
  it("3. happy path: crea producto nuevo, devuelve 201", async () => {
    mockFindByName.mockResolvedValueOnce(null);
    mockAuth.mockResolvedValueOnce({
      user: { email: "admin@aeroadmin.local" }
    });
    mockCreate.mockResolvedValueOnce({
      id: 42,
      name: "Roundup 36% SL",
      category: "herbicida",
      active_ingredient: null,
      ica_registration: null,
      display_color: null,
      notes: null,
      is_active: true,
      created_by: "admin@aeroadmin.local",
      created_at: "2026-08-29T00:00:00Z",
      updated_at: "2026-08-29T00:00:00Z"
    });
    const req = makeReq("POST", "https://x.com/api/admin/products", {
      name: "Roundup 36% SL",
      category: "herbicida"
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.product.id).toBe(42);
  });

  it("4. idempotente: si ya existe, devuelve 200", async () => {
    const existing = {
      id: 5,
      name: "Glifosato 48% LCE",
      category: "herbicida",
      active_ingredient: "Glifosato",
      ica_registration: "ICA-12345",
      display_color: "#84cc16",
      notes: null,
      is_active: true,
      created_by: "system@dji-import",
      created_at: "2026-08-29T00:00:00Z",
      updated_at: "2026-08-29T00:00:00Z"
    };
    mockFindByName.mockResolvedValueOnce(existing);
    const req = makeReq("POST", "https://x.com/api/admin/products", {
      name: "glifosato 48% lce"
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.product.id).toBe(5);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("5. validation: name vacio → 400", async () => {
    const req = makeReq("POST", "https://x.com/api/admin/products", {
      name: ""
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("6. validation: category invalida → 400", async () => {
    const req = makeReq("POST", "https://x.com/api/admin/products", {
      name: "Foo",
      category: "no-existe"
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("7. validation: display_color mal formato → 400", async () => {
    const req = makeReq("POST", "https://x.com/api/admin/products", {
      name: "Foo",
      display_color: "red"
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("8. validation: body JSON invalido → 400", async () => {
    const req = new Request("https://x.com/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json"
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
