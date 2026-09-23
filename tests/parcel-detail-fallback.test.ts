// Anti-regression: la hoja de vida de una parcela recién creada debe
// renderizar, no dar 404.
//
// Bug (2026-09-23): `loadDataset()` (V0) carga solo el top-2000 por
// `land_name`. Con 4701 parcelas, una recién creada no entraba →
// `getParcelSummary` devolvía null → `notFound()` en /parcelas/[id].
// Fix: `getParcelSummary` cae a un fetch puntual por id
// (`getParcelSummaryById` → `getParcelById`).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = join(__dirname, "..");

function readNoComments(relPath: string): string {
  const fullPath = join(projectRoot, relPath);
  if (!existsSync(fullPath)) throw new Error(`No se encontró ${fullPath}`);
  return readFileSync(fullPath, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("lib/data — getParcelSummary fallback por id", () => {
  const src = readNoComments("lib/data.ts");

  it("getParcelSummary cae al fetch puntual cuando no está en el dataset", () => {
    expect(src).toContain("getParcelSummaryById");
  });

  it("getParcelSummaryById trae la parcela por id (getParcelById)", () => {
    const idx = src.indexOf("async function getParcelSummaryById");
    expect(idx, "debe existir getParcelSummaryById").toBeGreaterThan(-1);
    const body = src.slice(idx, idx + 900);
    expect(body).toContain("getParcelById");
  });
});
