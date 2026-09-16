// tests/api-repositories-dashboard.test.ts
//
// Tests de getDashboardData â€” agregaciones SQL del dashboard (2026-09-15).
// Mock de @/lib/db con getDb; cada query se matchea por substring.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/lib/db";
import { getDashboardData } from "@/api/repositories";

type Row = Record<string, unknown>;

const query = vi.fn();

function installDb() {
  (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ query });
}

/** Handlers por substring SQL (mÃ¡s especÃ­fico primero). */
function handlers(overrides: Record<string, Row[] | ((args: unknown[]) => Row[])> = {}) {
  const base: Record<string, Row[] | ((args: unknown[]) => Row[])> = {
    "fum_cur": [
      {
        fum_cur: 120,
        parcels_cur: 40,
        ha_cur: 300.5,
        vol_cur: 900,
        dose_cur: 3,
        fum_prev: 100,
        parcels_prev: 35,
        ha_prev: 250,
        dose_prev: 2.5
      }
    ],
    "FROM dji_parcels": [{ n: 1200 }],
    "FROM dji_flights": [{ cur: 80, prev: 60 }],
    "date_trunc($5": [
      { bucket: "2026-09-07", fumigaciones: 20, ha: 50 },
      { bucket: "2026-09-14", fumigaciones: 15, ha: 40 }
    ],
    "COALESCE(f.drone_code_used": [
      { drone_code: 201, fumigaciones: 60, ha: 180 },
      { drone_code: 72, fumigaciones: 30, ha: 70 }
    ],
    "c.slug": [
      { slug: "herbicida", fumigaciones: 70, ha: 200 },
      { slug: "insecticida", fumigaciones: 20, ha: 60 }
    ],
    "p.client_name": [
      {
        client_id: 3,
        client_name: "Agro XYZ",
        fumigaciones: 80,
        ha: 220,
        parcelas: 25
      }
    ],
    "FROM fumigation_plans": [
      { status: "hecha", n: 6 },
      { status: "planificada", n: 3 },
      { status: "cancelada", n: 1 }
    ]
  };
  return { ...base, ...overrides };
}

function wire(h: Record<string, Row[] | ((args: unknown[]) => Row[])>) {
  const keys = Object.keys(h).sort((a, b) => b.length - a.length);
  query.mockImplementation(async (sql: string, args: unknown[]) => {
    for (const key of keys) {
      if (String(sql).includes(key)) {
        const v = h[key];
        return { rows: typeof v === "function" ? v(args) : v, rowCount: 1 };
      }
    }
    throw new Error(`No mock handler for: ${String(sql).slice(0, 70)}`);
  });
}

describe("getDashboardData", () => {
  beforeEach(() => {
    query.mockReset();
    installDb();
  });

  it("mapea KPIs, deltas de perÃ­odo previo y paneles", async () => {
    wire(handlers());
    const d = await getDashboardData({
      fromDate: "2026-08-01",
      toDate: "2026-09-15",
      clientId: null,
      farmId: null,
      grain: "week"
    });

    expect(d.kpis.fumigaciones).toBe(120);
    expect(d.kpis.hectareas).toBeCloseTo(300.5);
    expect(d.kpis.dosis_media).toBe(3);
    expect(d.kpis.parcelas_cubiertas).toBe(40);
    expect(d.kpis.parcelas_total).toBe(1200);
    expect(d.kpis.vuelos).toBe(80);
    expect(d.kpis.prev.fumigaciones).toBe(100);
    expect(d.kpis.prev.vuelos).toBe(60);

    expect(d.trend).toHaveLength(2);
    expect(d.trend[0]).toEqual({
      bucket: "2026-09-07",
      fumigaciones: 20,
      ha: 50
    });

    expect(d.fleet[0]).toEqual({ drone_code: 201, fumigaciones: 60, ha: 180 });
    expect(d.categories[0].slug).toBe("herbicida");
    expect(d.clients[0].client_name).toBe("Agro XYZ");

    expect(d.planCompliance).toEqual({
      hechas: 6,
      planificadas: 3,
      canceladas: 1
    });
  });

  it("pasa clientId/farmId como params (filtro)", async () => {
    wire(handlers());
    await getDashboardData({
      fromDate: "2026-08-01",
      toDate: "2026-09-15",
      clientId: 7,
      farmId: 9
    });
    const kpiCall = query.mock.calls.find(([sql]) => String(sql).includes("fum_cur"));
    expect(kpiCall?.[1]).toEqual([
      expect.any(String),
      "2026-09-15",
      7,
      9,
      "2026-08-01"
    ]);
  });

  it("histÃ³rico (fromDate null): prev queda en 0 y no rompe", async () => {
    wire(
      handlers({
        "fum_cur": [
          {
            fum_cur: 500,
            parcels_cur: 300,
            ha_cur: 1000,
            vol_cur: 3000,
            dose_cur: 3,
            fum_prev: 0,
            parcels_prev: 0,
            ha_prev: 0,
            dose_prev: null
          }
        ],
        "FROM dji_flights": [{ cur: 400, prev: 0 }]
      })
    );
    const d = await getDashboardData({
      fromDate: null,
      toDate: "2026-09-15",
      clientId: null,
      farmId: null
    });
    expect(d.kpis.fumigaciones).toBe(500);
    expect(d.kpis.prev.fumigaciones).toBe(0);
    expect(d.kpis.prev.dosis_media).toBeNull();
  });

  it("sin filas devuelve estructura vacÃ­a vÃ¡lida", async () => {
    wire(
      handlers({
        "fum_cur": [
          {
            fum_cur: 0,
            parcels_cur: 0,
            ha_cur: 0,
            vol_cur: 0,
            dose_cur: null,
            fum_prev: 0,
            parcels_prev: 0,
            ha_prev: 0,
            dose_prev: null
          }
        ],
        "FROM dji_parcels": [{ n: 0 }],
        "FROM dji_flights": [{ cur: 0, prev: 0 }],
        "date_trunc($5": [],
        "COALESCE(f.drone_code_used": [],
        "c.slug": [],
        "p.client_name": [],
        "FROM fumigation_plans": []
      })
    );
    const d = await getDashboardData({
      fromDate: "2026-09-01",
      toDate: "2026-09-15",
      clientId: null,
      farmId: null
    });
    expect(d.kpis.fumigaciones).toBe(0);
    expect(d.kpis.dosis_media).toBeNull();
    expect(d.trend).toEqual([]);
    expect(d.planCompliance).toEqual({
      hechas: 0,
      planificadas: 0,
      canceladas: 0
    });
  });
});
