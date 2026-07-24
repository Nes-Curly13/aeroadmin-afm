// Tests para lib/scraper-meta.ts — parseScraperAggrMeta
//
// Sprint H2 — Helper que parsea el `notes` JSON de fumigaciones
// huérfanas (formato `djiscraper-aggr-by-day`) y expone los campos
// operativos: `sortieCount`, `sprayUsageMl`, `workTimeHours`.

import { describe, expect, it } from "vitest";

import { parseScraperAggrMeta } from "@/lib/scraper-meta";

describe("parseScraperAggrMeta", () => {
  it("devuelve null si notes es null", () => {
    expect(parseScraperAggrMeta(null)).toBeNull();
  });

  it("devuelve null si notes es undefined", () => {
    expect(parseScraperAggrMeta(undefined)).toBeNull();
  });

  it("devuelve null si notes es string no-JSON", () => {
    expect(parseScraperAggrMeta("not json")).toBeNull();
  });

  it("devuelve null si notes es string JSON vacío", () => {
    expect(parseScraperAggrMeta("{}")).toBeNull();
  });

  it("devuelve null si source no es 'djiscraper-aggr-by-day'", () => {
    // Formato del backfill per-parcel (Sprint G2)
    const backfillNotes = JSON.stringify({
      source: "import",
      backfilled_from: "dji_flights",
      flights_count: 12,
      spray_usage_ml: 12345
    });
    expect(parseScraperAggrMeta(backfillNotes)).toBeNull();
  });

  it("devuelve null si source es djiscraper-aggr-by-day pero faltan campos requeridos", () => {
    const incomplete = JSON.stringify({
      source: "djiscraper-aggr-by-day",
      sortieCount: 50
      // falta sprayUsageMl y workTimeSec
    });
    expect(parseScraperAggrMeta(incomplete)).toBeNull();
  });

  it("parsea notes string con todos los campos", () => {
    const notes = JSON.stringify({
      source: "djiscraper-aggr-by-day",
      sortieCount: 103,
      sprayUsageMl: 1111792,
      workTimeSec: 30327194,
      createTimestamp: 1782968400
    });
    expect(parseScraperAggrMeta(notes)).toEqual({
      sortieCount: 103,
      sprayUsageMl: 1111792,
      workTimeHours: "8424.2" // 30327194 / 3600 = 8424.221... → 1 decimal
    });
  });

  it("parsea notes que ya es objeto (no string)", () => {
    const obj = {
      source: "djiscraper-aggr-by-day",
      sortieCount: 73,
      sprayUsageMl: 934384,
      workTimeSec: 25390593
    };
    expect(parseScraperAggrMeta(obj)).toEqual({
      sortieCount: 73,
      sprayUsageMl: 934384,
      workTimeHours: "7052.9" // 25390593 / 3600 = 7052.94...
    });
  });

  it("workTimeHours redondea a 1 decimal", () => {
    const notes = JSON.stringify({
      source: "djiscraper-aggr-by-day",
      sortieCount: 1,
      sprayUsageMl: 1,
      workTimeSec: 3601 // 1.0003 horas → "1.0"
    });
    expect(parseScraperAggrMeta(notes)?.workTimeHours).toBe("1.0");
  });

  it("workTimeHours 0 → '0.0'", () => {
    const notes = JSON.stringify({
      source: "djiscraper-aggr-by-day",
      sortieCount: 0,
      sprayUsageMl: 0,
      workTimeSec: 0
    });
    expect(parseScraperAggrMeta(notes)?.workTimeHours).toBe("0.0");
  });

  it("acepta campos numéricos como string (algunos serializadores)", () => {
    // Si la BD serializó los números como string por algún path
    // (poco probable, pero defensa), los parseamos igual.
    const notes = JSON.stringify({
      source: "djiscraper-aggr-by-day",
      sortieCount: "10",
      sprayUsageMl: "1000",
      workTimeSec: "3600"
    });
    expect(parseScraperAggrMeta(notes)).toEqual({
      sortieCount: 10,
      sprayUsageMl: 1000,
      workTimeHours: "1.0"
    });
  });

  it("devuelve null si los campos numéricos no son parseables", () => {
    const notes = JSON.stringify({
      source: "djiscraper-aggr-by-day",
      sortieCount: "abc",
      sprayUsageMl: 1000,
      workTimeSec: 3600
    });
    expect(parseScraperAggrMeta(notes)).toBeNull();
  });
});
