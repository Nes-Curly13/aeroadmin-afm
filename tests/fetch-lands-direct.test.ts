// Tests para scripts/fetch-lands-direct.js
//
// Cubre:
//   - parseBbox: parsing correcto del formato "lat_min,lat_max,lng_min,lng_max"
//   - parseBbox: errores de formato (no-4 partes, NaN)
//   - parseBbox: orden correcto de campos (latMin, latMax, lngMin, lngMax)
//
// El script completo (main) NO se testea unitariamente porque requiere
// login real contra DJI; ver tests/djiag-lands-fetcher.test.ts para el
// parser de responses y tests/fixtures/ para data de regresión.

import { describe, expect, it } from "vitest";
import { parseBbox } from "@/scripts/fetch-lands-direct";

describe("fetch-lands-direct — parseBbox", () => {
  it("parsea bbox Colombia por defecto (--bbox '-4,13,-79,-66')", () => {
    const b = parseBbox("-4,13,-79,-66");
    expect(b).toEqual({ latMin: -4, latMax: 13, lngMin: -79, lngMax: -66 });
  });

  it("acepta bbox custom (region específica)", () => {
    const b = parseBbox("3.5,4.5,-76.5,-75.5");
    expect(b).toEqual({ latMin: 3.5, latMax: 4.5, lngMin: -76.5, lngMax: -75.5 });
  });

  it("acepta valores negativos correctamente", () => {
    const b = parseBbox("-1.5,-0.5,-77.5,-76.5");
    expect(b).toEqual({ latMin: -1.5, latMax: -0.5, lngMin: -77.5, lngMax: -76.5 });
  });

  it("lanza si el formato no es 'a,b,c,d'", () => {
    expect(() => parseBbox("1,2,3")).toThrow(/must be/);
    expect(() => parseBbox("1,2,3,4,5")).toThrow(/must be/);
    expect(() => parseBbox("")).toThrow(/must be/);
  });

  it("lanza si algún valor no es numérico", () => {
    expect(() => parseBbox("a,b,c,d")).toThrow(/must be/);
    expect(() => parseBbox("1,2,3,abc")).toThrow(/must be/);
    expect(() => parseBbox("1,NaN,3,4")).toThrow(/must be/);
  });

  it("lanza si los valores son Infinity", () => {
    // Number("Infinity") = Infinity → Number.isFinite lo rechaza
    expect(() => parseBbox("1,2,3,Infinity")).toThrow(/must be/);
  });

  it("preserva el orden semántico (NO invierte lat/lng)", () => {
    // BUG histórico: confundir lat/lng lleva a queries con el bbox rotado 90°
    // y la respuesta de DJI viene vacía sin error. parseBbox NO debe
    // reordenar, debe devolver EXACTAMENTE lo que el usuario puso.
    const b = parseBbox("3.0,4.0,-77.0,-76.0");
    expect(b.latMin).toBe(3.0);
    expect(b.latMax).toBe(4.0);
    expect(b.lngMin).toBe(-77.0);
    expect(b.lngMax).toBe(-76.0);
  });
});
