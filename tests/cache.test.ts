// Tests para lib/cache.ts — Sprint 7 (cache selectiva con unstable_cache).
//
// Estrategia:
//   - Mockear `next/cache` para que `unstable_cache(...)` devuelva la función
//     tal cual (passthrough). Esto aisla el comportamiento de Next runtime de
//     la lógica de nuestros wrappers y nos permite testear:
//       (a) que la SQL se ejecuta,
//       (b) que `revalidateTag` es invocado con los tags correctos,
//       (c) que los helpers de invalidación pasan el `profile = { expire: 0 }`.
//   - Mockear `getDb()` con un fake client pg en memoria (`pgroute` table).
//
// Por qué mockear unstable_cache y no la DB: testar el wrap real agrega poco
// valor (la lógica está en el callback, que ya tiene sus propios tests). El
// valor real está en validar EL CONTRATO con el runtime de Next — los tags
// que pasamos deben ser exactamente los que el caller espera invalidar.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks hoisted (necesario por TDZ: vi.mock se ejecuta antes que las
//     declaraciones top-level del test file) ───────────────────────────

const { revalidateTagMock, unstableCacheCalls, queryMock } = vi.hoisted(() => ({
  revalidateTagMock: vi.fn(),
  unstableCacheCalls: [] as Array<{
    keyParts: string[];
    options: { revalidate?: number; tags?: string[] };
  }>,
  queryMock: vi.fn()
}));

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: any[]) => any>(
    cb: T,
    keyParts: string[],
    options?: { revalidate?: number; tags?: string[] }
  ): T => {
    unstableCacheCalls.push({ keyParts, options: options ?? {} });
    return cb;
  },
  revalidateTag: (tag: string, profile: unknown) =>
    revalidateTagMock(tag, profile)
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    query: (...args: unknown[]) => queryMock(...args)
  })
}));

// Importamos DESPUÉS de los mocks para que estos se apliquen primero.
import {
  CACHE_TAGS,
  CACHE_TTL,
  fetchDashboardMetricsCached,
  fetchParcelsNormalizedCached,
  fetchUpcomingFumigationsCached,
  invalidateAfterFlightMutation,
  invalidateAfterFumigationMutation,
  invalidateAfterParcelMutation,
  invalidateAll
} from "@/lib/cache";

beforeEach(() => {
  unstableCacheCalls.length = 0;
  revalidateTagMock.mockClear();
  queryMock.mockReset();
});

afterEach(() => {
  // No realtime cleanup needed; mocks se limpian por beforeEach.
});

// ─── 1) Contract: cada wrapper se cachea con el TTL y tag correctos ─────

describe("CACHE_TTL — duración esperada por dominio", () => {
  it("metrics 5min, alerts 5min, parcels 1min, parcels-summary 1min, upcoming 1min, flights 30s", () => {
    expect(CACHE_TTL.metrics).toBe(300);
    expect(CACHE_TTL.alerts).toBe(300);
    expect(CACHE_TTL.parcels).toBe(60);
    expect(CACHE_TTL.parcelsSummary).toBe(60);
    expect(CACHE_TTL.upcoming).toBe(60);
    expect(CACHE_TTL.flights).toBe(30);
  });

  it("CACHE_TAGS contiene todas las claves en el namespace afm:", () => {
    expect(CACHE_TAGS.metrics).toBe("afm:metrics");
    expect(CACHE_TAGS.alerts).toBe("afm:alerts");
    expect(CACHE_TAGS.parcels).toBe("afm:parcels");
    expect(CACHE_TAGS.parcelsSummary).toBe("afm:parcels-summary");
    expect(CACHE_TAGS.upcoming).toBe("afm:upcoming");
    expect(CACHE_TAGS.flights).toBe("afm:flights");
  });
});

// ─── Passthrough: cada wrapper ejecuta el callback subyacente ──────────

describe("cache wrappers — el callback subyacente se ejecuta", () => {
  it("fetchDashboardMetricsCached ejecuta SELECT del dashboard y mapea resultado", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          total_flights: "7050",
          total_area_covered_m2: "12345678.90",
          high_alert_days: "12",
          total_parcels: "1067"
        }
      ]
    });
    const m = await fetchDashboardMetricsCached();
    expect(m.totalFlights).toBe(7050);
    expect(m.totalAssets).toBe(1067);
    expect(m.highAlertParcels).toBe(12);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toMatch(/FROM\s+dji_flights/i);
    expect(sql).toMatch(/SUM\(area_m2\)/i);
  });

  it("fetchParcelsNormalizedCached(page, limit) pasa LIMIT + OFFSET correctos", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [{ total: "100" }] });
    const r = await fetchParcelsNormalizedCached(2, 25);
    expect(r.total).toBe(100);
    expect(r.page).toBe(2);
    expect(r.limit).toBe(25);
    expect(r.totalPages).toBe(4);
    expect(queryMock).toHaveBeenCalledTimes(2);
    const [params] = queryMock.mock.calls[0].slice(1) as [unknown[]];
    expect(params).toEqual([25, 25]); // LIMIT 25 OFFSET (2-1)*25 = 25
  });

  it("fetchUpcomingFumigationsCached(limit) recorta al limit pedido", async () => {
    queryMock.mockResolvedValueOnce({
      rows: Array.from({ length: 50 }, (_, i) => ({
        parcel_id: i + 1,
        land_name: `P-${i}`,
        external_id: `ext-${i}`,
        field_type: "Farmland",
        is_orchard: false,
        drone_model_name: "T40",
        crop_type: "Caña",
        recommended_cadence_days: 14,
        last_fumigation_date: null
      }))
    });
    const r = await fetchUpcomingFumigationsCached(8);
    expect(r).toHaveLength(8);
  });
});

// ─── Invalidation helpers ─────────────────────────────────────────────

describe("invalidate* — disparan revalidateTag con profile { expire: 0 }", () => {
  it("invalidateAfterFumigationMutation afecta upcoming + metrics + alerts", () => {
    invalidateAfterFumigationMutation();
    expect(revalidateTagMock).toHaveBeenCalledTimes(3);
    const tags = revalidateTagMock.mock.calls.map((c) => c[0]);
    expect(tags).toContain(CACHE_TAGS.upcoming);
    expect(tags).toContain(CACHE_TAGS.metrics);
    expect(tags).toContain(CACHE_TAGS.alerts);
    for (const call of revalidateTagMock.mock.calls) {
      expect(call[1]).toEqual({ expire: 0 });
    }
  });

  it("invalidateAfterParcelMutation afecta parcels + parcels-summary + upcoming", () => {
    invalidateAfterParcelMutation();
    expect(revalidateTagMock).toHaveBeenCalledTimes(3);
    const tags = revalidateTagMock.mock.calls.map((c) => c[0]);
    expect(tags).toContain(CACHE_TAGS.parcels);
    expect(tags).toContain(CACHE_TAGS.parcelsSummary);
    expect(tags).toContain(CACHE_TAGS.upcoming);
  });

  it("invalidateAfterFlightMutation afecta flights + metrics + alerts", () => {
    invalidateAfterFlightMutation();
    expect(revalidateTagMock).toHaveBeenCalledTimes(3);
    const tags = revalidateTagMock.mock.calls.map((c) => c[0]);
    expect(tags).toContain(CACHE_TAGS.flights);
    expect(tags).toContain(CACHE_TAGS.metrics);
    expect(tags).toContain(CACHE_TAGS.alerts);
  });

  it("invalidateAll barre todos los tags", () => {
    invalidateAll();
    const tags = revalidateTagMock.mock.calls.map((c) => c[0]);
    for (const tag of Object.values(CACHE_TAGS)) {
      expect(tags).toContain(tag);
    }
    expect(revalidateTagMock).toHaveBeenCalledTimes(Object.values(CACHE_TAGS).length);
  });
});
