// tests/api-fumigated-parcel-ids.test.ts
//
// Tests para getFumigatedParcelIdsSince (api/repositories.ts).
//
// Función nueva (M3-M5 Track A commit 2): devuelve el Set<number> de
// parcel_ids con al menos un evento de fumigación >= sinceDate.
// Se usa en app/map/page.tsx para derivar el flag hasFumigation por parcela
// y diferenciar visualmente fumigadas (solido) vs no fumigadas (dashed).
//
// Estrategia de test:
//   - Mockear getDb() con un fake pg client (mismo patrón que cache.test.ts).
//   - Validar que la SQL tiene los params correctos (since + parcel_id NOT NULL).
//   - Validar la conversion a Set<number>.

import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    query: (...args: unknown[]) => queryMock(...args)
  })
}));

import { getFumigatedParcelIdsSince } from "@/api/repositories";

describe("getFumigatedParcelIdsSince", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("devuelve Set<number> con los parcel_id distintos del query", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { parcel_id: 10 },
        { parcel_id: 20 },
        { parcel_id: 10 }, // dup (DISTINCT en la SQL)
        { parcel_id: 30 }
      ]
    });
    const set = await getFumigatedParcelIdsSince("2026-01-01");
    expect(set).toBeInstanceOf(Set);
    expect(set.size).toBe(3);
    expect(set.has(10)).toBe(true);
    expect(set.has(20)).toBe(true);
    expect(set.has(30)).toBe(true);
  });

  it("pasa la fecha 'since' como parametro $1 a la query", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await getFumigatedParcelIdsSince("2026-06-15");
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("fumigation_date");
    expect(sql).toContain("$1");
    expect(params).toEqual(["2026-06-15"]);
  });

  it("filtra parcel_id NULL en la SQL (no aparece en el resultado)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ parcel_id: 42 }] });
    const set = await getFumigatedParcelIdsSince("2026-01-01");
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toContain("parcel_id IS NOT NULL");
    expect(set.size).toBe(1);
    expect(set.has(42)).toBe(true);
  });

  it("devuelve Set vacio si la query no devuelve filas", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const set = await getFumigatedParcelIdsSince("2026-01-01");
    expect(set.size).toBe(0);
  });

  it("BD no disponible (query rechaza) => Set vacio (graceful fallback)", async () => {
    queryMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const set = await getFumigatedParcelIdsSince("2026-01-01");
    expect(set.size).toBe(0);
  });
});
