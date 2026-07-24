// Tests de los 4 repos nuevos de Sprint G2.
// Mockeamos @/lib/db para no depender de la DB real ni del .env.local.
// Esto prueba que el SQL es correcto Y que el mapeo de rows funciona,
// sin acoplarse al state de la DB sembrada.

import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({ query: (...args: unknown[]) => queryMock(...args) })
}));

import {
  getFumigationFlightTrace,
  getFumigationYearlySummary,
  getFumigationYearTotals,
  getScheduleHistory
} from "@/api/repositories";

const PARCEL_ID = 904;
const YEAR = 2026;

describe("Sprint G2 — repos de hoja de vida (mocked DB)", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  describe("getFumigationYearlySummary", () => {
    it("devuelve 12 rows (uno por mes) incluso si la DB solo tiene algunos meses", async () => {
      // Solo marzo tiene fumigaciones. Mock en orden 1-12 (lo que devuelve
      // el query real con generate_series + ORDER BY m.month).
      queryMock.mockResolvedValueOnce({
        rows: [
          { month: 1, count: "0", area_total_m2: "0", litros_total: "0" },
          { month: 2, count: "0", area_total_m2: "0", litros_total: "0" },
          { month: 3, count: "5", area_total_m2: "50000", litros_total: "12.5" },
          { month: 4, count: "0", area_total_m2: "0", litros_total: "0" },
          { month: 5, count: "0", area_total_m2: "0", litros_total: "0" },
          { month: 6, count: "0", area_total_m2: "0", litros_total: "0" },
          { month: 7, count: "0", area_total_m2: "0", litros_total: "0" },
          { month: 8, count: "0", area_total_m2: "0", litros_total: "0" },
          { month: 9, count: "0", area_total_m2: "0", litros_total: "0" },
          { month: 10, count: "0", area_total_m2: "0", litros_total: "0" },
          { month: 11, count: "0", area_total_m2: "0", litros_total: "0" },
          { month: 12, count: "0", area_total_m2: "0", litros_total: "0" }
        ]
      });

      const summary = await getFumigationYearlySummary(PARCEL_ID, YEAR);
      expect(summary).toHaveLength(12);
      expect(summary[2].month).toBe(3);
      expect(summary[2].count).toBe(5);
      expect(summary[0].month).toBe(1);
      expect(summary[0].count).toBe(0);
    });

    it("query usa generate_series para garantizar 12 rows", async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });
      await getFumigationYearlySummary(PARCEL_ID, YEAR);
      const sql = queryMock.mock.calls[0][0];
      expect(sql).toMatch(/generate_series\(1, 12\)/);
      // Verifica que filtra por parcel_id y año
      expect(queryMock.mock.calls[0][1]).toEqual([PARCEL_ID, YEAR]);
    });
  });

  describe("getFumigationYearTotals", () => {
    it("devuelve totales del año con shape correcto", async () => {
      queryMock.mockResolvedValueOnce({
        rows: [
          { count: "14", area_total_m2: "87500", litros_total: "145.5", productos_unicos: "3" }
        ]
      });
      const totals = await getFumigationYearTotals(PARCEL_ID, YEAR);
      expect(totals).toEqual({
        year: YEAR,
        count: 14,
        area_total_m2: 87500,
        litros_total: 145.5,
        productos_unicos: 3
      });
    });

    it("año vacío devuelve ceros", async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ count: "0", area_total_m2: "0", litros_total: "0", productos_unicos: "0" }]
      });
      const totals = await getFumigationYearTotals(PARCEL_ID, 1995);
      expect(totals.count).toBe(0);
      expect(totals.area_total_m2).toBe(0);
      expect(totals.litros_total).toBe(0);
      expect(totals.productos_unicos).toBe(0);
    });
  });

  describe("getScheduleHistory", () => {
    it("devuelve history rows parseados correctamente", async () => {
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            id: "1",
            parcel_id: PARCEL_ID,
            old_cadence_days: 10,
            new_cadence_days: 14,
            old_crop_type: "Frutales",
            new_crop_type: "Caña de azúcar",
            changed_by: "admin@aeroadmin.local",
            reason: null,
            commit_sha: null,
            changed_at: new Date("2026-07-01T12:00:00Z")
          },
          {
            id: "2",
            parcel_id: PARCEL_ID,
            old_cadence_days: null,
            new_cadence_days: 10,
            old_crop_type: null,
            new_crop_type: "Frutales",
            changed_by: "backfill",
            reason: "backfill retrospectivo Sprint G2",
            commit_sha: "03461ea",
            changed_at: new Date("2026-06-18T15:50:09Z")
          }
        ]
      });
      const history = await getScheduleHistory(PARCEL_ID);
      expect(history).toHaveLength(2);
      expect(history[0].id).toBe(1);
      expect(history[0].old_cadence_days).toBe(10);
      expect(history[0].new_cadence_days).toBe(14);
      expect(history[0].changed_at).toBe("2026-07-01T12:00:00.000Z");
      expect(history[1].commit_sha).toBe("03461ea");
    });

    it("pasa el limit como segundo parámetro", async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });
      await getScheduleHistory(PARCEL_ID, 5);
      expect(queryMock.mock.calls[0][1]).toEqual([PARCEL_ID, 5]);
    });

    it("limit default 10 si no se pasa", async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });
      await getScheduleHistory(PARCEL_ID);
      expect(queryMock.mock.calls[0][1]).toEqual([PARCEL_ID, 10]);
    });
  });

  describe("getFumigationFlightTrace", () => {
    it("devuelve lista de flights parseados", async () => {
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 12345,
            start_at: new Date("2026-07-01T10:00:00Z"),
            end_at: new Date("2026-07-01T10:25:00Z"),
            drone_nickname: "Agras T40 #1",
            pilot_name: "Juan Pérez",
            area_m2: "5000",
            duration_seconds: 1500
          },
          {
            id: 12346,
            start_at: new Date("2026-07-01T10:30:00Z"),
            end_at: new Date("2026-07-01T10:55:00Z"),
            drone_nickname: "Agras T40 #1",
            pilot_name: "Juan Pérez",
            area_m2: "4500",
            duration_seconds: 1500
          }
        ]
      });
      const flights = await getFumigationFlightTrace(42);
      expect(flights).toHaveLength(2);
      expect(flights[0].id).toBe(12345);
      expect(flights[0].start_at).toBe("2026-07-01T10:00:00.000Z");
      expect(flights[0].area_m2).toBe(5000);
      expect(flights[0].duration_seconds).toBe(1500);
    });

    it("fumigación sin flight_ids devuelve []", async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });
      const flights = await getFumigationFlightTrace(42);
      expect(flights).toEqual([]);
    });

    it("query usa ANY() sobre flight_ids", async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });
      await getFumigationFlightTrace(42);
      const sql = queryMock.mock.calls[0][0];
      expect(sql).toMatch(/f\.id = ANY\(fum\.flight_ids\)/);
    });
  });
});
