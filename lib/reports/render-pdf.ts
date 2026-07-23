// lib/reports/render-pdf.ts
//
// Helper que renderiza HTML a PDF usando Playwright (chromium headless).
// Se usa desde el route handler `/api/parcels/[id]/report.pdf`.
//
// Decisiones (Sprint B — F1.11):
//   - **Singleton browser.** Lanzar chromium cuesta ~500-800ms. Reusamos
//     la instancia entre requests mientras el proceso Node esté vivo.
//     `closeOnExit` se registra en SIGINT/SIGTERM para no dejar zombies.
//   - **Contexto fresco por request.** `browser.newContext()` es barato
//     (~5ms) y nos aísla del estado (cookies, cache, etc.) entre
//     requests distintos. Importante: el PDF es read-only, no hay
//     cookies necesarias, pero el aislamiento evita surprises.
//   - **`page.setContent()` en vez de `page.goto(dataUrl)`.** El HTML
//     que pasamos ya es self-contained; no hace falta un data: URL.
//     `setContent` espera al `load` event por default — suficiente para
//     HTML estático sin imágenes externas.
//   - **`format: "A4"`.** Estándar para reportes operativos en Colombia.
//     `printBackground: true` para que los badges de color (🟢/🟡/🔴)
//     se impriman (Chrome por default los "optimiza" a escala de grises).
//   - **Mockeable.** El `chromium` de Playwright se inyecta como
//     parámetro para que el test smoke pueda usar `vi.mock` sin
//     levantar un browser real.
//
// Por qué no `@react-pdf` o `pdfkit`:
//   - El reporte tiene tablas, totales, y formato que se parece MUCHO
//     al HTML de la UI. Reusar Playwright (que ya está en deps por
//     los scrapers de DJI) evita agregar un renderer PDF nuevo.
//   - El tamaño del bundle de Playwright (chromium ~300MB en disco)
//     ya está amortizado para los scrapers.
//
// Trade-off: el primer request paga el costo de levantar chromium.
//   Después, ~200ms por PDF. Aceptable para el caso de uso
//   (descarga manual desde el detail page, no alta frecuencia).

import type { Browser, ChromiumBrowser } from "playwright";

/** Tipo del browser (mockeable). El paquete `playwright` exporta
 *  `Browser`; `ChromiumBrowser` es la implementación concreta. */
export type PlaywrightBrowser = Browser | ChromiumBrowser;

/** Modulo mockeable para los tests — en runtime es `playwright` directamente. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _playwrightModule: { chromium: { launch: (opts?: any) => Promise<PlaywrightBrowser> } } | null = null;

function getPlaywright() {
  if (_playwrightModule) return _playwrightModule;
  // Lazy import: si los tests mockean `playwright`, el `vi.mock` debe
  // correr antes del primer `await renderHtmlToPdf(...)`. Si importáramos
  // arriba del archivo, el mock no podría interceptar.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _playwrightModule = require("playwright") as typeof _playwrightModule;
  return _playwrightModule;
}

/** Singleton browser — se reusa entre requests. `null` hasta el primer
 *  `renderHtmlToPdf()` o `launchBrowser()`. */
let _browser: PlaywrightBrowser | null = null;

/** Bandera de "ya registramos los signal handlers" para no duplicar. */
let _signalsRegistered = false;

/** Lanza el browser si no está lanzado. Idempotente. */
export async function launchBrowser(): Promise<PlaywrightBrowser> {
  if (_browser) return _browser;
  const pw = getPlaywright();
  if (!pw) {
    throw new Error("playwright module not initialized");
  }
  _browser = await pw.chromium.launch({ headless: true });
  if (!_signalsRegistered) {
    _signalsRegistered = true;
    // Cleanup al recibir SIGINT/SIGTERM (ctrl-c, kill). En Next dev server
    // esto evita que chromium quede zombie.
    for (const sig of ["SIGINT", "SIGTERM"] as const) {
      process.once(sig, () => {
        void _browser?.close();
        _browser = null;
      });
    }
  }
  return _browser;
}

/** Cierra el browser (para tests que quieren resetear el singleton). */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    const b = _browser;
    _browser = null;
    await b.close();
  }
}

/** Inyecta un browser mockeado (para tests). Resetea el singleton. */
export function __setBrowserForTest(browser: PlaywrightBrowser | null): void {
  _browser = browser;
}

/** Inyecta el modulo de playwright mockeado (para tests). */
export function __setPlaywrightForTest(
  module: { chromium: { launch: (opts?: unknown) => Promise<PlaywrightBrowser> } } | null
): void {
  _playwrightModule = module;
}

/** Opciones de `page.pdf()`. Mismas defaults que Playwright. */
export interface RenderPdfOptions {
  /** Formato del papel. Default: A4. */
  format?: "A4" | "Letter" | "Legal";
  /** Márgenes en CSS units. Default: los de Playwright. */
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  /** Imprimir colores de fondo (default: true — necesario para los badges). */
  printBackground?: boolean;
  /** Browser ya lanzado (inyectable para tests). Si se omite, se usa el singleton. */
  browser?: PlaywrightBrowser;
}

/** Renderiza un HTML string a PDF y devuelve el Buffer. */
export async function renderHtmlToPdf(
  html: string,
  options: RenderPdfOptions = {}
): Promise<Buffer> {
  const browser = options.browser ?? (await launchBrowser());
  // `browser` puede ser null si Playwright crashea al lanzar; el
  // typeof narrowing nos protege del null.
  if (!browser) {
    throw new Error("Playwright browser unavailable");
  }
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    try {
      await page.setContent(html, { waitUntil: "load" });
      const pdf = await page.pdf({
        format: options.format ?? "A4",
        margin: options.margin ?? {
          top: "12mm",
          right: "12mm",
          bottom: "14mm",
          left: "12mm"
        },
        printBackground: options.printBackground ?? true
      });
      // Playwright devuelve `Uint8Array` (o `Buffer` en Node). Lo
      // normalizamos a `Buffer` para que el caller (NextResponse) lo
      // acepte sin warnings de tipos.
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  } finally {
    // Cerramos el context (no el browser — el browser es singleton).
    await context.close();
  }
}
