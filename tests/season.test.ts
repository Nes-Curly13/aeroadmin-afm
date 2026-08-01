import { describe, expect, it } from "vitest";

import {
  cadenceMultiplierForSeason,
  getSeason
} from "@/lib/season";

// Coordenadas del centro del Valle del Cauca (Palmira / Candelaria).
// La firma de getSeason toma lat/lon para extensión futura; hoy no
// las usa, pero las pasamos igual para ejercitar la firma.
const VALLE_LAT = 3.45;
const VALLE_LON = -76.5;

describe("season — getSeason (Valle del Cauca)", () => {
  it("agosto → 'secas' (jun-sep)", () => {
    expect(getSeason(new Date("2026-08-15"), VALLE_LAT, VALLE_LON)).toBe("secas");
  });

  it("febrero → 'lluvias' (oct-may)", () => {
    expect(getSeason(new Date("2026-02-15"), VALLE_LAT, VALLE_LON)).toBe("lluvias");
  });

  it("diciembre → 'lluvias'", () => {
    expect(getSeason(new Date("2026-12-15"), VALLE_LAT, VALLE_LON)).toBe("lluvias");
  });

  it("junio 15 → 'secas' (boundary, inicio de secas)", () => {
    expect(getSeason(new Date("2026-06-15"), VALLE_LAT, VALLE_LON)).toBe("secas");
  });

  it("septiembre 30 → 'secas' (último día de secas)", () => {
    expect(getSeason(new Date("2026-09-30"), VALLE_LAT, VALLE_LON)).toBe("secas");
  });

  it("octubre 1 → 'lluvias' (boundary, inicio de lluvias)", () => {
    expect(getSeason(new Date("2026-10-01"), VALLE_LAT, VALLE_LON)).toBe("lluvias");
  });

  it("mayo 31 → 'lluvias' (último día de lluvias)", () => {
    expect(getSeason(new Date("2026-05-31"), VALLE_LAT, VALLE_LON)).toBe("lluvias");
  });

  it("julio → 'secas'", () => {
    expect(getSeason(new Date("2026-07-15"), VALLE_LAT, VALLE_LON)).toBe("secas");
  });

  it("noviembre → 'lluvias'", () => {
    expect(getSeason(new Date("2026-11-15"), VALLE_LAT, VALLE_LON)).toBe("lluvias");
  });

  it("abril → 'lluvias'", () => {
    expect(getSeason(new Date("2026-04-15"), VALLE_LAT, VALLE_LON)).toBe("lluvias");
  });
});

describe("season — cadenceMultiplierForSeason", () => {
  it("secas → base × 1.5 (más espaciado, menos presión fúngica)", () => {
    expect(cadenceMultiplierForSeason(14, "secas")).toBe(21);
    expect(cadenceMultiplierForSeason(10, "secas")).toBe(15);
    expect(cadenceMultiplierForSeason(7, "secas")).toBe(11); // 7 * 1.5 = 10.5 → 11
  });

  it("lluvias → base × 1.0 (default operativo)", () => {
    expect(cadenceMultiplierForSeason(14, "lluvias")).toBe(14);
    expect(cadenceMultiplierForSeason(10, "lluvias")).toBe(10);
  });

  it("nunca devuelve menos de 1 día (sanity check)", () => {
    expect(cadenceMultiplierForSeason(0, "secas")).toBeGreaterThanOrEqual(1);
    expect(cadenceMultiplierForSeason(0, "lluvias")).toBeGreaterThanOrEqual(1);
    expect(cadenceMultiplierForSeason(-5, "secas")).toBeGreaterThanOrEqual(1);
  });

  it("redondea al entero más cercano (no Math.floor ni Math.ceil)", () => {
    // 7 * 1.5 = 10.5 → 11 (Math.round)
    expect(cadenceMultiplierForSeason(7, "secas")).toBe(11);
  });
});
