/**
 * tests/lib-cache-alerts-fetch.test.ts
 *
 * Test unitario de la query SQL con GROUP BY en
 * `fetchAlertsFromFumigationsRaw` (Sprint Fase 2 / M1, 2026-08-23).
 *
 * El test verifica que la query:
 *   - Hace GROUP BY por (parcel_id, fumigation_date)
 *   - Devuelve buckets con area_m2, duration_minutes, times_count
 *   - Aplica COALESCE (0) a las sums (maneja rows con NULLs)
 *   - Ordena por area_m2 DESC
 *   - Filtra fumigaciones con parcel_id NULL y soft-deleted
 *   - Mapea a DjiAlertRecord con `buildAlertFromFumigation`
 *
 * Mockeamos `getDb` con un result fijo. Como la función es
 * `private` al módulo (no se exporta), mockeamos `unstable_cache`
 * y/o exponemos el path por el wrapper cacheado (`fetchAlertsCached`).
 *
 * En este test verificamos la SEMÁNTICA del wrapper cacheado
 * (que el grupo + map produce alertas correctas con la nueva SQL).
 */

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Mocks
// ============================================================

const mockQuery = vi.fn();

vi.mock("@/lib/db", () => {
  return {
    getDb: () => ({
      query: (...args: unknown[]) => mockQuery(...args)
    })
  };
});

// Mock unstable_cache de Next.js. El wrapper real requiere un
// `incrementalCache` que no existe en jsdom (lanza "Invariant:
// incrementalCache missing"). Lo mockeamos para que ejecute el
// callback directamente, sin cachear (los tests son deterministas
// gracias al mock de getDb).
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidateTag: vi.fn()
}));

beforeEach(() => {
  mockQuery.mockReset();
  // Default: 3 buckets, simulando la nueva SQL con GROUP BY
  mockQuery.mockResolvedValue({
    rows: [
      {
        parcel_id: 100,
        parcel_name: "Lote A",
        fumigation_date: "2026-08-15",
        area_m2: "50000",
        duration_minutes: "120",
        times_count: "3"
      },
      {
        parcel_id: 200,
        parcel_name: "Lote B",
        fumigation_date: "2026-08-14",
        area_m2: "20000",
        duration_minutes: "60",
        times_count: "1"
      },
      {
        parcel_id: 300,
        parcel_name: null,
        fumigation_date: "2026-08-13",
        area_m2: "0",
        duration_minutes: "0",
        times_count: "1"
      }
    ]
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Tests
// ============================================================

describe("fetchAlertsFromFumigationsRaw — M1 GROUP BY en SQL", () => {
  it("el query usa GROUP BY (parcel_id, fumigation_date)", async () => {
    // Forzamos la ejecución importando y llamando el wrapper cacheado.
    // Como unstable_cache memoriza por key, necesitamos invalidar.
    const { fetchAlertsCached } = await import("@/lib/cache");
    await fetchAlertsCached();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/GROUP BY\s+f\.parcel_id,\s*p\.land_name,\s*f\.fumigation_date/);
  });

  it("filtra fumigaciones con parcel_id NULL y soft-deleted", async () => {
    const { fetchAlertsCached } = await import("@/lib/cache");
    await fetchAlertsCached();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/f\.parcel_id IS NOT NULL/);
    expect(sql).toMatch(/f\.deleted_at IS NULL/);
    expect(sql).toMatch(/p\.deleted_at IS NULL/);
  });

  it("SUM de area_fumigated_m2 con COALESCE a 0", async () => {
    const { fetchAlertsCached } = await import("@/lib/cache");
    await fetchAlertsCached();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(SUM\(f\.area_fumigated_m2\),\s*0\)/);
  });

  it("SUM de duration_minutes con COALESCE a 0", async () => {
    const { fetchAlertsCached } = await import("@/lib/cache");
    await fetchAlertsCached();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(SUM\(f\.duration_minutes\),\s*0\)/);
  });

  it("COUNT(*) para times_count", async () => {
    const { fetchAlertsCached } = await import("@/lib/cache");
    await fetchAlertsCached();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/COUNT\(\*\)/);
  });

  it("mapea bucket a DjiAlertRecord via buildAlertFromFumigation", async () => {
    const { fetchAlertsCached } = await import("@/lib/cache");
    const alerts = await fetchAlertsCached();
    expect(alerts).toHaveLength(3);
    // Primer bucket: parcel_id=100, area_mu = 50000 / 666.6667 ≈ 75.0
    expect(alerts[0].parcel_id).toBe(100);
    expect(alerts[0].parcel_name).toBe("Lote A");
    expect(alerts[0].age_days).toBeGreaterThan(0);
    expect(alerts[0].level).toBeDefined();
    // Segundo: parcel_id=200
    expect(alerts[1].parcel_id).toBe(200);
    // Tercero: parcel_id=300, parcel_name null → fallback "Parcela #300"
    expect(alerts[2].parcel_id).toBe(300);
    expect(alerts[2].parcel_name).toBe("Parcela #300");
  });

  it("computa level con el threshold de getAlertLevelFromFumigations (60 mu / 30 mu)", async () => {
    const { fetchAlertsCached } = await import("@/lib/cache");
    const alerts = await fetchAlertsCached();
    // area_mu 75 → HIGH (>=60)
    expect(alerts[0].level).toBe("HIGH");
    // area_mu 30 → MEDIUM (>=30)
    expect(alerts[1].level).toBe("MEDIUM");
    // area_mu 0 → LOW (< 30 y < 60)
    expect(alerts[2].level).toBe("LOW");
  });

  it("resultados vacíos → devuelve [] (no null, no undefined)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { fetchAlertsCached } = await import("@/lib/cache");
    const alerts = await fetchAlertsCached();
    expect(alerts).toEqual([]);
  });

  it("el ORDER BY usa area_m2 DESC (los buckets más grandes primero)", async () => {
    const { fetchAlertsCached } = await import("@/lib/cache");
    await fetchAlertsCached();
    const [sql] = mockQuery.mock.calls[0];
    // Verificamos que el orden usa SUM(area_fumigated_m2) DESC.
    expect(sql).toMatch(/ORDER BY\s+\(COALESCE\(SUM\(f\.area_fumigated_m2\),\s*0\)\)\s+DESC/);
  });

  it("el wrapper cacheado usa el tag 'afm:alerts' (invalidación coherente)", async () => {
    const { fetchAlertsCached, CACHE_TAGS } = await import("@/lib/cache");
    // Inspeccionamos que la query SQL no esté repetida dentro del mismo render
    // (la cache de unstable_cache deduplica calls, pero acá el primer
    // call es el único que importa).
    await fetchAlertsCached();
    expect(CACHE_TAGS.alerts).toBe("afm:alerts");
    // Solo verificamos que el tag existe, no que se llame (eso es detalle
    // de implementación de unstable_cache).
  });
});
