/**
 * tests/lib/map-filter-types.test.ts
 *
 * Tests para las constantes runtime de `lib/map-filter-types.ts`.
 * El archivo es mayormente tipos (`export interface` / `export type`),
 * asi que solo testeamos:
 *   - `CADENCE_STATUS_ORDER`: orden canonico, sin duplicados, cubre los 4 status
 *   - `CADENCE_STATUS_META`: cada status tiene label/color/internal, los
 *     internal values son exactamente los 4 de `FumigationStatus` interno
 *
 * Cobertura: MT-10 (complementa MT-07 que limpio TODOs del interface).
 * Lane: `lib/map-filter-types.ts` — no en paralelo con MT-07.
 */

import { describe, expect, it } from "vitest";
import {
  CADENCE_STATUS_META,
  CADENCE_STATUS_ORDER,
  type CadenceStatus,
} from "@/lib/map-filter-types";

describe("lib/map-filter-types — CADENCE_STATUS_ORDER", () => {
  it("tiene 4 status en orden canonico (mas urgente primero)", () => {
    expect(CADENCE_STATUS_ORDER).toEqual([
      "critico",
      "vencido",
      "por_vencer",
      "al_dia"
    ]);
  });

  it("no tiene duplicados", () => {
    const set = new Set(CADENCE_STATUS_ORDER);
    expect(set.size).toBe(CADENCE_STATUS_ORDER.length);
  });

  it("cubre exactamente los 4 status definidos en CadenceStatus", () => {
    const declared: CadenceStatus[] = [
      "critico",
      "vencido",
      "por_vencer",
      "al_dia"
    ];
    for (const s of declared) {
      expect(CADENCE_STATUS_ORDER).toContain(s);
    }
  });
});

describe("lib/map-filter-types — CADENCE_STATUS_META", () => {
  it("cada status del orden canonico tiene metadata (label + color + internal)", () => {
    for (const status of CADENCE_STATUS_ORDER) {
      const meta = CADENCE_STATUS_META[status];
      expect(meta).toBeDefined();
      expect(typeof meta.label).toBe("string");
      expect(meta.label.length).toBeGreaterThan(0);
      expect(typeof meta.color).toBe("string");
      // color como hex (#RRGGBB) o token CSS — aceptamos los 2 formatos
      expect(meta.color).toMatch(/^(#|rgb|hsl|var)/);
      expect(["no_history", "overdue", "due_soon", "ok"]).toContain(meta.internal);
    }
  });

  it("labels son en espanol (no vacios, no son codigos)", () => {
    for (const status of CADENCE_STATUS_ORDER) {
      const label = CADENCE_STATUS_META[status].label;
      // Heuristica: label no es un codigo (no es kebab-case, no es enum value)
      expect(label).not.toMatch(/^[a-z_]+$/); // no es solo lowercase+underscore
      expect(label.length).toBeGreaterThan(2);
    }
  });

  it("el internal value mapea al FumigationStatus interno correcto", () => {
    // Documentamos el contrato esperado. Si alguien cambia el mapeo
    // accidentalmente, este test lo cacha.
    expect(CADENCE_STATUS_META.critico.internal).toBe("no_history");
    expect(CADENCE_STATUS_META.vencido.internal).toBe("overdue");
    expect(CADENCE_STATUS_META.por_vencer.internal).toBe("due_soon");
    expect(CADENCE_STATUS_META.al_dia.internal).toBe("ok");
  });
});
