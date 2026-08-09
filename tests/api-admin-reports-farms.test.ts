// tests/api-admin-reports-farms.test.ts
//
// Test unitario de los route handlers del farms report (nivel 2, 2026-08-08):
//   - GET /api/admin/reports/farms/report.pdf
//   - GET /api/admin/reports/farms/report.csv
//
// Cubre:
//   - Auth: sin sesión → 401, sin rol → 403, admin/supervisor → OK
//   - Query params: from/to requeridos + formato YYYY-MM-DD, farm opcional
//   - Success: 200 + content-type correcto

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchData = vi.fn();
vi.mock("@/lib/reports/fetch-farms-report-data", () => ({
  fetchFarmsReportData: (...args: unknown[]) => mockFetchData(...args)
}));

const mockRenderPdf = vi.fn();
vi.mock("@/lib/reports/render-pdf", () => ({
  renderHtmlToPdf: (...args: unknown[]) => mockRenderPdf(...args)
}));

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args)
}));

const { GET: GET_PDF } = await import(
  "@/app/api/admin/reports/farms/report.pdf/route"
);
const { GET: GET_CSV } = await import(
  "@/app/api/admin/reports/farms/report.csv/route"
);

const FAKE_DATA = {
  operatorName: "Operador",
  operatorRegion: "Valle del Cauca",
  generatedAt: "2026-08-08T20:00:00.000Z",
  window: { from: "2026-07-09", to: "2026-08-08" },
  farmName: "EL LIMAR",
  lastFumigation: null,
  fumigations: [],
  capReached: false,
  parcels: [],
  totals: { nFumigations: 0, totalAreaHa: 0, totalLiters: 0, nParcels: 0 }
};

const FAKE_PDF = Buffer.from("%PDF-1.4\nfake\n%%EOF");

function makeReq(query: string): Request {
  return new Request(`http://localhost/api/admin/reports/farms/report.pdf${query}`, {
    method: "GET"
  });
}

beforeEach(() => {
  mockRequireRole.mockReset();
  mockFetchData.mockReset();
  mockRenderPdf.mockReset();
  mockRequireRole.mockResolvedValue(undefined);
  mockFetchData.mockResolvedValue(FAKE_DATA);
  mockRenderPdf.mockResolvedValue(FAKE_PDF);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// PDF
// ============================================================

describe("GET /api/admin/reports/farms/report.pdf — auth", () => {
  it("sin sesión → 401", async () => {
    mockRequireRole.mockRejectedValueOnce({ code: "UNAUTHENTICATED" });
    const res = await GET_PDF(makeReq("?from=2026-07-09&to=2026-08-08"));
    expect(res.status).toBe(401);
  });
  it("rol insuficiente → 403", async () => {
    mockRequireRole.mockRejectedValueOnce({ code: "FORBIDDEN" });
    const res = await GET_PDF(makeReq("?from=2026-07-09&to=2026-08-08"));
    expect(res.status).toBe(403);
  });
});

describe("GET .../report.pdf — query params", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });
  it("falta 'from' → 400", async () => {
    const res = await GET_PDF(makeReq("?to=2026-08-08"));
    expect(res.status).toBe(400);
  });
  it("falta 'to' → 400", async () => {
    const res = await GET_PDF(makeReq("?from=2026-07-09"));
    expect(res.status).toBe(400);
  });
  it("formato de 'from' inválido → 400", async () => {
    const res = await GET_PDF(makeReq("?from=2026/07/09&to=2026-08-08"));
    expect(res.status).toBe(400);
  });
});

describe("GET .../report.pdf — success", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });
  it("devuelve PDF con content-type, content-disposition y body del render", async () => {
    const res = await GET_PDF(makeReq("?from=2026-07-09&to=2026-08-08&farm=EL%20LIMAR"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="/);
    expect(disposition).toMatch(/\.pdf"$/);
    expect(disposition).toMatch(/reporte-fumigaciones-el-limar/);
  });
  it("render falla → 500", async () => {
    mockRenderPdf.mockRejectedValueOnce(new Error("chromium"));
    const res = await GET_PDF(makeReq("?from=2026-07-09&to=2026-08-08"));
    expect(res.status).toBe(500);
  });
});

// ============================================================
// CSV
// ============================================================

describe("GET /api/admin/reports/farms/report.csv — auth", () => {
  it("sin sesión → 401", async () => {
    mockRequireRole.mockRejectedValueOnce({ code: "UNAUTHENTICATED" });
    const res = await GET_CSV(makeReq("?from=2026-07-09&to=2026-08-08"));
    expect(res.status).toBe(401);
  });
});

describe("GET .../report.csv — success", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });
  it("devuelve CSV con content-type, BOM y filename", async () => {
    const res = await GET_CSV(makeReq("?from=2026-07-09&to=2026-08-08&farm=EL%20LIMAR"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="/);
    expect(disposition).toMatch(/\.csv"$/);
    expect(disposition).toMatch(/reporte-fumigaciones-el-limar/);
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
  });
  it("fetch falla → 500", async () => {
    mockFetchData.mockRejectedValueOnce(new Error("BD timeout"));
    const res = await GET_CSV(makeReq("?from=2026-07-09&to=2026-08-08"));
    expect(res.status).toBe(500);
  });
});
