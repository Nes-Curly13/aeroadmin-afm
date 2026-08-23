/**
 * tests/lib-excel-applications-matcher.test.ts
 *
 * Test del matcher Excel ↔ dji_flights. Sprint feature/excel-applications-import.
 *
 * El matcher vive en lib/excel-applications-matcher.js (CJS). Los tests
 * importan el .js con tipos via JSDoc.
 */

import { describe, expect, it } from "vitest";
import { matchRow, type DjiFlightForMatching, type ExcelApplicationRow } from "@/lib/excel-applications-matcher";

function makeRow(overrides: Partial<ExcelApplicationRow> = {}): ExcelApplicationRow {
  return {
    source: { sheet: "2025", row_idx: 1 },
    fecha: new Date(Date.UTC(2026, 5, 15)),
    hacienda: "PAPAYAL",
    suerte: "1",
    piloto: "BREINER PELAEZ",
    drone: "T-40",
    transporte: null,
    tipo_aplicacion: "PRE EMERGENTE",
    altura_m: 3,
    velocidad_m_s: 15,
    area_aplicada: 19.58,
    unidad_area: "ha",
    area_ot: 19.58,
    ancho_franja_m: 6,
    dosis_l_ha: 20,
    volumen_l: null,
    zona: "CENTRO",
    cliente: "AGROJABA",
    numero_factura: null,
    fecha_facturacion: null,
    valor_factura_cop: null,
    cancelada: null,
    horas_planta: null,
    ...overrides
  };
}

function makeFlight(overrides: Partial<DjiFlightForMatching> = {}): DjiFlightForMatching {
  return {
    flight_id: 1234,
    drone_nickname: "T-40",
    pilot_name: "BREINER PELAEZ",
    start_at: new Date(Date.UTC(2026, 5, 15, 14, 30, 0)),
    ...overrides
  };
}

describe("matchRow — happy path", () => {
  it("match exacto: misma fecha, mismo drone, mismo piloto → score 1.0", () => {
    const result = matchRow(makeRow(), [makeFlight()]);
    expect(result.method).toBe("exact");
    expect(result.score).toBe(1.0);
    expect(result.flight_id).toBe(1234);
  });

  it("match exacto con variaciones de case/espacios", () => {
    const row = makeRow({ drone: "  T-40  ", piloto: "breiner pelaez" });
    const cand = makeFlight({ drone_nickname: "T-40", pilot_name: "BREINER PELAEZ" });
    const result = matchRow(row, [cand]);
    expect(result.method).toBe("exact");
    expect(result.score).toBe(1.0);
  });
});

describe("matchRow — fuzzy / parcial", () => {
  it("mismo drone pero piloto distinto → score 0.5 (fuzzy)", () => {
    const result = matchRow(
      makeRow(),
      [makeFlight({ pilot_name: "OTRO PILOTO" })]
    );
    expect(result.method).toBe("fuzzy");
    expect(result.score).toBe(0.5);
    expect(result.flight_id).toBe(1234);
  });

  it("dron distinto → no_match (score 0)", () => {
    const result = matchRow(
      makeRow(),
      [makeFlight({ drone_nickname: "T-50" })]
    );
    expect(result.method).toBe("no_match");
    expect(result.score).toBe(0);
    expect(result.flight_id).toBe(null);
  });
});

describe("matchRow — sin match", () => {
  it("fecha distinta → no_match", () => {
    const row = makeRow({ fecha: new Date(Date.UTC(2026, 5, 15)) });
    const cand = makeFlight({ start_at: new Date(Date.UTC(2026, 5, 16, 10, 0, 0)) });
    const result = matchRow(row, [cand]);
    expect(result.score).toBe(0);
    expect(result.flight_id).toBe(null);
  });

  it("sin fecha en la fila → no_match", () => {
    const result = matchRow(makeRow({ fecha: null }), [makeFlight()]);
    expect(result.score).toBe(0);
  });

  it("sin drone en la fila → no_match", () => {
    const result = matchRow(makeRow({ drone: null }), [makeFlight()]);
    expect(result.score).toBe(0);
  });

  it("sin candidatos → no_match", () => {
    const result = matchRow(makeRow(), []);
    expect(result.score).toBe(0);
  });
});

describe("matchRow — múltiples candidatos", () => {
  it("toma el primer candidato que matchea en orden", () => {
    const row = makeRow();
    const result = matchRow(row, [
      makeFlight({ flight_id: 100, drone_nickname: "T-50" }),
      makeFlight({ flight_id: 200, drone_nickname: "T-40" })
    ]);
    expect(result.flight_id).toBe(200);
  });

  it("matchea con el primer candidato con misma fecha", () => {
    const row = makeRow({ fecha: new Date(Date.UTC(2026, 5, 15)) });
    const result = matchRow(row, [
      makeFlight({ flight_id: 100, start_at: new Date(Date.UTC(2026, 5, 14)) }),
      makeFlight({ flight_id: 200, start_at: new Date(Date.UTC(2026, 5, 15)) })
    ]);
    expect(result.flight_id).toBe(200);
  });
});
