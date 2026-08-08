// tests/api-admin-parcels-report-csv.test.ts
//
// Test unitario del route handler `GET /api/admin/parcels/[id]/report.csv`
// (feature/reports-level-1, 2026-08-08).
//
// Cubre:
//   - **Auth**: sin sesión → 401, rol insuficiente → 403, admin/supervisor → OK
//   - **Path param**: id inválido (no number, <=0) → 400
//   - **404**: parcela no existe
//   - **200**: CSV con content-type, BOM, filename
//   - **Content-Disposition** incluye el nombre slugificado

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchData = vi.fn();
vi.mock("@/lib/reports/fetch-parcel-report-data", () => ({
  getParcelReportData: (...args: unknown[]) => mockFetchData(...args)
}));

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args)
}));

const { GET } = await import(
  "@/app/api/admin/parcels/[id]/report.csv/route"
);

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
  coverage: { areaFumigableHa: 30, areaFumigadaHa: 0, coveragePct: 0 },
  location: null
};

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockRequireRole.mockReset();
  mockFetchData.mockReset();
  mockRequireRole.mockResolvedValue(undefined);
  mockFetchData.mockResolvedValue(FAKE_DATA);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Auth
// ============================================================

describe("GET /api/admin/parcels/[id]/report.csv — auth", () => {
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

  it("supervisor → pasa el gate", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    expect(res.status).toBe(200);
  });
});

// ============================================================
// Path param
// ============================================================

describe("GET .../report.csv — path param", () => {
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

describe("GET .../report.csv — 404", () => {
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

describe("GET .../report.csv — success", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve CSV con content-type, BOM y filename slugificado", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="/);
    expect(disposition).toMatch(/\.csv"$/);
    expect(disposition).toMatch(/reporte-lote-12-parcela-42/);
  });

  it("el body empieza con BOM U+FEFF (Excel UTF-8)", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    // Usamos arrayBuffer + Buffer en vez de res.text() porque
    // TextDecoder salta el BOM por default — queremos ver el BOM
    // crudo en el body.
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
  });

  it("el body incluye las 4 secciones del reporte", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    const body = await res.text();
    expect(body).toContain("Sección;Cabecera");
    expect(body).toContain("Sección;Parcela");
    expect(body).toContain("Sección;Fumigaciones (0)");
    expect(body).toContain("Sección;Totales");
  });

  it("no cachea el CSV (header Cache-Control no-store)", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

// ============================================================
// Errores de carga
// ============================================================

describe("GET .../report.csv — fetch errors", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("getParcelReportData tira → 500", async () => {
    mockFetchData.mockRejectedValueOnce(new Error("BD timeout"));
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    expect(res.status).toBe(500);
  });
});
