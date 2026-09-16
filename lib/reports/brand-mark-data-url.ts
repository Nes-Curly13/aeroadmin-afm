// lib/reports/brand-mark-data-url.ts
//
// Carga el emblema de marca (`/public/afm-emblem.svg`) y lo expone como
// un data URL `data:image/svg+xml;base64,...` para embeber en HTML
// self-contained (los PDFs se renderizan con Playwright via
// `page.setContent()` — sin base URL, no se pueden cargar recursos
// relativos).
//
// Por que el emblema (`afm-emblem.svg`) y no el logo completo:
//   El logo completo (círculo + "AFM" + "TOPOGRAFÍA") es vertical
//   (485x695). En el header de un PDF A4 horizontal queda chico e
//   ilegible. El emblema (recorte del círculo, 423x423) es el right
//   shape para un header compacto y se lee bien a 22-30px.
//
// Por que no usar un <img src="/afm-emblem.svg">:
//   `page.setContent()` no tiene base URL. Inlining el SVG via data URL
//   es self-contained y portable (local + Vercel + tests).
//
// Cache: el archivo se lee UNA vez al primer import del modulo.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let _cached: string | null = null;

export function getAfmMarkDataUrl(): string {
  if (_cached) return _cached;
  // `process.cwd()` es el root del proyecto tanto en local como en
  // Vercel (Vercel corre Next desde el root del repo). Si esto cambia
  // en el futuro, ver `next.config.ts` -> `outputFileTracingIncludes`.
  const svgPath = join(process.cwd(), "public", "afm-emblem.svg");
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
