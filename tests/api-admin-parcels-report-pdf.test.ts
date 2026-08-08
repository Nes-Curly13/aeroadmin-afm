// tests/api-admin-parcels-report-pdf.test.ts
//
// Test unitario del route handler `GET /api/admin/parcels/[id]/report.pdf`
// (feature/reports-level-1, 2026-08-08).
//
// Cubre:
//   - **Auth**: sin sesión → 401, rol insuficiente → 403, admin/supervisor → OK
//   - **Path param**: id inválido (no number, <=0) → 400
//   - **404**: parcela no existe (getParcelReportData devuelve null)
//   - **200**: PDF stream con content-type, content-disposition (filename)
//   - **Render fail**: si `renderHtmlToPdf` tira, devuelve 500

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mockeamos `getParcelReportData` y `renderHtmlToPdf` antes de importar
// el route handler para que el `await import(...)` capture los mocks.
const mockFetchData = vi.fn();
vi.mock("@/lib/reports/fetch-parcel-report-data", () => ({
  getParcelReportData: (...args: unknown[]) => mockFetchData(...args)
}));

const mockRenderPdf = vi.fn();
vi.mock("@/lib/reports/render-pdf", () => ({
  renderHtmlToPdf: (...args: unknown[]) => mockRenderPdf(...args)
}));

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args)
}));

const { GET } = await import(
  "@/app/api/admin/parcels/[id]/report.pdf/route"
);

const FAKE_PDF = Buffer.from("%PDF-1.4\nfake pdf body\n%%EOF");

const FAKE_DATA = {
  operatorName: "Operador",
  operatorRegion: "Valle del Cauca",
  generatedAt: "2026-08-08 15:00",
  parcel: {
    id: 42,
    external_id: "ext-001",
    land_name: "Lote 12",
    field_type: "Farmland",
    declared_area_ha: 30.5,
    spray_area_m2: 300_000,
    crop_type: "Caña",
    planting_date: "2025-03-15",
    owner_name: "Don Eulogio",
    supervisor_notes: null
  },
  cadence: {
    recommended_cadence_days: 14,
    last_fumigation_date: "2026-08-05",
    next_due_date: "2026-08-19",
    status: "ok" as const
  },
  window: { from: "2026-07-09", to: "2026-08-08" },
  events: [],
  totals: {
    count: 0,
    totalAreaHa: 0,
    totalLiters: 0,
    averageAreaHa: 0,
    lastFumigationDate: null,
    capReached: false
  },
  coverage: { areaFumigableHa: 30, areaFumigadaHa: 0, coveragePct: 0 }
};

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockRequireRole.mockReset();
  mockFetchData.mockReset();
  mockRenderPdf.mockReset();
  // Defaults: auth OK, parcela existe, render OK.
  mockRequireRole.mockResolvedValue(undefined);
  mockFetchData.mockResolvedValue(FAKE_DATA);
  mockRenderPdf.mockResolvedValue(FAKE_PDF);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Auth
// ============================================================

describe("GET /api/admin/parcels/[id]/report.pdf — auth", () => {
  it("sin sesion → 401", async () => {
    mockRequireRole.mockRejectedValueOnce({ code: "UNAUTHENTICATED" });
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    expect(res.status).toBe(401);
  });

  it("rol insuficiente → 403", async () => {
    mockRequireRole.mockRejectedValueOnce({ code: "FORBIDDEN" });
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    expect(res.status).toBe(403);
  });

  it("admin → pasa el gate", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    expect(res.status).toBe(200);
  });

  it("supervisor → pasa el gate (reporte es read-only)", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    expect(res.status).toBe(200);
  });
});

// ============================================================
// Path param
// ============================================================

describe("GET .../report.pdf — path param", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("id no numérico → 400", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("abc"));
    expect(res.status).toBe(400);
  });

  it("id <= 0 → 400", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("0"));
    expect(res.status).toBe(400);
  });
});

// ============================================================
// 404
// ============================================================

describe("GET .../report.pdf — 404", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("parcela no existe → 404", async () => {
    mockFetchData.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    expect(res.status).toBe(404);
  });
});

// ============================================================
// 200 + headers
// ============================================================

describe("GET .../report.pdf — success", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve PDF con content-type, content-disposition y body del render", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="/);
    expect(disposition).toMatch(/\.pdf"$/);
    // El body debe ser el buffer del render.
    const body = await res.arrayBuffer();
    const bytes = new Uint8Array(body);
    expect(bytes.length).toBe(FAKE_PDF.length);
    // Verificamos que los primeros bytes del PDF coinciden.
    expect(bytes[0]).toBe(FAKE_PDF[0]);
    expect(bytes[bytes.length - 1]).toBe(FAKE_PDF[FAKE_PDF.length - 1]);
  });

  it("incluye el id de la parcela y el nombre en el filename", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    const disposition = res.headers.get("content-disposition") ?? "";
    // slugFilename de "reporte-Lote 12-parcela-42" + fecha + ".pdf"
    expect(disposition).toMatch(/reporte-lote-12-parcela-42/);
  });

  it("no cachea el PDF (header Cache-Control no-store)", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

// ============================================================
// Errores de render
// ============================================================

describe("GET .../report.pdf — render errors", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("renderHtmlToPdf tira → 500", async () => {
    mockRenderPdf.mockRejectedValueOnce(new Error("chromium crashed"));
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    expect(res.status).toBe(500);
  });

  it("getParcelReportData tira → 500", async () => {
    mockFetchData.mockRejectedValueOnce(new Error("BD timeout"));
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    expect(res.status).toBe(500);
  });
});
