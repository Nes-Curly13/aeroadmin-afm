/**
 * tests/api-repositories-effective-cadence.test.ts
 *
 * Test unitario del helper `effectiveCadence(sched)` y la constante
 * `DEFAULT_CADENCE_DAYS` exportados desde `api/repositories.ts`.
 *
 * Sprint Fase 2 / S2 (2026-08-23) — el helper centraliza la regla
 * "si no hay schedule, default 14 días" que antes estaba duplicada
 * inline en `createFumigationEvent` y `linkFumigationToParcel`.
 *
 * Cubre:
 *   - `effectiveCadence(null)` → DEFAULT_CADENCE_DAYS
 *   - `effectiveCadence(undefined)` → DEFAULT_CADENCE_DAYS
 *   - `effectiveCadence({ recommended_cadence_days: 21 })` → 21
 *   - `effectiveCadence({ recommended_cadence_days: 0 })` → default (defensivo)
 *   - `effectiveCadence({ recommended_cadence_days: -1 })` → default (defensivo)
 *   - `effectiveCadence({ recommended_cadence_days: undefined })` → default
 *   - `DEFAULT_CADENCE_DAYS` = 14
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CADENCE_DAYS,
  effectiveCadence
} from "@/api/repositories";

describe("DEFAULT_CADENCE_DAYS", () => {
  it("es 14 (cadencia operativa estándar de arroz en Valle del Cauca)", () => {
    expect(DEFAULT_CADENCE_DAYS).toBe(14);
  });
});

describe("effectiveCadence", () => {
  it("null → DEFAULT_CADENCE_DAYS (caso sin schedule)", () => {
    expect(effectiveCadence(null)).toBe(DEFAULT_CADENCE_DAYS);
  });

  it("undefined → DEFAULT_CADENCE_DAYS", () => {
    expect(effectiveCadence(undefined)).toBe(DEFAULT_CADENCE_DAYS);
  });

  it("schedule con recommended_cadence_days > 0 → usa ese valor", () => {
    expect(effectiveCadence({ recommended_cadence_days: 21 } as never)).toBe(21);
    expect(effectiveCadence({ recommended_cadence_days: 7 } as never)).toBe(7);
    expect(effectiveCadence({ recommended_cadence_days: 30 } as never)).toBe(30);
  });

  it("recommended_cadence_days = 0 → default (defensivo, evita loop de cadencia 0)", () => {
    // 0 sería un valor inválido (la fumigación se repetiría cada 0 días).
    // Mejor default que un loop infinito de fumigaciones.
    expect(effectiveCadence({ recommended_cadence_days: 0 } as never)).toBe(
      DEFAULT_CADENCE_DAYS
    );
  });

  it("recommended_cadence_days negativo → default (defensivo)", () => {
    expect(effectiveCadence({ recommended_cadence_days: -1 } as never)).toBe(
      DEFAULT_CADENCE_DAYS
    );
  });

  it("recommended_cadence_days no es número → default", () => {
    expect(
      effectiveCadence({ recommended_cadence_days: undefined } as never)
    ).toBe(DEFAULT_CADENCE_DAYS);
    expect(
      effectiveCadence({ recommended_cadence_days: null as unknown as number } as never)
    ).toBe(DEFAULT_CADENCE_DAYS);
  });

  it("ignora otros campos del schedule (recommended_cadence_days manda)", () => {
    const sched = {
      parcel_id: 1,
      recommended_cadence_days: 21,
      crop_type: "arroz",
      last_fumigation_date: "2026-01-01",
      next_due_date: "2026-01-15",
      is_active: true,
      notes: null
    } as never;
    expect(effectiveCadence(sched)).toBe(21);
  });
});
