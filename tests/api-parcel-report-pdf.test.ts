// tests/api-parcel-report-pdf.test.ts
//
// Smoke test para GET /api/parcels/[id]/report.pdf (Sprint B — F1.11).
//
// Cubre:
//   - 401 sin sesión
//   - 400 con parcelId no numérico
//   - 404 si la parcela no existe
//   - 200 happy path: Content-Type application/pdf, buffer con bytes
//     válidos (header %PDF), Content-Disposition con filename
//   - Verifica que el HTML pasado a Playwright contiene los datos
//     esperados (header del operador, datos de la parcela, totales)
//
// Estrategia: mockeamos Playwright para no levantar chromium en CI.
// Mockeamos también `getParcelReportData` y `buildParcelReportHtml`
// para tener control total sobre lo que la route recibe.
//
// Out of scope (no testeamos acá):
//   - El render PDF real (eso sería un e2e con Playwright vivo, no un
//     unit test).
//   - El cache `unstable_cache` (eso es responsabilidad de Next.js;
//     el route solo llama a `unstable_cache` que no es mockeable en
//     vitest sin un Next runtime completo).

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Mocks hoisted
// ============================================================

const repositoryMocks = vi.hoisted(() => ({
  getParcelById: vi.fn(),
  getFumigationSchedule: vi.fn(),
  getFumigationTimelineForParcel: vi.fn()
}));

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn()
}));

// Mock de Playwright. El route importa via `require("playwright")`
// (lazy), así que mockeamos el módulo entero.
const playwrightMocks = vi.hoisted(() => {
  const pdf = vi.fn().mockResolvedValue(Buffer.from("%PDF-1.4\nfake pdf body for test\n%%EOF"));
  const setContent = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const newPage = vi.fn().mockResolvedValue({ setContent, pdf, close });
  const newContext = vi.fn().mockResolvedValue({ newPage, close });
  const browserClose = vi.fn().mockResolvedValue(undefined);
  const launch = vi.fn().mockResolvedValue({
    newContext,
    close: browserClose
  });
  return { chromium: { launch }, _pdf: pdf, _setContent: setContent };
});

const fetchDataMocks = vi.hoisted(() => ({
  getParcelReportData: vi.fn()
}));

const templateMocks = vi.hoisted(() => ({
  buildParcelReportHtml: vi.fn()
}));

vi.mock("@/api/repositories", () => repositoryMocks);
vi.mock("@/lib/auth", () => authMocks);
vi.mock("playwright", () => playwrightMocks);
vi.mock("@/lib/reports/fetch-parcel-report-data", () => fetchDataMocks);
vi.mock("@/lib/reports/parcel-pdf-template", () => templateMocks);

// Import DESPUÉS de los mocks (importante para que `vi.mock` intercepte).
import { GET as getReportRoute } from "@/app/api/parcels/[id]/report.pdf/route";
import { __setPlaywrightForTest } from "@/lib/reports/render-pdf";

// ============================================================
// Helpers
// ============================================================

function makeFakeParcelReportData(over: Partial<{
  id: number;
  land_name: string;
  external_id: string;
  field_type: string;
  spray_area_m2: number | null;
  declared_area_ha: number | null;
  crop_type: string | null;
  owner_name: string | null;
  supervisor_notes: string | null;
  cadence_status: "ok" | "due_soon" | "overdue" | "no_history";
  cadence_recommended: number | null;
  last_fumigation_date: string | null;
  next_due_date: string | null;
  events_count: number;
  total_area_ha: number;
  total_liters: number;
}> = {}) {
  return {
    operatorName: "AeroAdmin Cañero (Test)",
    operatorRegion: "Valle del Cauca, Colombia",
    generatedAt: "2026-07-23 14:30",
    parcel: {
      id: over.id ?? 42,
      external_id: over.external_id ?? "ext-42",
      land_name: over.land_name ?? "Parcela Test 42",
      field_type: over.field_type ?? "Farmland",
      declared_area_ha: over.declared_area_ha ?? 7.5,
      spray_area_m2: over.spray_area_m2 ?? 75_000,
      crop_type: over.crop_type ?? "Caña de azúcar",
      planting_date: "2025-08-01",
      owner_name: over.owner_name ?? "Don José Pérez",
      supervisor_notes: over.supervisor_notes ?? null
    },
    cadence: {
      recommended_cadence_days: over.cadence_recommended ?? 14,
      last_fumigation_date: over.last_fumigation_date ?? "2026-07-10",
      next_due_date: over.next_due_date ?? "2026-07-24",
      status: over.cadence_status ?? "ok"
    },
    window: { from: "2026-06-23", to: "2026-07-23" },
    events: Array.from({ length: over.events_count ?? 3 }, (_, i) => ({
      id: i + 1,
      fumigation_date: "2026-07-" + String(10 + i).padStart(2, "0"),
      product_used: "Glifosato",
      dose_l_per_ha: 1.5,
      area_fumigated_ha: 1.0 + i * 0.2,
      duration_minutes: 45 + i * 5,
      drone_nickname: "T40-01",
      pilot_name: "Juan Pérez",
      recorded_by: "operator",
      notes: null
    })),
    totals: {
      count: over.events_count ?? 3,
      totalAreaHa: over.total_area_ha ?? 3.6,
      totalLiters: over.total_liters ?? 5.4,
      averageAreaHa: 1.2,
      lastFumigationDate: "2026-07-12",
      capReached: false
    },
    coverage: {
      areaFumigableHa: 7.5,
      areaFumigadaHa: over.total_area_ha ?? 3.6,
      coveragePct: 48.0
    }
  };
}

// ============================================================
// Setup
// ============================================================

beforeEach(() => {
  vi.clearAllMocks();
  // Default: hay sesión válida.
  authMocks.requireAuth.mockResolvedValue({
    user: { id: "1", email: "admin@test", role: "admin" }
  });
  // Default: la data de la parcela está disponible.
  fetchDataMocks.getParcelReportData.mockResolvedValue(makeFakeParcelReportData());
  // Default: el template devuelve un HTML reconocible.
  templateMocks.buildParcelReportHtml.mockReturnValue(
    "<!DOCTYPE html><html><body>FAKE_HTML_PARCELa_42_OPERATOR_AeroAdmin Cañero (Test)_cadence_ok</body></html>"
  );
  // Importante: `vi.mock("playwright", ...)` no intercepta el
  // `require("playwright")` lazy dentro de `lib/reports/render-pdf.ts`
  // (vitest mockea ES module imports, no CJS require en runtime).
  // Inyectamos el módulo mockeado a mano vía el helper de test.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __setPlaywrightForTest(playwrightMocks as any);
  // Reseteamos los call counts de Playwright (importante: el browser es
  // singleton, queremos asserts limpios).
  playwrightMocks._pdf.mockClear();
  playwrightMocks._setContent.mockClear();
});

// ============================================================
// 401 — sin sesión
// ============================================================

describe("GET /api/parcels/[id]/report.pdf", () => {
  it("401 sin sesión", async () => {
    authMocks.requireAuth.mockRejectedValueOnce(
      Object.assign(new Error("UNAUTHENTICATED"), { status: 401, code: "UNAUTHENTICATED" })
    );
    const response = await getReportRoute(
      new NextRequest("http://localhost:3000/api/parcels/42/report.pdf"),
      { params: Promise.resolve({ id: "42" }) }
    );
    expect(response.status).toBe(401);
    expect(playwrightMocks._setContent).not.toHaveBeenCalled();
  });

  // ============================================================
  // 400 — input inválido
  // ============================================================

  it("400 con parcelId no numérico", async () => {
    const response = await getReportRoute(
      new NextRequest("http://localhost:3000/api/parcels/abc/report.pdf"),
      { params: Promise.resolve({ id: "abc" }) }
    );
    expect(response.status).toBe(400);
    expect(fetchDataMocks.getParcelReportData).not.toHaveBeenCalled();
    expect(playwrightMocks._setContent).not.toHaveBeenCalled();
  });

  it("400 con parcelId <= 0", async () => {
    const response = await getReportRoute(
      new NextRequest("http://localhost:3000/api/parcels/0/report.pdf"),
      { params: Promise.resolve({ id: "0" }) }
    );
    expect(response.status).toBe(400);
  });

  // ============================================================
  // 404 — parcela no existe
  // ============================================================

  it("404 si la parcela no existe o está soft-deleted", async () => {
    fetchDataMocks.getParcelReportData.mockResolvedValueOnce(null);
    const response = await getReportRoute(
      new NextRequest("http://localhost:3000/api/parcels/9999/report.pdf"),
      { params: Promise.resolve({ id: "9999" }) }
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toMatch(/Parcel not found/);
    expect(playwrightMocks._setContent).not.toHaveBeenCalled();
  });

  // ============================================================
  // 200 — happy path
  // ============================================================

  it("200 devuelve PDF con Content-Type application/pdf y buffer con bytes válidos", async () => {
    const response = await getReportRoute(
      new NextRequest("http://localhost:3000/api/parcels/42/report.pdf"),
      { params: Promise.resolve({ id: "42" }) }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    const contentLength = Number(response.headers.get("Content-Length"));
    expect(contentLength).toBeGreaterThan(20);

    const buf = Buffer.from(await response.arrayBuffer());
    // Header %PDF es obligatorio en cualquier PDF válido.
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // Content-Disposition con filename slug + fecha.
    const disposition = response.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(/inline/);
    expect(disposition).toMatch(/filename="reporte_parcela-test-42_\d{4}-\d{2}-\d{2}\.pdf"/);
  });

  it("llama a buildParcelReportHtml con la data correcta y pasa el HTML a Playwright", async () => {
    const customData = makeFakeParcelReportData({
      id: 99,
      land_name: "Lote Norte XYZ",
      external_id: "ext-99",
      cadence_status: "overdue",
      events_count: 5
    });
    fetchDataMocks.getParcelReportData.mockResolvedValueOnce(customData);
    // Hacemos que el template devuelva un HTML que incluye el id de la parcela,
    // para verificar que el handler le pasa la data correcta.
    templateMocks.buildParcelReportHtml.mockImplementationOnce(
      (data: { parcel: { id: number; land_name: string | null } }) =>
        `<!DOCTYPE html><html><body>Parcela #${data.parcel.id}: ${data.parcel.land_name ?? ""}</body></html>`
    );

    const response = await getReportRoute(
      new NextRequest("http://localhost:3000/api/parcels/99/report.pdf"),
      { params: Promise.resolve({ id: "99" }) }
    );
    expect(response.status).toBe(200);

    // El template se llamó UNA vez con la data de la parcela 99.
    expect(templateMocks.buildParcelReportHtml).toHaveBeenCalledTimes(1);
    const calledWith = templateMocks.buildParcelReportHtml.mock.calls[0]?.[0] as
      | { parcel: { id: number; land_name: string | null } }
      | undefined;
    expect(calledWith?.parcel.id).toBe(99);
    expect(calledWith?.parcel.land_name).toBe("Lote Norte XYZ");

    // Playwright recibió el HTML generado por el template.
    expect(playwrightMocks._setContent).toHaveBeenCalledTimes(1);
    const htmlArg = playwrightMocks._setContent.mock.calls[0]?.[0] as string;
    expect(htmlArg).toContain("Parcela #99");
    expect(htmlArg).toContain("Lote Norte XYZ");

    // Playwright generó el PDF con el formato A4 + printBackground.
    expect(playwrightMocks._pdf).toHaveBeenCalledTimes(1);
    const pdfOpts = playwrightMocks._pdf.mock.calls[0]?.[0] as
      | { format?: string; printBackground?: boolean }
      | undefined;
    expect(pdfOpts?.format).toBe("A4");
    expect(pdfOpts?.printBackground).toBe(true);
  });

  it("lanza 500 si Playwright crashea", async () => {
    playwrightMocks._setContent.mockRejectedValueOnce(new Error("chromium not found"));
    const response = await getReportRoute(
      new NextRequest("http://localhost:3000/api/parcels/42/report.pdf"),
      { params: Promise.resolve({ id: "42" }) }
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toMatch(/chromium not found/);
  });

  it("lanza 500 si la query a la BD falla", async () => {
    fetchDataMocks.getParcelReportData.mockRejectedValueOnce(new Error("connection refused"));
    const response = await getReportRoute(
      new NextRequest("http://localhost:3000/api/parcels/42/report.pdf"),
      { params: Promise.resolve({ id: "42" }) }
    );
    expect(response.status).toBe(500);
    expect(playwrightMocks._setContent).not.toHaveBeenCalled();
  });
});
