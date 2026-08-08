// lib/reports/render-map-screenshot.ts
//
// Screenshot server-side del mapa de impresión de una parcela. Usado por
// el route handler del PDF para incluir una imagen satelital real en la
// sección "Ubicación" del reporte.
//
// feature/reports-level-1 sub-sprint 3 (2026-08-08).
//
// Decisiones:
//   - **Singleton browser**: reusamos el browser del `render-pdf.ts` (ya
//     está optimizado para serverless con `@sparticuz/chromium`). El
//     costo de levantar chromium es ~500-800ms; reusarlo entre requests
//     baja el request completo del PDF a ~1-2s (vs ~3-4s si fuera
//     browser-per-request).
//   - **Wait por `window.__mapReady`**: el HTML del mapa dispara este
//     flag cuando MapLibre terminó de cargar TODOS los tiles. Esperar
//     por él (con un timeout defensivo de 8s) es más robusto que un
//     sleep fijo — si los tiles demoran 3s, no cortamos antes de tiempo.
//   - **Fallback a null**: si el screenshot falla (timeout, network
//     error, parcel sin geom), devolvemos null. El caller (route
//     handler) cae al SVG vectorial como antes. Esto mantiene el
//     feature siempre usable, incluso si EOX está caído.
//   - **Context fresco por request**: igual que `renderHtmlToPdf`, un
//     nuevo context con viewport fijo. El browser es singleton pero
//     los contexts están aislados.
//   - **URL absoluta**: la URL del endpoint print-map necesita base
//     absoluta (http://localhost:3000 o la URL del deploy). El route
//     handler pasa el origin del request.

import { launchBrowser } from "./render-pdf";

/** Screenshot del mapa de impresión. Devuelve PNG buffer o `null` si falla. */
export async function renderParcelMapToPng(
  parcelId: number,
  baseUrl: string,
  options: { timeoutMs?: number; viewport?: { width: number; height: number } } = {}
): Promise<Buffer | null> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const viewport = options.viewport ?? { width: 800, height: 600 };

  let browser;
  try {
    browser = await launchBrowser();
  } catch {
    return null;
  }

  const context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage();
    const url = `${baseUrl.replace(/\/+$/, "")}/api/internal/print-map/${parcelId}`;
    await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
    // Esperar a que el mapa esté listo (window.__mapReady = true). El
    // HTML del print-map dispara esto cuando MapLibre completó de
    // cargar todos los tiles visibles. Failsafe: si la página crashea
    // y nunca setea el flag, igual seguimos después del timeout.
    await page
      .waitForFunction(() => Boolean((window as { __mapReady?: boolean }).__mapReady), {
        timeout: timeoutMs
      })
      .catch(() => {});
    // Pequeño buffer para que la última frame se pinte.
    await page.waitForTimeout(200);
    const png = await page.screenshot({ type: "png", fullPage: false });
    return Buffer.from(png);
  } catch {
    return null;
  } finally {
    await context.close();
  }
}
