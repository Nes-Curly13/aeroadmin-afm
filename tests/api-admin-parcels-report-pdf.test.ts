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

const mockRenderMapPng = vi.fn();
vi.mock("@/lib/reports/render-map-screenshot", () => ({
  renderParcelMapToPng: (...args: unknown[]) => mockRenderMapPng(...args)
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
  coverage: { areaFumigableHa: 30, areaFumigadaHa: 0, coveragePct: 0 },
  // feature/reports-level-1 sub-sprint 2: la location es null en el
  // fixture default. El template renderiza la sección "Ubicación" solo
  // si hay location con bbox. Los tests específicos mockean location
  // no-null para verificar el SVG.
  location: null
};

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockRequireRole.mockReset();
  mockFetchData.mockReset();
  mockRenderPdf.mockReset();
  mockRenderMapPng.mockReset();
  // Defaults: auth OK, parcela existe, render OK, screenshot null
  // (default fixture tiene location: null, así que no se llama).
  mockRequireRole.mockResolvedValue(undefined);
  mockFetchData.mockResolvedValue(FAKE_DATA);
  mockRenderPdf.mockResolvedValue(FAKE_PDF);
  mockRenderMapPng.mockResolvedValue(null);
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
// feature/reports-level-1 sub-sprint 2: sección "Ubicación" en el PDF
// ============================================================

describe("GET .../report.pdf — sección Ubicación", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("incluye el SVG del polígono cuando location no es null", async () => {
    // Capturamos el HTML que se le pasa a renderHtmlToPdf.
    let capturedHtml = "";
    mockRenderPdf.mockImplementationOnce(async (html: string) => {
      capturedHtml = html;
      return FAKE_PDF;
    });
    // Mockeamos getParcelReportData con location no-null.
    const { buildParcelLocation } = await import("@/lib/reports/parcel-svg");
    mockFetchData.mockResolvedValueOnce({
      ...FAKE_DATA,
      location: buildParcelLocation({
        type: "Polygon",
        coordinates: [[
          [-76.5005, 3.3995],
          [-76.4995, 3.3995],
          [-76.4995, 3.4005],
          [-76.5005, 3.4005],
          [-76.5005, 3.3995]
        ]]
      })
    });
    await GET(new Request("http://localhost/x"), makeCtx("42"));
    // El HTML capturado debe tener la sección "Ubicación" + el SVG.
    expect(capturedHtml).toContain("<h2>Ubicación</h2>");
    expect(capturedHtml).toContain("<svg");
    expect(capturedHtml).toContain("viewBox");
    expect(capturedHtml).toContain('class="location-svg"');
    expect(capturedHtml).toContain("Centroide");
    expect(capturedHtml).toContain("Bbox");
  });

  it("muestra mensaje 'Sin geometría' cuando location es null", async () => {
    let capturedHtml = "";
    mockRenderPdf.mockImplementationOnce(async (html: string) => {
      capturedHtml = html;
      return FAKE_PDF;
    });
    mockFetchData.mockResolvedValueOnce({ ...FAKE_DATA, location: null });
    await GET(new Request("http://localhost/x"), makeCtx("42"));
    expect(capturedHtml).toContain("<h2>Ubicación</h2>");
    expect(capturedHtml).toContain("Sin geometría");
  });
});

// ============================================================
// feature/reports-level-1 sub-sprint 3: imagen satelital en PDF
// ============================================================

describe("GET .../report.pdf — imagen satelital", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("incluye la imagen satelital cuando renderParcelMapToPng devuelve un PNG", async () => {
    let capturedHtml = "";
    mockRenderPdf.mockImplementationOnce(async (html: string) => {
      capturedHtml = html;
      return FAKE_PDF;
    });
    // Mockeamos getParcelReportData con location no-null.
    const { buildParcelLocation } = await import("@/lib/reports/parcel-svg");
    mockFetchData.mockResolvedValueOnce({
      ...FAKE_DATA,
      location: buildParcelLocation({
        type: "Polygon",
        coordinates: [[
          [-76.5005, 3.3995],
          [-76.4995, 3.3995],
          [-76.4995, 3.4005],
          [-76.5005, 3.4005],
          [-76.5005, 3.3995]
        ]]
      })
    });
    // mockeamos render-map-screenshot para que devuelva un PNG.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    mockRenderMapPng.mockResolvedValueOnce(png);
    await GET(new Request("http://localhost/x"), makeCtx("42"));
    // El HTML capturado debe tener un <img> con data URL PNG.
    expect(capturedHtml).toContain("<img");
    expect(capturedHtml).toMatch(/src="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
    expect(capturedHtml).toContain("Satelital");
    expect(capturedHtml).toContain("Sentinel-2");
  });

  it("cae al SVG cuando renderParcelMapToPng devuelve null (EOX caído, timeout)", async () => {
    let capturedHtml = "";
    mockRenderPdf.mockImplementationOnce(async (html: string) => {
      capturedHtml = html;
      return FAKE_PDF;
    });
    const { buildParcelLocation } = await import("@/lib/reports/parcel-svg");
    mockFetchData.mockResolvedValueOnce({
      ...FAKE_DATA,
      location: buildParcelLocation({
        type: "Polygon",
        coordinates: [[
          [-76.5005, 3.3995],
          [-76.4995, 3.3995],
          [-76.4995, 3.4005],
          [-76.5005, 3.4005],
          [-76.5005, 3.3995]
        ]]
      })
    });
    // Screenshot devuelve null
    mockRenderMapPng.mockResolvedValueOnce(null);
    await GET(new Request("http://localhost/x"), makeCtx("42"));
    // No debe haber <img> con data URL PNG.
    expect(capturedHtml).not.toMatch(/data:image\/png;base64,/);
    // Debe estar el SVG vectorial.
    expect(capturedHtml).toContain("<svg");
    expect(capturedHtml).toContain("Vectorial");
  });

  it("no intenta screenshot si la parcela no tiene location.bbox", async () => {
    let capturedHtml = "";
    mockRenderPdf.mockImplementationOnce(async (html: string) => {
      capturedHtml = html;
      return FAKE_PDF;
    });
    mockFetchData.mockResolvedValueOnce({ ...FAKE_DATA, location: null });
    await GET(new Request("http://localhost/x"), makeCtx("42"));
    // El screenshot no debería haberse llamado (location es null).
    expect(mockRenderMapPng).not.toHaveBeenCalled();
    expect(capturedHtml).toContain("Sin geometría");
    expect(capturedHtml).not.toMatch(/data:image\/png;base64,/);
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
