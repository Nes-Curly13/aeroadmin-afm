// tests/api-admin-fumigations-report-csv.test.ts
//
// Test unitario del route handler `GET /api/admin/fumigations/[id]/report.csv`
// (feature/fumigacion-detail-v2 / sub-4).
//
// Cubre:
//   - 200 OK con Content-Type text/csv + Content-Disposition
//   - Body es CSV con BOM al inicio
//   - 401/403 según auth
//   - 404 si fumigación no existe
//   - 400 si id inválido
//   - Filename en Content-Disposition incluye el id
//   - Cache-Control: no-store
//
// Mocks: getFumigationById, getParcelById, getFumigationFlights,
//        droneModel (de lib/data), requireRole.

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

// Mockeamos @/lib/data porque el route handler importa `droneModel` de
// ahí, y @/lib/data arranca con `import "server-only"` (que rompe en
// el bundle de vitest). Re-exportamos droneModel como un mock que
// devuelve la estructura esperada.
vi.mock("@/lib/data", () => ({
  droneModel: (id: number) => ({
    id,
    name: "Agras T40",
    tank_l: 40
  })
}));

const { GET } = await import(
  "@/app/api/admin/fumigations/[id]/report.csv/route"
);

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
  // Defaults: auth OK, fumigación existe, parcela existe, sin flights.
  mockRequireRole.mockResolvedValue(undefined);
  mockGetFumigationById.mockResolvedValue(FUMIGATION);
  mockGetParcelById.mockResolvedValue(PARCEL);
  mockGetFumigationFlights.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Auth
// ============================================================

describe("GET /api/admin/fumigations/[id]/report.csv — auth", () => {
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

describe("GET .../report.csv — path param", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve 400 si el id no es numérico", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("abc"));
    expect(res.status).toBe(400);
  });

  it("devuelve 400 si el id es <= 0", async () => {
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

describe("GET .../report.csv — éxito", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("devuelve 200 con Content-Type text/csv", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  });

  it("devuelve CSV con BOM al inicio (bytes EFBBBF en el body)", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("1"));
    // Leemos los bytes crudos porque `.text()` puede normalizar el
    // BOM (UTF-8 BOM U+FEFF = EFBBBF en bytes). Verificamos contra
    // los bytes crudos para no depender de la normalización del runtime.
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
  });

  it("incluye Content-Disposition con filename basado en el id", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("42"));
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="/);
    expect(disposition).toMatch(/fumigacion-42\.csv"$/);
  });

  it("Cache-Control es no-store (no cachea el reporte)", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("1"));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("el body contiene secciones esperadas del CSV", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("1"));
    const text = await res.text();
    // El CSV incluye el id de la fumigación
    expect(text).toContain("ID fumigación;1");
    // Y la sección Vuelos
    expect(text).toContain("Sección;Vuelos asociados");
  });

  it("carga la fumigación por id (no hardcoded)", async () => {
    await GET(new Request("http://localhost/x"), makeCtx("42"));
    expect(mockGetFumigationById).toHaveBeenCalledWith(42);
  });

  it("carga la parcela y los flights en paralelo (Promise.all)", async () => {
    await GET(new Request("http://localhost/x"), makeCtx("1"));
    expect(mockGetParcelById).toHaveBeenCalledWith(42);
    expect(mockGetFumigationFlights).toHaveBeenCalled();
  });
});

// ============================================================
// Robustez: el repo tira → 500 con JSON (no HTML de Next).
// El try/catch se agregó en sub-4 para consistencia con el resto
// de los endpoints.
// ============================================================

describe("GET .../report.csv — errores de repo (manejados con 500 JSON)", () => {
  beforeEach(() => {
    mockRequireRole.mockResolvedValue(undefined);
  });

  it("getFumigationById rechaza → 500 con JSON (BD timeout)", async () => {
    mockGetFumigationById.mockRejectedValueOnce(new Error("BD timeout"));
    const res = await GET(new Request("http://localhost/x"), makeCtx("1"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("BD timeout");
  });
});
