import { describe, expect, it } from "vitest";

import { toDateString } from "@/lib/format";

/**
 * Contrato: `toDateString` normaliza valores que vienen del driver `pg`
 * (que devuelve columnas `DATE` como objetos `Date` de JS) a strings
 * `YYYY-MM-DD`. Sin esta normalización, renderizar la fecha directo en JSX
 * tira "Objects are not valid as a React child (found: [object Date])".
 *
 * Si rompés este contrato, /api/fumigations, /api/parcels/[id] y el dashboard
 * empiezan a tirar 500 en producción.
 */
describe("toDateString — pg Date ↔ ISO string normalization", () => {
  it("Date object → YYYY-MM-DD", () => {
    const d = new Date(Date.UTC(2026, 5, 24)); // 2026-06-24
    expect(toDateString(d)).toBe("2026-06-24");
  });

  it("Date at midnight UTC (noon-offset safe)", () => {
    // pg puede devolver fechas con offset del timezone del server; la normalización
    // a toISOString().slice(0,10) debe ser estable para 'YYYY-MM-DD'.
    const d = new Date("2026-06-24T00:00:00.000Z");
    expect(toDateString(d)).toBe("2026-06-24");
  });

  it("string ISO YYYY-MM-DD → igual", () => {
    expect(toDateString("2026-06-24")).toBe("2026-06-24");
  });

  it("null → null", () => {
    expect(toDateString(null)).toBeNull();
  });

  it("undefined → null", () => {
    expect(toDateString(undefined)).toBeNull();
  });

  it("Invalid Date → null (no rompe el render)", () => {
    expect(toDateString(new Date("not a date"))).toBeNull();
  });

  it("el resultado es siempre string|null — nunca Date", () => {
    // Este es el caso que rompía React: si la API devolvía Date, JSX reventaba.
    const inputs: Array<Date | string | null | undefined> = [
      new Date(Date.UTC(2026, 0, 1)),
      "2026-01-01",
      null,
      undefined
    ];
    for (const input of inputs) {
      const out = toDateString(input);
      expect(out === null || typeof out === "string").toBe(true);
      // Forzamos el tipo unknown para que TS no haga narrowing y permita
      // el instanceof check (la función garantiza string|null en runtime).
      expect((out as unknown) instanceof Date).toBe(false);
    }
  });
});
