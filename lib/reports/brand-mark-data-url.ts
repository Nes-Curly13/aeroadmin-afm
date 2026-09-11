// lib/reports/brand-mark-data-url.ts
//
// Carga el mark de marca (`/public/afm-logo-mark.svg`) y lo expone como
// un data URL `data:image/svg+xml;base64,...` para embeber en HTML
// self-contained (los PDFs se renderizan con Playwright via
// `page.setContent()` — sin base URL, no se pueden cargar recursos
// relativos).
//
// Por que no usar la version full (`/public/afm-logo.svg`):
//   El full logo es vertical (485x695, aspect 0.7). En el header de
//   un PDF A4 horizontal queda aplastado o muy alto. El mark
//   horizontal (120x40, aspect 3.0) es el right shape para un header
//   compacto.
//
// Por que no usar un <img src="/afm-logo-mark.svg">:
//   `page.setContent()` no tiene base URL. Si quisieras cargar un
//   recurso relativo, tendrias que:
//     a) pasar `page.goto(dataUrl, ...)` con un data URL, o
//     b) servir el HTML desde un servidor real.
//   Las 2 opciones son fragiles. Inlining el SVG via data URL es
//   self-contained y portable (corre en local + Vercel + tests).
//
// Cache: el archivo se lee UNA vez al primer import del modulo.
// Tests que importan este modulo 100 veces solo leen 1 vez del disco.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let _cached: string | null = null;

export function getAfmMarkDataUrl(): string {
  if (_cached) return _cached;
  // `process.cwd()` es el root del proyecto tanto en local como en
  // Vercel (Vercel corre Next desde el root del repo). Si esto cambia
  // en el futuro, ver `next.config.ts` -> `outputFileTracingIncludes`.
  const svgPath = join(process.cwd(), "public", "afm-logo-mark.svg");
  const svg = readFileSync(svgPath, "utf-8");
  _cached = `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`;
  return _cached;
}

/** Para tests: limpia el cache para que el siguiente `getAfmMarkDataUrl()`
 *  re-lea el archivo. Util cuando un test quiere simular que el SVG
 *  cambio en disco. */
export function __resetAfmMarkDataUrlForTest(): void {
  _cached = null;
}
