/**
 * tests/api-admin-parcels-import-preview.test.ts
 *
 * Unit tests del route handler POST /api/admin/parcels/import/preview.
 * Mockeamos el parser GIS (parseGisFile) y requireRole para no depender
 * de la BD ni de los parsers reales.
 *
 * Cubre:
 *   - Auth: sin sesión → 401, rol no-admin → 403
 *   - Sin file en multipart → 400
 *   - Parser tira → 400
 *   - Happy path: 200 con {features, warnings, format}
 */

// Usamos environment "node" para tener Request/FormData nativos de Node 22
// (jsdom tiene un polyfill parcial que rompe multipart/form-data).
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Mocks
// ============================================================

const mockParse = vi.fn();
vi.mock("@/lib/gis-import", () => ({
  parseGisFile: (...args: unknown[]) => mockParse(...args),
  approxAreaM2: () => 12_500
}));

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args)
}));

const { POST } = await import("@/app/api/admin/parcels/import/preview/route");

// ============================================================
// Helpers
// ============================================================

function makeFormDataWithFile(file: { name: string; type: string; content: string }) {
  const fd = new FormData();
  const blob = new Blob([file.content], { type: file.type });
  fd.append("file", blob, file.name);
  return fd;
}

function makeRequest(formData: FormData): Request {
  return new Request("http://localhost:3000/api/admin/parcels/import/preview", {
    method: "POST",
    body: formData
  });
}

// ============================================================
// Tests
// ============================================================

describe("POST /api/admin/parcels/import/preview", () => {
  beforeEach(() => {
    mockParse.mockReset();
    mockRequireRole.mockReset();
    mockRequireRole.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sin sesión → 401", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("UNAUTHENTICATED"), {
        code: "UNAUTHENTICATED"
      })
    );
    const req = makeRequest(makeFormDataWithFile({ name: "x.kml", type: "text/xml", content: "" }));
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(401);
  });

  it("rol no-admin → 403", async () => {
    mockRequireRole.mockRejectedValueOnce(
      Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" })
    );
    const req = makeRequest(makeFormDataWithFile({ name: "x.kml", type: "text/xml", content: "" }));
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(403);
  });

  it("multipart sin campo 'file' → 400", async () => {
    const fd = new FormData();
    const req = makeRequest(fd);
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/archivo/i);
  });

  it("parser tira error → 400 con mensaje del parser", async () => {
    mockParse.mockRejectedValueOnce(new Error("Shapefile zip inválido"));
    const req = makeRequest(makeFormDataWithFile({ name: "lotes.zip", type: "application/zip", content: "x" }));
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Shapefile zip inválido");
  });

  it("happy path: 200 con features + warnings + format", async () => {
    mockParse.mockResolvedValueOnce({
      format: "kml",
      warnings: ["Feature ignorado (Point)"],
      features: [
        {
          name: "Lote 1",
          properties: { name: "Lote 1" },
          geometry: {
            type: "Polygon",
            // Polígono chico (~100m × 100m cerca del ecuador → ~1 ha)
            coordinates: [
              [
                [-76.31, 3.45],
                [-76.309, 3.45],
                [-76.309, 3.451],
                [-76.31, 3.451],
                [-76.31, 3.45]
              ]
            ]
          }
        }
      ]
    });
    const req = makeRequest(makeFormDataWithFile({ name: "lotes.kml", type: "text/xml", content: "x" }));
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.format).toBe("kml");
    expect(body.features).toHaveLength(1);
    // approxAreaM2 viene del módulo real (no mockeado el sub-path) —
    // verificamos que el campo existe y es > 0.
    expect(body.features[0].approxAreaHa).toBeGreaterThan(0);
    expect(body.warnings).toContain("Feature ignorado (Point)");
  });
});
