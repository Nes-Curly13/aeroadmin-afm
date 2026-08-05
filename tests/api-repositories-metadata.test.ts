/**
 * tests/api-repositories-metadata.test.ts
 *
 * Test unitario de la función `getParcelsNormalizedMetadata` en
 * `api/repositories.ts`. Cubre:
 *   - Wrapper pasa page/limit al fetchParcelsMetadataNoCache
 *   - Devuelve la shape correcta (data/total/page/limit/totalPages)
 *
 * Por qué este test existe:
 *   Sprint S10 (2026-08-05) — fix unhandledRejection "items over 2MB can not
 *   be cached" en /parcelas + /geovisor. La función `getParcelsNormalizedMetadata`
 *   es el wrapper que `loadDataset` (en lib/data.ts) usa para traer las 1213
 *   parcelas en bulk sin waypoints. Si alguien la rompe y vuelve a usar
 *   `getParcelsNormalized` (con waypoints) para el bulk, /parcelas + /geovisor
 *   vuelven a 404.
 *
 * Mockeamos `getParcelsMetadataNoCache` para no tocar la BD.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const metadataNoCacheMock = vi.fn();

vi.mock("@/lib/cache", async () => {
  return {
    fetchParcelsMetadataNoCache: (...args: unknown[]) => metadataNoCacheMock(...args)
  };
});

import { getParcelsNormalizedMetadata } from "@/api/repositories";

beforeEach(() => {
  metadataNoCacheMock.mockReset();
});

describe("getParcelsNormalizedMetadata — bulk load sin waypoints", () => {
  it("pasa page y limit al wrapper fetchParcelsMetadataNoCache", async () => {
    metadataNoCacheMock.mockResolvedValueOnce({
      data: [{ id: 1, land_name: "P1" }],
      total: 1213,
      page: 2,
      limit: 500,
      totalPages: 3
    });
    await getParcelsNormalizedMetadata(2, 500);
    expect(metadataNoCacheMock).toHaveBeenCalledTimes(1);
    expect(metadataNoCacheMock).toHaveBeenCalledWith(2, 500);
  });

  it("defaults: page=1, limit=2000 si no se pasan args", async () => {
    metadataNoCacheMock.mockResolvedValueOnce({
      data: [],
      total: 0,
      page: 1,
      limit: 2000,
      totalPages: 0
    });
    await getParcelsNormalizedMetadata();
    expect(metadataNoCacheMock).toHaveBeenCalledWith(1, 2000);
  });

  it("devuelve la shape { data, total, page, limit, totalPages } sin transformar", async () => {
    const fake = {
      data: [{ id: 1 }, { id: 2 }, { id: 3 }],
      total: 1213,
      page: 1,
      limit: 2000,
      totalPages: 1
    };
    metadataNoCacheMock.mockResolvedValueOnce(fake);
    const r = await getParcelsNormalizedMetadata(1, 2000);
    expect(r).toEqual(fake);
    expect(r.data).toHaveLength(3);
    expect(r.total).toBe(1213);
  });

  it("no filtra — caller decide qué hacer con los datos (vs. getParcelsNormalized que filtra por DjiParcelsFilter)", async () => {
    // El wrapper de metadata NO soporta filters (es solo para el dataset
    // completo del geovisor/dashboard). Si alguien intenta pasar filter, lo
    // ignora silenciosamente. Este test documenta esa decisión.
    metadataNoCacheMock.mockResolvedValueOnce({
      data: [],
      total: 0,
      page: 1,
      limit: 2000,
      totalPages: 0
    });
    // @ts-expect-error: filter no es parte del contrato, pero queremos
    // asegurarnos de que se ignora si alguien lo pasa por error.
    await getParcelsNormalizedMetadata(1, 2000, { missingClientName: true });
    expect(metadataNoCacheMock).toHaveBeenCalledWith(1, 2000);
  });
});
