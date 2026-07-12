// tests/api-task-history.test.ts
//
// Tests para GET /api/task-history (Figma frame B).
//
// Cubre:
//   - Validación de query params (from, to, parcelId, droneSerial, pilot)
//   - Defaults (ventana 6 meses)
//   - Shape de respuesta: { totals, days, polygons, dateRange }
//   - Source-of-truth behavior:
//     * Sin filtros de vuelo → lee de `dji_daily_summaries` (spec)
//     * Con filtros de vuelo → re-agrega desde `dji_flights`
//     * Si `dji_daily_summaries` no existe → fallback a `dji_flights`
//   - Filtros pasados al agregador de flights y al spatial aggregator
//   - Manejo de errores (400 fecha inválida, 500 DB fail)

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock del pool de Postgres (mismo patrón que tests/djiag-spatial-aggregator.test.ts)
const dbMock = vi.hoisted(() => ({
  query: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  getDb: () => dbMock
}));

import { GET as getTaskHistory } from "@/app/api/task-history/route";

interface DailySummaryRow {
  summary_date: Date;
  area_mu: number;
  times: number;
  liters: number;
  duration_seconds: number;
}

function dailySummaryFactory(over: Partial<DailySummaryRow> & { summary_date: Date }): DailySummaryRow {
  return {
    area_mu: 18.29,
    times: 22,
    liters: 365.2,
    duration_seconds: 6293,
    ...over
  };
}

interface FlightDbRow {
  id: number;
  flight_id: number;
  start_at: Date;
  duration_seconds: number;
  area_m2: number | null;
  spray_usage_ml: number | null;
}

function flightFactory(over: Partial<FlightDbRow> & { start_at: Date }): FlightDbRow {
  return {
    id: 1,
    flight_id: 100,
    duration_seconds: 3600,
    area_m2: 12000,
    spray_usage_ml: 200_000,
    ...over
  };
}

/** Construye un error 42P01 ("relation does not exist") como el que
 *  emite `pg` cuando una tabla no existe. */
function makeUndefinedTableError(tableName: string) {
  const err = new Error(`relation "${tableName}" does not exist`) as Error & { code?: string };
  err.code = "42P01";
  return err;
}

describe("GET /api/task-history", () => {
  beforeEach(() => {
    dbMock.query.mockReset();
  });

  // ============================================================
  // Source-of-truth: dji_daily_summaries (spec, fast path)
  // ============================================================
  describe("dji_daily_summaries (fast path, sin filtros de vuelo)", () => {
    it("devuelve shape completo con totals, days, polygons, dateRange", async () => {
      // 1) Query de dji_daily_summaries (rango 2026-07-01 a 2026-07-31)
      dbMock.query.mockResolvedValueOnce({
        rows: [
          dailySummaryFactory({
            summary_date: new Date("2026-07-08T00:00:00Z"),
            area_mu: 18.29,
            times: 22,
            liters: 365.2,
            duration_seconds: 6293
          })
        ]
      });
      // 2) Query del spatial aggregator (INNER JOIN con dji_flights)
      dbMock.query.mockResolvedValueOnce({
        rows: [
          {
            parcel_id: 1,
            land_name: "Parcela A",
            declared_area_ha: 7.75,
            geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
            dates_fumigated: ["2026-07-08"]
          }
        ]
      });

      const response = await getTaskHistory(
        new NextRequest("http://localhost:3000/api/task-history?from=2026-07-01&to=2026-07-31")
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        totals: expect.objectContaining({
          areaMu: expect.any(Number),
          times: expect.any(Number),
          liters: expect.any(Number),
          duration: expect.objectContaining({ djiFormat: expect.any(String) })
        }),
        days: expect.any(Array),
        polygons: expect.any(Array),
        dateRange: { from: "2026-07-01", to: "2026-07-31" }
      });
      expect(body.days).toHaveLength(1);
      expect(body.polygons).toHaveLength(1);
      expect(body.polygons[0]).toEqual({
        parcelId: 1,
        landName: "Parcela A",
        areaHa: 7.75,
        datesFumigated: ["2026-07-08"]
      });
    });

    it("el SQL de days apunta a dji_daily_summaries (no a dji_flights)", async () => {
      dbMock.query.mockResolvedValueOnce({ rows: [] });
      dbMock.query.mockResolvedValueOnce({ rows: [] });

      await getTaskHistory(
        new NextRequest("http://localhost:3000/api/task-history?from=2026-07-01&to=2026-07-31")
      );

      const firstSql = dbMock.query.mock.calls[0][0] as string;
      expect(firstSql).toContain("FROM dji_daily_summaries");
      expect(firstSql).not.toContain("FROM dji_flights");
    });

    it("days viene ordenado DESC (más reciente primero) desde summary", async () => {
      dbMock.query.mockResolvedValueOnce({
        rows: [
          dailySummaryFactory({
            summary_date: new Date("2026-07-08T00:00:00Z"),
            times: 22,
            liters: 365.2,
            duration_seconds: 6293
          }),
          dailySummaryFactory({
            summary_date: new Date("2026-07-07T00:00:00Z"),
            times: 27,
            liters: 416.9,
            duration_seconds: 6213
          })
        ]
      });
      dbMock.query.mockResolvedValueOnce({ rows: [] });

      const response = await getTaskHistory(
        new NextRequest("http://localhost:3000/api/task-history?from=2026-07-01&to=2026-07-31")
      );
      const body = await response.json();
      expect(body.days).toHaveLength(2);
      // 2026-07-08 antes de 2026-07-07
      expect(body.days[0].date).toBe("2026/07/08");
      expect(body.days[1].date).toBe("2026/07/07");
      expect(body.totals.times).toBe(49);
      expect(body.totals.liters).toBeCloseTo(782.1, 1);
    });

    it("convierte mu → m² (area_mu * 666.67) antes de pasar a buildTaskHistorySnapshot", async () => {
      dbMock.query.mockResolvedValueOnce({
        rows: [
          dailySummaryFactory({
            summary_date: new Date("2026-07-08T00:00:00Z"),
            area_mu: 18.29,
            times: 1,
            liters: 100,
            duration_seconds: 3600
          })
        ]
      });
      dbMock.query.mockResolvedValueOnce({ rows: [] });

      const response = await getTaskHistory(
        new NextRequest("http://localhost:3000/api/task-history?from=2026-07-01&to=2026-07-31")
      );
      const body = await response.json();
      // 18.29 mu → 18.29 * 666.67 = 12193.4 m² → dayToCard → 18.29 mu
      expect(body.days[0].areaMu).toBeCloseTo(18.29, 1);
    });

    it("weekday en inglés para el día (Wednesday para 2026-07-08)", async () => {
      dbMock.query.mockResolvedValueOnce({
        rows: [
          dailySummaryFactory({
            summary_date: new Date("2026-07-08T00:00:00Z"),
            times: 1,
            liters: 100,
            duration_seconds: 3600
          })
        ]
      });
      dbMock.query.mockResolvedValueOnce({ rows: [] });

      const response = await getTaskHistory(
        new NextRequest("http://localhost:3000/api/task-history?from=2026-07-01&to=2026-07-31")
      );
      const body = await response.json();
      expect(body.days[0].weekday).toBe("Wednesday");
    });
  });

  // ============================================================
  // Fallback: tabla no existe → re-agrega desde dji_flights
  // ============================================================
  describe("fallback dji_daily_summaries → dji_flights", () => {
    it("si dji_daily_summaries no existe, fallback a dji_flights", async () => {
      // 1) Query a dji_daily_summaries → 42P01 (tabla no existe)
      dbMock.query.mockRejectedValueOnce(makeUndefinedTableError("dji_daily_summaries"));
      // 2) Query a dji_flights (fallback) → 2 flights
      dbMock.query.mockResolvedValueOnce({
        rows: [
          flightFactory({
            id: 1,
            start_at: new Date("2026-07-08T13:00:00Z"),
            duration_seconds: 6293,
            area_m2: 12193,
            spray_usage_ml: 365_200
          })
        ]
      });
      // 3) Query del spatial aggregator
      dbMock.query.mockResolvedValueOnce({ rows: [] });

      const response = await getTaskHistory(
        new NextRequest("http://localhost:3000/api/task-history?from=2026-07-01&to=2026-07-31")
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.days).toHaveLength(1);
      expect(body.days[0].times).toBe(1);
      expect(body.days[0].liters).toBeCloseTo(365.2, 1);

      // Verificar que el primer call fue al summary (que falló) y el segundo a flights
      expect(dbMock.query.mock.calls[0][0]).toContain("FROM dji_daily_summaries");
      expect(dbMock.query.mock.calls[1][0]).toContain("FROM dji_flights");
    });

    it("fallback usa el mismo rango de fechas que el summary habría usado", async () => {
      dbMock.query.mockRejectedValueOnce(makeUndefinedTableError("dji_daily_summaries"));
      dbMock.query.mockResolvedValueOnce({ rows: [] });
      dbMock.query.mockResolvedValueOnce({ rows: [] });

      await getTaskHistory(
        new NextRequest("http://localhost:3000/api/task-history?from=2026-07-01&to=2026-07-31")
      );

      const fallbackSql = dbMock.query.mock.calls[1][0] as string;
      const fallbackParams = dbMock.query.mock.calls[1][1] as unknown[];
      expect(fallbackSql).toContain("start_at >= $1::date");
      expect(fallbackSql).toContain("start_at <  ($2::date + INTERVAL '1 day')");
      expect(fallbackParams[0]).toBe("2026-07-01");
      expect(fallbackParams[1]).toBe("2026-07-31");
    });
  });

  // ============================================================
  // Filtros de vuelo: fuerzan el path por dji_flights
  // ============================================================
  describe("filtros de vuelo (parcelId/droneSerial/pilot)", () => {
    it("con parcelId, va directo a dji_flights (no consulta dji_daily_summaries)", async () => {
      dbMock.query.mockResolvedValueOnce({ rows: [] });
      dbMock.query.mockResolvedValueOnce({ rows: [] });

      await getTaskHistory(
        new NextRequest(
          "http://localhost:3000/api/task-history?from=2026-07-01&to=2026-07-31&parcelId=42"
        )
      );

      // Primer call: dji_flights (NO dji_daily_summaries)
      const firstSql = dbMock.query.mock.calls[0][0] as string;
      expect(firstSql).toContain("FROM dji_flights");
      expect(firstSql).toContain("parcel_id = $3");
      const firstParams = dbMock.query.mock.calls[0][1] as unknown[];
      expect(firstParams).toEqual(["2026-07-01", "2026-07-31", 42]);
    });

    it("pasa filtros parcelId/droneSerial/pilot al query de dji_flights", async () => {
      dbMock.query.mockResolvedValueOnce({ rows: [] });
      dbMock.query.mockResolvedValueOnce({ rows: [] });

      await getTaskHistory(
        new NextRequest(
          "http://localhost:3000/api/task-history?from=2026-07-01&to=2026-07-31&parcelId=42&droneSerial=R12&pilot=breiner"
        )
      );

      const flightsSql = dbMock.query.mock.calls[0][0] as string;
      const flightsParams = dbMock.query.mock.calls[0][1] as unknown[];
      expect(flightsSql).toContain("parcel_id = $3");
      expect(flightsSql).toContain("drone_serial = $4");
      expect(flightsSql).toContain("pilot_name = $5");
      expect(flightsParams).toEqual([
        "2026-07-01",
        "2026-07-31",
        42,
        "R12",
        "breiner"
      ]);
    });

    it("days agregado de flights (no de summary)", async () => {
      dbMock.query.mockResolvedValueOnce({
        rows: [
          flightFactory({
            id: 1,
            start_at: new Date("2026-07-08T13:00:00Z"),
            duration_seconds: 3600,
            area_m2: 12000,
            spray_usage_ml: 100_000
          }),
          flightFactory({
            id: 2,
            start_at: new Date("2026-07-08T16:00:00Z"),
            duration_seconds: 2693,
            area_m2: 12000,
            spray_usage_ml: 200_000
          })
        ]
      });
      dbMock.query.mockResolvedValueOnce({ rows: [] });

      const response = await getTaskHistory(
        new NextRequest(
          "http://localhost:3000/api/task-history?from=2026-07-01&to=2026-07-31&parcelId=42"
        )
      );
      const body = await response.json();
      expect(body.days).toHaveLength(1);
      expect(body.days[0].times).toBe(2);
      expect(body.days[0].liters).toBe(300);
      expect(body.days[0].duration.djiFormat).toBe("1Hour44min53s");
    });
  });

  // ============================================================
  // Validación de query params
  // ============================================================
  describe("validación de query params", () => {
    it("rechaza from inválido (400)", async () => {
      const response = await getTaskHistory(
        new NextRequest("http://localhost:3000/api/task-history?from=07/01/2026")
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "from: Date must be YYYY-MM-DD." });
    });

    it("rechaza to inválido (400)", async () => {
      const response = await getTaskHistory(
        new NextRequest("http://localhost:3000/api/task-history?to=not-a-date")
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "to: Date must be YYYY-MM-DD." });
    });

    it("rechaza fecha con calendar mismatch (ej: 2026-02-31) (400)", async () => {
      const response = await getTaskHistory(
        new NextRequest("http://localhost:3000/api/task-history?from=2026-02-31")
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "from: Invalid date (calendar mismatch)." });
    });

    it("rechaza from > to (400)", async () => {
      const response = await getTaskHistory(
        new NextRequest("http://localhost:3000/api/task-history?from=2026-07-31&to=2026-07-01")
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "from must be <= to." });
    });

    it("rechaza parcelId no numérico (400)", async () => {
      const response = await getTaskHistory(
        new NextRequest("http://localhost:3000/api/task-history?parcelId=abc")
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "parcelId must be a positive integer." });
    });

    it("rechaza parcelId negativo (400)", async () => {
      const response = await getTaskHistory(
        new NextRequest("http://localhost:3000/api/task-history?parcelId=-5")
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "parcelId must be a positive integer." });
    });

    it("acepta from vacío como default (no 400)", async () => {
      dbMock.query.mockResolvedValueOnce({ rows: [] });
      dbMock.query.mockResolvedValueOnce({ rows: [] });

      const response = await getTaskHistory(
        new NextRequest("http://localhost:3000/api/task-history?from=&to=2026-07-31")
      );
      expect(response.status).toBe(200);
    });
  });

  // ============================================================
  // Defaults + errores
  // ============================================================
  describe("defaults + errores", () => {
    it("sin query params usa defaults (6 meses)", async () => {
      dbMock.query.mockResolvedValueOnce({ rows: [] });
      dbMock.query.mockResolvedValueOnce({ rows: [] });

      const response = await getTaskHistory(
        new NextRequest("http://localhost:3000/api/task-history")
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      // to = hoy, from = hace 183 días
      const today = new Date().toISOString().slice(0, 10);
      expect(body.dateRange.to).toBe(today);
      const fromDate = new Date(body.dateRange.from);
      const toDate = new Date(body.dateRange.to);
      const daysDiff = Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
      expect(daysDiff).toBe(183);
    });

    it("devuelve 500 si la BD falla en el summary", async () => {
      // Distinto de 42P01 → propagar el error
      dbMock.query.mockRejectedValueOnce(new Error("connection lost"));

      const response = await getTaskHistory(
        new NextRequest("http://localhost:3000/api/task-history?from=2026-07-01&to=2026-07-31")
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "connection lost" });
    });

    it("devuelve 500 si el spatial aggregator falla", async () => {
      dbMock.query.mockResolvedValueOnce({ rows: [] });
      dbMock.query.mockRejectedValueOnce(new Error("ST_AsGeoJSON failed"));

      const response = await getTaskHistory(
        new NextRequest("http://localhost:3000/api/task-history?from=2026-07-01&to=2026-07-31")
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "ST_AsGeoJSON failed" });
    });
  });
});
