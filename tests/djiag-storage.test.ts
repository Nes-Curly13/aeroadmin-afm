import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * Tests del storage state cache (S1 §2.5).
 *
 * El cliente Playwright para DJI ahora persiste la sesión del browser en
 * disco después de login exitoso. Esto evita repetir el ciclo de redirects
 * cross-subdomain en cada corrida. `isStorageStateFresh` es la única función
 * pura del flujo — testeable sin browser.
 *
 * El resto del flujo (launch con storageState, save después de login) requiere
 * Playwright real; se valida manualmente con --smoke.
 *
 * Importamos el .js puro con createRequire. El .d.ts sibling hace que
 * vite no parsee el .js cuando se importa desde TS (evita el lío con
 * comentarios JSDoc con asteriscos en el archivo del cliente).
 */

const require = createRequire(import.meta.url);
const { isStorageStateFresh } = require("../lib/djiag-storage") as {
  isStorageStateFresh: (filePath: string, maxAgeMs?: number) => boolean;
};

function makeTempStateFile(ageMs: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "afm-state-"));
  const file = path.join(dir, "djiag_session.json");
  fs.writeFileSync(file, JSON.stringify({ cookies: [], origins: [] }), "utf8");
  const t = Date.now() / 1000 - ageMs / 1000;
  fs.utimesSync(file, t, t);
  return file;
}

describe("isStorageStateFresh", () => {
  it("devuelve true para archivo recién creado", () => {
    const file = makeTempStateFile(0);
    expect(isStorageStateFresh(file, 7 * 24 * 60 * 60 * 1000)).toBe(true);
  });

  it("devuelve true para archivo de hace 6 días con max age 7 días", () => {
    const file = makeTempStateFile(6 * 24 * 60 * 60 * 1000);
    expect(isStorageStateFresh(file, 7 * 24 * 60 * 60 * 1000)).toBe(true);
  });

  it("devuelve false para archivo de hace 8 días con max age 7 días", () => {
    const file = makeTempStateFile(8 * 24 * 60 * 60 * 1000);
    expect(isStorageStateFresh(file, 7 * 24 * 60 * 60 * 1000)).toBe(false);
  });

  it("devuelve false para archivo inexistente", () => {
    expect(isStorageStateFresh("/path/que/no/existe/state.json", 1000)).toBe(false);
  });

  it("acepta max age muy corto (1 segundo) y rechaza archivo de hace 2s", () => {
    const file = makeTempStateFile(2000);
    expect(isStorageStateFresh(file, 1000)).toBe(false);
  });

  it("usa el default de 7 días cuando no se pasa maxAgeMs", () => {
    const file = makeTempStateFile(0);
    expect(isStorageStateFresh(file)).toBe(true);
  });
});