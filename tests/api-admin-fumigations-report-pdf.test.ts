// tests/api-admin-fumigations-report-pdf.test.ts
//
// Test unitario del route handler `GET /api/admin/fumigations/[id]/report.pdf`
// (feature/fumigacion-detail-v2 / sub-4).
//
// Cubre:
//   - 200 OK con Content-Type application/pdf
//   - Body es un buffer PDF
//   - 401/403 según auth
//   - 404 si fumigación no existe
//   - 400 si id inválido
//   - Filename en Content-Disposition incluye el id
//   - Cache-Control: no-store
//   - renderHtmlToPdf es mockeado (no levanta Chromium — los tests
//     corren en ms)
//
// Mocks: getFumigationById, getParcelById, getFumigationFlights,
//        droneModel (de lib/data), requireRole, renderHtmlToPdf.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetFumigationById = vi.fn();
const mockGetParcelById = vi.fn();
const mockGetFumigationFlights = vi.fn();
vi.mock("@/api/repositories", () => ({
  getFumigationById: (...args: unknown[]) => mockGetFumigationById(...args),
  getParcelById: (...args: unknown[]) => mockGetParcelById(...args),
  getFumigationFlights: (...args: unknown[]) => mockGetFumigationFlights(...args)
}));

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args)
}));

const mockRenderPdf = vi.fn();
vi.mock("@/lib/reports/render-pdf", () => ({
  renderHtmlToPdf: (...args: unknown[]) => mockRenderPdf(...args)
}));

// Mockeamos @/lib/data (route importa `droneModel` de ahí, y el archivo
// tiene `import "server-only"` que rompe en vitest).
vi.mock("@/lib/data", () => ({
  droneModel: (id: number) => ({
    id,
    name: "Agras T40",
    tank_l: 40
  })
}));

const { GET } = await import(
  "@/app/api/admin/fumigations/[id]/report.pdf/route"
);

const FAKE_PDF = Buffer.from("%PDF-1.4\nfake pdf body\n%%EOF");

const FUMIGATION = {
  id: 1,
  parcel_id: 42,
  fumigation_date: "2026-08-13",
  product_used: "Glifosato 48%",
  dose_l_per_ha: 2.5,
  area_fumigated_m2: 12_345,
  drone_code_used: 201,
  duration_minutes: 45,
  notes: null,
  human_notes: "Lluvia matinal",
  recorded_by: "supervisor@afm.local",
  product_registered_ica: "ICA-1234-PN",
  pilot_license: "PCA-12345",
  recorded_at: "2026-08-13T15:00:00.000Z",
  source: "manual" as const,
  category_id: 1
};

const PARCEL = {
  id: 42,
  land_name: "Lote 12",
  external_id: "ext-abc-001"
};

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockRequireRole.mockReset();
  mockGetFumigationById.mockReset();
  mockGetParcelById.mockReset();
  mockGetFumigationFlights.mockReset();
  mockRenderPdf.mockReset();
  // Defaults: auth OK, fumigación existe, parcela existe, sin flights,
  // render devuelve un PDF chico.
  mockRequireRole.mockResolvedValue(undefined);
  mockGetFumigationById.mockResolvedValue(FUMIGATION);
  mockGetParcelById.mockResolvedValue(PARCEL);
  mockGetFumigationFlights.mockResolvedValue([]);
  mockRenderPdf.mockResolvedValue(FAKE_PDF);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Auth
// ============================================================

describe("GET /api/admin/fumigations/[id]/report.pdf — auth", () => {
  it("devuelve 401 si no hay sesión", async () => {
    mockRequireRole.mockRejectedValueOnce({ code: "UNAUTHENTICATED" });
    const res = await GET(new Request("http://localhost/x"), makeCtx("1"));
    expect(res.status).toBe(401);
  });

  it("devuelve 403 cuando el rol no es admin ni supervisor", async () => {
    mockRequireRole.mockRejectedValueOnce({ code: "FORBIDDEN" });
    const res = await GET(new Request("http://localhost/x"), makeCtx("1"));
    expect(res.status).toBe(403);
  });

  it("pasa el gate con role=admin", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    const res = await GET(new Request("http://localhost/x"), makeCtx("1"));
    expect(res.status).toBe(200);
  });

  it("pasa el gate con role=supervisor", async () => {
    mockRequireRole.mockResolvedValueOnce(undefined);
    const res = await GET(new Request("http://localhost/x"), makeCtx("1"));
    expect(res.status).toBe(200);
  });

  it("requireRole es llamado con ['admin', 'supervisor']", async () => {
    await GET(new Request("http://localhost/x"), makeCtx("1"));
    expect(mockRequireRole).toHaveBeenCalledWith(["admin", "supervisor"]);
  });
});

// ============================================================
// Path param
// ============================================================

describe("GET .../report.pdf — path param", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve 400 si el id no es numérico", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("abc"));
    expect(res.status).toBe(400);
    // No debe invocar al render
    expect(mockRenderPdf).not.toHaveBeenCalled();
  });

  it("devuelve 400 si el id es <= 0", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("0"));
    expect(res.status).toBe(400);
    expect(mockRenderPdf).not.toHaveBeenCalled();
  });
});

// ============================================================
// 404
// ============================================================

describe("GET .../report.pdf — 404", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve 404 si la fumigación no existe", async () => {
    mockGetFumigationById.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost/x"), makeCtx("9999"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("fumigación no encontrada");
  });
});

// ============================================================
// 200 — happy path
// ============================================================

describe("GET .../report.pdf — éxito", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve 200 con Content-Type application/pdf", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("el body es el PDF del renderHtmlToPdf mockeado", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("1"));
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(FAKE_PDF.length);
    expect(bytes[0]).toBe(FAKE_PDF[0]);
    expect(bytes[bytes.length - 1]).toBe(FAKE_PDF[FAKE_PDF.length - 1]);
  });

  it("incluye Content-Disposition con filename basado en el id", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="/);
    expect(disposition).toMatch(/fumigacion-42\.pdf"$/);
  });

  it("Cache-Control es no-store (no cachea el PDF)", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("1"));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("Content-Length coincide con el tamaño del PDF", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("1"));
    const lengthHeader = res.headers.get("content-length");
    expect(lengthHeader).toBe(String(FAKE_PDF.length));
  });

  it("renderHtmlToPdf es llamado con HTML que contiene el id de fumigación", async () => {
    // Mockeamos getFumigationById para que devuelva una fumigación con
    // id=42 cuando se le pide ese id. Por defecto el mock devuelve
    // FUMIGATION (id=1), lo cual no matchearía el HTML esperado.
    mockGetFumigationById.mockImplementationOnce(async (id: number) => ({
      ...FUMIGATION,
      id
    }));
    let capturedHtml = "";
    mockRenderPdf.mockImplementationOnce(async (html: string) => {
      capturedHtml = html;
      return FAKE_PDF;
    });
    await GET(new Request("http://localhost/x"), makeCtx("42"));
    expect(capturedHtml).toContain("Fumigación #42");
  });

  it("renderHtmlToPdf es llamado con HTML que tiene <!doctype html>", async () => {
    let capturedHtml = "";
    mockRenderPdf.mockImplementationOnce(async (html: string) => {
      capturedHtml = html;
      return FAKE_PDF;
    });
    await GET(new Request("http://localhost/x"), makeCtx("1"));
    expect(capturedHtml).toMatch(/^<!doctype html>/i);
  });

  it("carga la fumigación por id (no hardcoded)", async () => {
    await GET(new Request("http://localhost/x"), makeCtx("42"));
    expect(mockGetFumigationById).toHaveBeenCalledWith(42);
  });

  it("carga parcela y flights en paralelo (Promise.all)", async () => {
    await GET(new Request("http://localhost/x"), makeCtx("1"));
    expect(mockGetParcelById).toHaveBeenCalledWith(42);
    expect(mockGetFumigationFlights).toHaveBeenCalled();
  });
});

// ============================================================
// Robustez: renderHtmlToPdf rechaza → 500 con JSON (no HTML de Next).
// El try/catch se agregó en sub-4 para consistencia con el resto
// de los endpoints (mismo patrón que POST fumigations).
// ============================================================

describe("GET .../report.pdf — render errors (manejados con 500 JSON)", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("renderHtmlToPdf rechaza → 500 con JSON (chromium crashed)", async () => {
    mockRenderPdf.mockRejectedValueOnce(new Error("chromium crashed"));
    const res = await GET(new Request("http://localhost/x"), makeCtx("1"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("chromium crashed");
  });
});
