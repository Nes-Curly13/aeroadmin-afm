// tests/api-repositories-dashboard.test.ts
//
// Tests de getDashboardData — agregaciones SQL del dashboard.
// Refactor 2026-09-21: filtros por hacienda/dron/estado/búsqueda; KPIs con
// `spray_usage_total` (volumen), `coverage` (cobertura) y `por_revisar`;
// paneles por hacienda (reemplaza cliente). Mock de @/lib/db, cada query se
// matchea por substring único.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/lib/db";
import { getDashboardData } from "@/api/repositories";

type Row = Record<string, unknown>;

const query = vi.fn();

function installDb() {
  (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ query });
}

/** Handlers por substring SQL (más específico primero). */
function handlers(overrides: Record<string, Row[] | ((args: unknown[]) => Row[])> = {}) {
  const base: Record<string, Row[] | ((args: unknown[]) => Row[])> = {
    fum_cur: [
      {
        fum_cur: 120,
        parcels_cur: 40,
        ha_cur: 300.5,
        vol_cur: 900,
        cob_cur: 280.25,
        revisar_cur: 12,
        fum_prev: 100,
        parcels_prev: 35,
        ha_prev: 250,
        vol_prev: 800,
        cob_prev: 230
      }
    ],
    "FROM dji_parcels": [{ n: 1200 }],
    "FROM dji_flights": [{ cur: 80, prev: 60 }],
    "date_trunc($7": [
      { bucket: "2026-09-07", fumigaciones: 20, ha: 50 },
      { bucket: "2026-09-14", fumigaciones: 15, ha: 40 }
    ],
    "'Sin dron'": [
      { drone: "AFM T50-1", fumigaciones: 60, ha: 180 },
      { drone: "AFM T40 1", fumigaciones: 30, ha: 70 }
    ],
    fumigation_categories: [
      { slug: "herbicida", fumigaciones: 70, ha: 200 },
      { slug: "insecticida", fumigaciones: 20, ha: 60 }
    ],
    "'Sin hacienda'": [
      { farm_id: 9, farm_name: "La Esperanza", fumigaciones: 80, ha: 220, parcelas: 25 }
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

  it("mapea KPIs (volumen/cobertura/por_revisar), deltas y paneles", async () => {
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
    expect(d.kpis.volumen_l).toBe(900);
    expect(d.kpis.cobertura_ha).toBeCloseTo(280.25);
    expect(d.kpis.por_revisar).toBe(12);
    expect(d.kpis.parcelas_cubiertas).toBe(40);
    expect(d.kpis.parcelas_total).toBe(1200);
    expect(d.kpis.vuelos).toBe(80);
    expect(d.kpis.prev.fumigaciones).toBe(100);
    expect(d.kpis.prev.volumen_l).toBe(800);
    expect(d.kpis.prev.vuelos).toBe(60);

    expect(d.trend).toHaveLength(2);
    expect(d.trend[0]).toEqual({ bucket: "2026-09-07", fumigaciones: 20, ha: 50 });

    expect(d.fleet[0]).toEqual({ drone: "AFM T50-1", fumigaciones: 60, ha: 180 });
    expect(d.categories[0].slug).toBe("herbicida");
    expect(d.farms[0].farm_name).toBe("La Esperanza");

    expect(d.planCompliance).toEqual({ hechas: 6, planificadas: 3, canceladas: 1 });
  });

  it("pasa farmId/drone/estado/query como params (filtro)", async () => {
    wire(handlers());
    await getDashboardData({
      fromDate: "2026-08-01",
      toDate: "2026-09-15",
      clientId: null,
      farmId: 9,
      drone: "AFM T50-1",
      estado: "revisar",
      query: "ste"
    });
    const kpiCall = query.mock.calls.find(([sql]) => String(sql).includes("fum_cur"));
    expect(kpiCall?.[1]).toEqual([
      expect.any(String),
      "2026-09-15",
      9,
      "AFM T50-1",
      "revisar",
      "ste",
      "2026-08-01"
    ]);
  });

  it("histórico (fromDate null): prev en 0 y no rompe", async () => {
    wire(
      handlers({
        fum_cur: [
          {
            fum_cur: 500,
            parcels_cur: 300,
            ha_cur: 1000,
            vol_cur: 3000,
            cob_cur: 900,
            revisar_cur: 0,
            fum_prev: 0,
            parcels_prev: 0,
            ha_prev: 0,
            vol_prev: 0,
            cob_prev: 0
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
    expect(d.kpis.prev.cobertura_ha).toBe(0);
  });

  it("sin filas devuelve estructura vacía válida", async () => {
    wire(
      handlers({
        fum_cur: [
          {
            fum_cur: 0,
            parcels_cur: 0,
            ha_cur: 0,
            vol_cur: 0,
            cob_cur: 0,
            revisar_cur: 0,
            fum_prev: 0,
            parcels_prev: 0,
            ha_prev: 0,
            vol_prev: 0,
            cob_prev: 0
          }
        ],
        "FROM dji_parcels": [{ n: 0 }],
        "FROM dji_flights": [{ cur: 0, prev: 0 }],
        "date_trunc($7": [],
        "'Sin dron'": [],
        fumigation_categories: [],
        "'Sin hacienda'": [],
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
    expect(d.kpis.cobertura_ha).toBe(0);
    expect(d.trend).toEqual([]);
    expect(d.farms).toEqual([]);
    expect(d.planCompliance).toEqual({ hechas: 0, planificadas: 0, canceladas: 0 });
  });
});
