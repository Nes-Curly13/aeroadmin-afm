// tests/api-auth-zod-validation.test.ts
//
// Tests de integración: endpoints auth-gated con validación zod del body.
//
// Sprint S11+ — Quality Gauntlet (compuerta 4: zod para testeo de bugs).
//
// Estos tests SON el patrón que habría detectado Bug 2 (el agujero
// de auth en /geovisor). Patrón:
//   1. Mockear requireRole para tirar UNAUTHENTICATED (simula "no
//      hay sesión")
//   2. Llamar el handler
//   3. Assert: status es 401
//   4. Assert: body shape matchea errorResponseSchema con zod
//
// Si una API route cambia su comportamiento a "retorna 200 con shape
// distinto cuando no hay sesion" (el bug del Bug 2 era conceptualmente
// similar), el status check falla Y el zod parse() falla con detalle
// del path roto.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { errorResponseSchema } from "@/lib/api-schemas";

const mockQuery = vi.fn();
vi.mock("@/lib/db", () => ({
  getDb: () => ({ query: mockQuery })
}));

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args)
}));

// Importar handlers DESPUÉS de los mocks para que tomen los mocks
const { GET: djiFlightsGET } = await import("@/app/api/dji-flights/search/route");
const { GET: dataQualityGET } = await import(
  "@/app/api/data-quality/invariants/route"
);
const { GET: parcelsSearchGET } = await import(
  "@/app/api/admin/parcels/search/route"
);
const { POST: cyclesBackfillPOST } = await import(
  "@/app/api/admin/cycles/backfill/route"
);

function makeRequest(url: string, method: "GET" | "POST" = "GET"): Request {
  return new Request(`http://localhost${url}`, { method });
}

beforeEach(() => {
  mockRequireRole.mockReset();
  mockQuery.mockReset();
});

describe("auth-gated endpoints — zod error shape (anti-Bug-2)", () => {
  it("1. /api/dji-flights/search sin sesion → 401 con body zod-valid", async () => {
    mockRequireRole.mockRejectedValueOnce({
      code: "UNAUTHENTICATED",
      message: "no auth"
    });
    const res = await djiFlightsGET(
      makeRequest("/api/dji-flights/search?parcelId=42") as unknown as import(
        "next/server"
      ).NextRequest
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    // zod parse — falla si body.error no es string
    const parsed = errorResponseSchema.parse(body);
    expect(typeof parsed.error).toBe("string");
    expect(parsed.error.length).toBeGreaterThan(0);
  });

  it("2. /api/dji-flights/search con role insuficiente → 403 con body zod-valid", async () => {
    mockRequireRole.mockRejectedValueOnce({
      code: "FORBIDDEN",
      message: "forbidden"
    });
    const res = await djiFlightsGET(
      makeRequest("/api/dji-flights/search?parcelId=42") as unknown as import(
        "next/server"
      ).NextRequest
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    const parsed = errorResponseSchema.parse(body);
    expect(parsed.error).toBeDefined();
  });

  it("3. /api/data-quality/invariants sin sesion → 401 con body zod-valid", async () => {
    mockRequireRole.mockRejectedValueOnce({
      code: "UNAUTHENTICATED",
      message: "no auth"
    });
    const res = await dataQualityGET(
      makeRequest("/api/data-quality/invariants") as unknown as import(
        "next/server"
      ).NextRequest
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    const parsed = errorResponseSchema.parse(body);
    expect(parsed.error).toBeDefined();
  });

  it("4. /api/admin/parcels/search sin sesion → 401 con body zod-valid", async () => {
    mockRequireRole.mockRejectedValueOnce({
      code: "UNAUTHENTICATED",
      message: "no auth"
    });
    const res = await parcelsSearchGET(
      makeRequest("/api/admin/parcels/search?q=test") as unknown as import(
        "next/server"
      ).NextRequest
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    const parsed = errorResponseSchema.parse(body);
    expect(parsed.error).toBeDefined();
  });

  it("5. /api/admin/cycles/backfill sin sesion → 401 con body zod-valid", async () => {
    mockRequireRole.mockRejectedValueOnce({
      code: "UNAUTHENTICATED",
      message: "no auth"
    });
    const res = await cyclesBackfillPOST(
      makeRequest("/api/admin/cycles/backfill", "POST") as unknown as import(
        "next/server"
      ).NextRequest
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    const parsed = errorResponseSchema.parse(body);
    expect(parsed.error).toBeDefined();
  });
});
