// tests/api-dji-flights-search.test.ts
//
// Test unitario del route handler `GET /api/dji-flights/search`.
//
// Sprint S11+ Fase 2/5 — wizard de "Importar vuelo DJI".
//
// Cubre:
//   - **Auth**: sin sesión → 401, role insuficiente → 403
//   - **Path param**: parcelId faltante o inválido → 400
//   - **Query**: range de fechas opcional (default = últimos 30 días)
//   - **Success**: devuelve array de vuelos con shape estable
//   - **Límite**: max 50 resultados
//
// El endpoint es read-only y alimenta el `DjiFlightPicker` del step 0
// del wizard de nueva fumigación.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/db", () => ({
  getDb: () => ({ query: mockQuery })
}));

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args)
}));

const { GET } = await import("@/app/api/dji-flights/search/route");

const validFlights = [
  {
    id: 1,
    flight_id: 638640703,
    drone_serial: "R1272065674",
    drone_nickname: "Agras T40 / T50",
    pilot_name: "breiner pelaez",
    start_at: "2026-09-15T08:00:00.000Z",
    end_at: "2026-09-15T08:45:00.000Z",
    duration_seconds: 2700,
    area_m2: "12000.00",
    spray_usage_ml: 15000,
    lng: "-76.50",
    lat: "3.45"
  },
  {
    id: 2,
    flight_id: 638640800,
    drone_serial: "R1272065674",
    drone_nickname: "Agras T16 / T20",
    pilot_name: "breiner pelaez",
    start_at: "2026-09-10T09:00:00.000Z",
    end_at: "2026-09-10T09:30:00.000Z",
    duration_seconds: 1800,
    area_m2: "8500.00",
    spray_usage_ml: 10000,
    lng: "-76.51",
    lat: "3.46"
  }
];

function makeRequest(params: Record<string, string> = {}): Request {
  const qs = new URLSearchParams(params).toString();
  return new Request(`http://localhost/api/dji-flights/search${qs ? `?${qs}` : ""}`, {
    method: "GET"
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockRequireRole.mockReset();
  // Default: requireRole OK
  mockRequireRole.mockResolvedValue({ user: { id: 1, role: "admin" } });
  // Default: SELECT devuelve 2 flights
  mockQuery.mockResolvedValue({ rows: validFlights });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Auth
// ============================================================

describe("GET /api/dji-flights/search — Auth", () => {
  it("1. sin sesión → 401", async () => {
    mockRequireRole.mockRejectedValueOnce({ code: "UNAUTHENTICATED", message: "no auth" });
    const res = await GET(makeRequest({ parcelId: "42" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("2. role insuficiente → 403", async () => {
    mockRequireRole.mockRejectedValueOnce({ code: "FORBIDDEN", message: "forbidden" });
    const res = await GET(makeRequest({ parcelId: "42" }));
    expect(res.status).toBe(403);
  });
});

// ============================================================
// Path param validation
// ============================================================

describe("GET /api/dji-flights/search — params", () => {
  it("3. sin parcelId → 400", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/parcelId|parcela/i);
  });

  it("4. parcelId no numérico → 400", async () => {
    const res = await GET(makeRequest({ parcelId: "abc" }));
    expect(res.status).toBe(400);
  });

  it("5. parcelId <= 0 → 400", async () => {
    const res = await GET(makeRequest({ parcelId: "0" }));
    expect(res.status).toBe(400);
  });

  it("6. parcelId negativo → 400", async () => {
    const res = await GET(makeRequest({ parcelId: "-5" }));
    expect(res.status).toBe(400);
  });
});

// ============================================================
// Query
// ============================================================

describe("GET /api/dji-flights/search — query behavior", () => {
  it("7. sin dateFrom/dateTo: query con rango default (últimos 30 días)", async () => {
    const res = await GET(makeRequest({ parcelId: "42" }));
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalled();
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/start_at\s*>=\s*\$/);
  });

  it("8. con dateFrom + dateTo: usa los rangos provistos", async () => {
    const res = await GET(
      makeRequest({
        parcelId: "42",
        dateFrom: "2026-09-01",
        dateTo: "2026-09-30"
      })
    );
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/start_at\s*>=|start_at\s*>/);
  });

  it("9. limit > 50 → cap a 50", async () => {
    const res = await GET(makeRequest({ parcelId: "42", limit: "999" }));
    expect(res.status).toBe(200);
    const params = mockQuery.mock.calls[0][1] as unknown[];
    // El último param es el limit
    expect(params[params.length - 1]).toBe(50);
  });

  it("10. limit < 1 → cap a 1", async () => {
    const res = await GET(makeRequest({ parcelId: "42", limit: "0" }));
    expect(res.status).toBe(200);
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[params.length - 1]).toBe(1);
  });
});

// ============================================================
// Response shape
// ============================================================

describe("GET /api/dji-flights/search — response shape", () => {
  it("11. success: devuelve { flights: [...] } con shape estable (zod)", async () => {
    const res = await GET(makeRequest({ parcelId: "42" }));
    expect(res.status).toBe(200);
    // Sprint S11+ — usar zod para validar la shape completa.
    // Caza cambios accidentales de tipo/nombre de campo.
    const { djiFlightListResponseSchema } = await import("@/lib/api-schemas");
    const parsed = djiFlightListResponseSchema.parse(await res.json());
    expect(parsed.flights).toHaveLength(2);
    expect(parsed.flights[0].id).toBe(1);
    expect(parsed.flights[0].flight_id).toBe(638640703);
    expect(parsed.flights[0].drone_nickname).toBe("Agras T40 / T50");
    expect(parsed.flights[0].pilot_name).toBe("breiner pelaez");
    expect(parsed.flights[0].duration_seconds).toBe(2700);
    expect(parsed.flights[0].area_m2).toBe("12000.00");
    expect(parsed.flights[0].spray_usage_ml).toBe(15000);
  });

  it("12. parcelId NO se devuelve (información redundante, ya viene en el path)", async () => {
    const res = await GET(makeRequest({ parcelId: "42" }));
    expect(res.status).toBe(200);
    const { djiFlightListResponseSchema } = await import("@/lib/api-schemas");
    const parsed = djiFlightListResponseSchema.parse(await res.json());
    // parcel_id no se expone — el cliente ya sabe cuál parcela eligió
    expect((parsed.flights[0] as Record<string, unknown>).parcel_id).toBeUndefined();
  });

  it("13. error de DB → 500 con mensaje (zod error shape)", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection refused"));
    const res = await GET(makeRequest({ parcelId: "42" }));
    expect(res.status).toBe(500);
    const { errorResponseSchema } = await import("@/lib/api-schemas");
    const parsed = errorResponseSchema.parse(await res.json());
    expect(parsed.error).toMatch(/connection refused/);
  });
});
