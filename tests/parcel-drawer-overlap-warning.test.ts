// Anti-regression: el aviso de solape del ParcelDrawer NO debe
// interceptar los clicks del toolbar.
//
// Bug (2026-09-23, /admin/parcels/new): al dibujar, el banner
// `drawer-overlap-warning` (absolute, z-30) se superponía al toolbar
// (z-10) y, sin `pointer-events-none`, bloqueaba los botones
// "Cerrar"/"Dibujar"/"Coordenadas" → el operador no podía cerrar el
// polígono ni crear la parcela.

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

describe("ParcelDrawer — overlap warning no bloquea el toolbar", () => {
  it("el contenedor del aviso de solape tiene pointer-events-none", () => {
    const src = readNoComments("components/admin/parcels/parcel-drawer.tsx");
    const idx = src.indexOf("drawer-overlap-warning");
    expect(idx, "debe existir el aviso drawer-overlap-warning").toBeGreaterThan(-1);
    // En el JSX, `data-testid` va antes de `className` → miramos hacia adelante.
    const window = src.slice(idx, idx + 500);
    expect(
      window.includes("pointer-events-none"),
      "el div del overlap warning debe tener `pointer-events-none` para no bloquear el toolbar"
    ).toBe(true);
  });
});
