// Tests para scripts/backfill-fumigations-from-flights.js
//
// Cubre:
//   - droneCodeFromNickname: mapeo correcto de T40/T50/T16/T20/T70 → drone_models.code
//   - null safety: nicknames vacíos/null/dev unknown
//   - case-insensitive matching (los nicknames vienen en mayúsculas como
//     "AFM T50-1" y necesitamos matchear "t50")
//
// El script completo (backfillFumigationsFromFlights) NO se testea unitariamente
// porque requiere DB real; ver tests/user-story-dashboard-e2e.test.ts para
// el E2E con la DB.

import { describe, expect, it } from "vitest";
import { droneCodeFromNickname } from "@/scripts/backfill-fumigations-from-flights";

describe("backfill-fumigations-from-flights — droneCodeFromNickname", () => {
  it("mapea T40 → 201 (T40/T50 family)", () => {
    expect(droneCodeFromNickname("AFM T40 1")).toBe(201);
    expect(droneCodeFromNickname("Drone-T40")).toBe(201);
    expect(droneCodeFromNickname("t40")).toBe(201);
  });

  it("mapea T50 → 201 (T40/T50 family)", () => {
    expect(droneCodeFromNickname("AFM T50-1")).toBe(201);
    expect(droneCodeFromNickname("AFM T50-2")).toBe(201);
    expect(droneCodeFromNickname("t50")).toBe(201);
  });

  it("mapea T16 → 72 (T16/T20 family)", () => {
    expect(droneCodeFromNickname("Drone T16")).toBe(72);
    expect(droneCodeFromNickname("t16-001")).toBe(72);
  });

  it("mapea T20 → 72 (T16/T20 family)", () => {
    expect(droneCodeFromNickname("Drone T20")).toBe(72);
    expect(droneCodeFromNickname("t20")).toBe(72);
  });

  it("mapea T70 → 210", () => {
    expect(droneCodeFromNickname("Drone T70")).toBe(210);
    expect(droneCodeFromNickname("t70")).toBe(210);
  });

  it("case-insensitive (AFM T50-1 vs afm t50-1)", () => {
    expect(droneCodeFromNickname("AFM T50-1")).toBe(201);
    expect(droneCodeFromNickname("afm t50-1")).toBe(201);
    expect(droneCodeFromNickname("AFM t50-1")).toBe(201);
  });

  it("nickname desconocido → 0 (Sin asignar)", () => {
    expect(droneCodeFromNickname("AFMDrone")).toBe(0);
    expect(droneCodeFromNickname("Unknown Drone")).toBe(0);
    expect(droneCodeFromNickname("Mavic")).toBe(0);
  });

  it("null safety", () => {
    expect(droneCodeFromNickname(null)).toBeNull();
    expect(droneCodeFromNickname(undefined)).toBeNull();
    expect(droneCodeFromNickname("")).toBeNull();
  });

  it("T40 con T50 también en nombre → 201 (cualquier match gana)", () => {
    // "AFM T50" matchea T50 → 201. No probamos combinaciones cruzadas como
    // "T40 + T50" porque ningún nickname real las tiene, pero validamos
    // que un match es suficiente.
    expect(droneCodeFromNickname("T40-T50 hybrid")).toBe(201);
  });
});
