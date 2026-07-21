// Tests del CLI check-fumigations-coverage (v1.6).
//
// Cubre:
//   - parseArgs (pure function): defaults, override de --days, override de
//     --threshold, valores invalidos caen a defaults.
//   - El script expone main() y parseArgs() (contrato del modulo).
//   - La query SQL no se ejecuta en estos tests (no DB local con datos).
//     El smoke test en CI requiere BD (igual que los otros scripts CLI).
//
// Estrategia: el archivo es .js (CommonJS). Vitest carga el .js via el
// path alias `@/scripts/check-fumigations-coverage` (resuelve al .d.ts
// para tipos + al .js para runtime, mismo patron que refresh-fumigations).

import { describe, expect, it } from "vitest";

import coverageModule from "@/scripts/check-fumigations-coverage";

const { parseArgs } = coverageModule as unknown as {
  parseArgs: (argv: string[]) => { days: number; threshold: number };
  main: () => Promise<void>;
};

describe("parseArgs (v1.6 check-fumigations-coverage)", () => {
  it("devuelve defaults cuando no hay args", () => {
    expect(parseArgs([])).toEqual({ days: 30, threshold: 0.95 });
  });

  it("acepta --days <N>", () => {
    expect(parseArgs(["--days", "60"])).toEqual({ days: 60, threshold: 0.95 });
  });

  it("acepta --threshold <0..1>", () => {
    expect(parseArgs(["--threshold", "0.85"])).toEqual({ days: 30, threshold: 0.85 });
  });

  it("acepta --days y --threshold combinados en cualquier orden", () => {
    expect(parseArgs(["--threshold", "0.8", "--days", "14"])).toEqual({
      days: 14,
      threshold: 0.8
    });
  });

  it("cae al default de days si el valor es invalido (0, negativo, NaN)", () => {
    expect(parseArgs(["--days", "0"])).toEqual({ days: 30, threshold: 0.95 });
    expect(parseArgs(["--days", "-5"])).toEqual({ days: 30, threshold: 0.95 });
    expect(parseArgs(["--days", "abc"])).toEqual({ days: 30, threshold: 0.95 });
  });

  it("cae al default de threshold si el valor es invalido (fuera de 0-1, NaN)", () => {
    expect(parseArgs(["--threshold", "1.5"])).toEqual({ days: 30, threshold: 0.95 });
    expect(parseArgs(["--threshold", "-0.1"])).toEqual({ days: 30, threshold: 0.95 });
    expect(parseArgs(["--threshold", "abc"])).toEqual({ days: 30, threshold: 0.95 });
  });

  it("ignora args desconocidos (no rompe)", () => {
    // --verbose no es un flag conocido, pero parseArgs no debe explotar.
    const result = parseArgs(["--verbose", "--days", "7"]);
    expect(result.days).toBe(7);
    expect(result.threshold).toBe(0.95);
  });
});

describe("check-fumigations-coverage — contrato del modulo", () => {
  it("exporta main y parseArgs", () => {
    expect(typeof coverageModule.main).toBe("function");
    expect(typeof coverageModule.parseArgs).toBe("function");
  });
});
