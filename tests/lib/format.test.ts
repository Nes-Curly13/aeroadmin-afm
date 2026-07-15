// tests/lib/format.test.ts
//
// Tests para helpers de `lib/format.ts`.
// Empezamos solo con `isProvenanceNotes` (agregado en 2026-07-15) —
// los demás helpers (formatDate, daysBetween, etc.) ya están cubiertos
// indirectamente por tests de componentes y rutas.

import { describe, expect, it } from "vitest";

import { isProvenanceNotes } from "@/lib/format";

describe("isProvenanceNotes", () => {
  it("detecta blob JSON con backfilled_from", () => {
    const notes =
      '{"drones":["AFM T50-1"], "pilots":["breiner pelaez"], "flights_count":19, "spray_usage_ml":353745, "backfilled_from":"dji_flights", "primary_drone_nickname":"AFM T50-1"}';
    expect(isProvenanceNotes(notes)).toBe(true);
  });

  it("detecta blob JSON con spray_usage_ml", () => {
    const notes = '{"spray_usage_ml":12345}';
    expect(isProvenanceNotes(notes)).toBe(true);
  });

  it("detecta blob JSON con primary_drone_nickname", () => {
    const notes = '{"primary_drone_nickname":"T40-1"}';
    expect(isProvenanceNotes(notes)).toBe(true);
  });

  it("retorna false para null", () => {
    expect(isProvenanceNotes(null)).toBe(false);
  });

  it("retorna false para undefined", () => {
    expect(isProvenanceNotes(undefined)).toBe(false);
  });

  it("retorna false para string vacío", () => {
    expect(isProvenanceNotes("")).toBe(false);
  });

  it("retorna false para notas humanas normales", () => {
    expect(isProvenanceNotes("Llovizna leve, revisar mañana")).toBe(false);
    expect(isProvenanceNotes("Operador reportó viento fuerte")).toBe(false);
    expect(isProvenanceNotes("Aplicación parcial — solo 60% del lote")).toBe(false);
  });

  it("retorna false para JSON que no parece de backfill (sin keys conocidas)", () => {
    // JSON-shape pero sin las keys del backfill: probablemente es
    // metadata legítima o nota estructurada del operador.
    const notes = '{"observacion":"viento fuerte", "severidad":"alta"}';
    expect(isProvenanceNotes(notes)).toBe(false);
  });

  it("tolera espacios en blanco al inicio/final", () => {
    const notes = '  {"backfilled_from":"dji_flights"}  ';
    expect(isProvenanceNotes(notes)).toBe(true);
  });

  it("retorna false para string que empieza con { pero no termina con }", () => {
    // Malformed, no debería clasificar como provenance.
    expect(isProvenanceNotes('{"backfilled_from": "dji_flights"')).toBe(false);
  });
});
