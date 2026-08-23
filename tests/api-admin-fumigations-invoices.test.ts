/**
 * tests/api-admin-fumigations-invoices.test.ts
 *
 * Test unitario de los endpoints de invoices:
 *   - POST /api/admin/fumigations/[id]/invoices
 *   - PATCH /api/admin/fumigations/[id]/invoices/[invoiceId]
 *
 * Sprint S7 — feature/s7-schema-extension / Fase 1 / PR-C.
 *
 * Cubre:
 *   - POST: happy path con body válido, devuelve 201 + invoice
 *   - POST: body inválido (4 ramas: invoice_number, invoiced_at, amount_cop, id)
 *   - POST: fumigación no existe → 404
 *   - POST: UNIQUE violation (duplicate invoice_number) → 409
 *   - PATCH: happy path → 200 + invoice cancelado
 *   - PATCH: idempotente si ya estaba cancelada
 *   - PATCH: invoice no existe → 404
 *   - PATCH: invoice no pertenece a la fumigación del path → 404
 *   - Auth: 401 si no autenticado, 403 si rol insuficiente
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Mocks
// ============================================================

// Mock del requireRole y auth (luego el caso por caso hace fallback a los
// helpers reales para los happy paths).
const mockRequireRole = vi.fn();
const mockAuth = vi.fn();
vi.mock("@/lib/auth/role", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args)
}));
vi.mock("@/lib/auth", () => ({
  auth: () => mockAuth()
}));

// Mock de repositorios.
const mockCreateFumigationInvoice = vi.fn();
const mockCancelFumigationInvoice = vi.fn();
const mockGetFumigationById = vi.fn();

vi.mock("@/api/repositories", () => ({
  createFumigationInvoice: (...args: unknown[]) => mockCreateFumigationInvoice(...args),
  cancelFumigationInvoice: (...args: unknown[]) => mockCancelFumigationInvoice(...args),
  getFumigationById: (...args: unknown[]) => mockGetFumigationById(...args)
}));

// ============================================================
// Helpers
// ============================================================

beforeEach(() => {
  mockRequireRole.mockReset();
  mockAuth.mockReset();
  mockCreateFumigationInvoice.mockReset();
  mockCancelFumigationInvoice.mockReset();
  mockGetFumigationById.mockReset();
  // Default: role OK + auth OK
  mockRequireRole.mockResolvedValue({ role: "admin" });
  mockAuth.mockResolvedValue({ user: { email: "admin@aeroadmin.local" } });
});

afterEach(() => {
  vi.clearAllMocks();
});

const SAMPLE_INVOICE = {
  id: 1,
  fumigation_id: 100,
  invoice_number: "FVE-2051",
  invoiced_at: "2026-07-15",
  amount_cop: "1500000.00",
  cancelled: false,
  cancelled_at: null,
  cancelled_by: null,
  created_at: "2026-07-15T10:00:00.000Z",
  updated_at: "2026-07-15T10:00:00.000Z"
};

// ============================================================
// POST /api/admin/fumigations/[id]/invoices
// ============================================================

describe("POST /api/admin/fumigations/[id]/invoices", () => {
  it("happy path: crea factura con body válido", async () => {
    mockGetFumigationById.mockResolvedValueOnce({ id: 100 });
    mockCreateFumigationInvoice.mockResolvedValueOnce(SAMPLE_INVOICE);

    const { POST } = await import("@/app/api/admin/fumigations/[id]/invoices/route");
    const req = new Request("http://x/api/admin/fumigations/100/invoices", {
      method: "POST",
      body: JSON.stringify({
        invoice_number: "FVE-2051",
        invoiced_at: "2026-07-15",
        amount_cop: 1500000
      })
    });
    const res = await POST(req, { params: Promise.resolve({ id: "100" }) });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { invoice: typeof SAMPLE_INVOICE };
    expect(json.invoice).toEqual(SAMPLE_INVOICE);
    expect(mockCreateFumigationInvoice).toHaveBeenCalledWith({
      fumigation_id: 100,
      invoice_number: "FVE-2051",
      invoiced_at: "2026-07-15",
      amount_cop: 1500000
    });
  });

  it("rechaza body sin invoice_number", async () => {
    const { POST } = await import("@/app/api/admin/fumigations/[id]/invoices/route");
    const req = new Request("http://x/", {
      method: "POST",
      body: JSON.stringify({ invoiced_at: "2026-07-15", amount_cop: 100 })
    });
    const res = await POST(req, { params: Promise.resolve({ id: "100" }) });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/invoice_number/);
  });

  it("rechaza invoice_number > 50 chars", async () => {
    const { POST } = await import("@/app/api/admin/fumigations/[id]/invoices/route");
    const req = new Request("http://x/", {
      method: "POST",
      body: JSON.stringify({
        invoice_number: "X".repeat(51),
        invoiced_at: "2026-07-15",
        amount_cop: 100
      })
    });
    const res = await POST(req, { params: Promise.resolve({ id: "100" }) });
    expect(res.status).toBe(400);
  });

  it("rechaza invoiced_at con formato inválido", async () => {
    const { POST } = await import("@/app/api/admin/fumigations/[id]/invoices/route");
    const req = new Request("http://x/", {
      method: "POST",
      body: JSON.stringify({ invoice_number: "FVE-1", invoiced_at: "07/15/2026", amount_cop: 100 })
    });
    const res = await POST(req, { params: Promise.resolve({ id: "100" }) });
    expect(res.status).toBe(400);
  });

  it("rechaza amount_cop negativo", async () => {
    const { POST } = await import("@/app/api/admin/fumigations/[id]/invoices/route");
    const req = new Request("http://x/", {
      method: "POST",
      body: JSON.stringify({
        invoice_number: "FVE-1",
        invoiced_at: "2026-07-15",
        amount_cop: -100
      })
    });
    const res = await POST(req, { params: Promise.resolve({ id: "100" }) });
    expect(res.status).toBe(400);
  });

  it("devuelve 404 si la fumigación no existe", async () => {
    mockGetFumigationById.mockResolvedValueOnce(null);
    const { POST } = await import("@/app/api/admin/fumigations/[id]/invoices/route");
    const req = new Request("http://x/", {
      method: "POST",
      body: JSON.stringify({
        invoice_number: "FVE-1",
        invoiced_at: "2026-07-15",
        amount_cop: 100
      })
    });
    const res = await POST(req, { params: Promise.resolve({ id: "999" }) });
    expect(res.status).toBe(404);
    expect(mockCreateFumigationInvoice).not.toHaveBeenCalled();
  });

  it("devuelve 409 en UNIQUE violation (duplicate invoice_number)", async () => {
    mockGetFumigationById.mockResolvedValueOnce({ id: 100 });
    const err = new Error("duplicate") as Error & { code: string };
    err.code = "23505";
    mockCreateFumigationInvoice.mockRejectedValueOnce(err);
    const { POST } = await import("@/app/api/admin/fumigations/[id]/invoices/route");
    const req = new Request("http://x/", {
      method: "POST",
      body: JSON.stringify({
        invoice_number: "FVE-1",
        invoiced_at: "2026-07-15",
        amount_cop: 100
      })
    });
    const res = await POST(req, { params: Promise.resolve({ id: "100" }) });
    expect(res.status).toBe(409);
  });

  it("rechaza id inválido (no positivo)", async () => {
    const { POST } = await import("@/app/api/admin/fumigations/[id]/invoices/route");
    const req = new Request("http://x/", {
      method: "POST",
      body: JSON.stringify({
        invoice_number: "FVE-1",
        invoiced_at: "2026-07-15",
        amount_cop: 100
      })
    });
    const res = await POST(req, { params: Promise.resolve({ id: "0" }) });
    expect(res.status).toBe(400);
  });
});

// ============================================================
// PATCH /api/admin/fumigations/[id]/invoices/[invoiceId]
// ============================================================

describe("PATCH /api/admin/fumigations/[id]/invoices/[invoiceId]", () => {
  it("happy path: cancela factura", async () => {
    const cancelled = { ...SAMPLE_INVOICE, cancelled: true, cancelled_by: "admin@aeroadmin.local" };
    mockCancelFumigationInvoice.mockResolvedValueOnce(cancelled);
    const { PATCH } = await import(
      "@/app/api/admin/fumigations/[id]/invoices/[invoiceId]/route"
    );
    const req = new Request("http://x/", { method: "PATCH" });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "100", invoiceId: "1" })
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { invoice: typeof cancelled };
    expect(json.invoice.cancelled).toBe(true);
    expect(mockCancelFumigationInvoice).toHaveBeenCalledWith(1, "admin@aeroadmin.local");
  });

  it("devuelve 404 si la factura no existe", async () => {
    mockCancelFumigationInvoice.mockResolvedValueOnce(null);
    const { PATCH } = await import(
      "@/app/api/admin/fumigations/[id]/invoices/[invoiceId]/route"
    );
    const req = new Request("http://x/", { method: "PATCH" });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "100", invoiceId: "999" })
    });
    expect(res.status).toBe(404);
  });

  it("devuelve 404 si la factura pertenece a otra fumigación", async () => {
    const otherFum = { ...SAMPLE_INVOICE, fumigation_id: 200 };
    mockCancelFumigationInvoice.mockResolvedValueOnce(otherFum);
    const { PATCH } = await import(
      "@/app/api/admin/fumigations/[id]/invoices/[invoiceId]/route"
    );
    const req = new Request("http://x/", { method: "PATCH" });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "100", invoiceId: "1" })
    });
    expect(res.status).toBe(404);
  });

  it("rechaza invoiceId inválido", async () => {
    const { PATCH } = await import(
      "@/app/api/admin/fumigations/[id]/invoices/[invoiceId]/route"
    );
    const req = new Request("http://x/", { method: "PATCH" });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "100", invoiceId: "0" })
    });
    expect(res.status).toBe(400);
  });
});

// ============================================================
// Auth
// ============================================================

describe("Auth gates (aplican a POST y PATCH)", () => {
  it("POST devuelve 401 si no autenticado", async () => {
    mockRequireRole.mockRejectedValueOnce({ code: "UNAUTHENTICATED", message: "no auth" });
    const { POST } = await import("@/app/api/admin/fumigations/[id]/invoices/route");
    const req = new Request("http://x/", {
      method: "POST",
      body: JSON.stringify({
        invoice_number: "FVE-1",
        invoiced_at: "2026-07-15",
        amount_cop: 100
      })
    });
    const res = await POST(req, { params: Promise.resolve({ id: "100" }) });
    expect(res.status).toBe(401);
  });

  it("PATCH devuelve 403 si rol insuficiente", async () => {
    mockRequireRole.mockRejectedValueOnce({ code: "FORBIDDEN", message: "no role" });
    const { PATCH } = await import(
      "@/app/api/admin/fumigations/[id]/invoices/[invoiceId]/route"
    );
    const req = new Request("http://x/", { method: "PATCH" });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "100", invoiceId: "1" })
    });
    expect(res.status).toBe(403);
  });
});
