import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — Sprint S8.2 (2026-07-29).
 *
 * Setup:
 *   - Levanta `next start` en puerto 3001 (no 3000 — evita pisar dev local).
 *   - Auto-seedea el usuario E2E via `scripts/seed-admin-user.js` antes de
 *     arrancar la suite (`globalSetup`), con email `e2e@aeroadmin.local`.
 *   - Usa Chromium (los mas comunes de los operadores).
 *   - Skip WebKit (Safari quirks exagerados; no aporta en Opcion A).
 *
 * Decisiones:
 *   - Tests NO dependen de la BD scrapeada de DJI. Validamos shape
 *     (KPIs visibles, no valores exactos).
 *   - Headless siempre. localStorage/auth cae al server-side cookie.
 *   - `webServer.timeout = 240_000` (4 min) porque el primer `next build`
 *     tarda ~30-50s + `next start` arranca ~1s.
 *   - Reusa el server si ya esta corriendo (dev local lo aproveche).
 *
 * Variables:
 *   - BASE_URL (default http://localhost:3001) — si querés apuntar a
 *     staging o prod, override con `BASE_URL=...`.
 *   - E2E_USER_EMAIL / E2E_USER_PASSWORD — para no hardcodear en el repo.
 *   - SKIP_BUILD=1 — si el server ya esta corriendo y no queres rebuild.
 *
 * Sprint S8.2: actualizado para V0 (geovisor, parcelas, admin/parcels).
 * El webServer usa `next start` (no `next dev`) porque Turbopack tiene
 * un memory leak que tumba el dev server despues de ~30 requests.
 * `next start` (production) es estable 100+ requests sin leak.
 */

const PORT = 3001;
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const SKIP_BUILD = process.env.SKIP_BUILD === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  // Sprint S8.2: el spec admin-parcels (3) hace un UPDATE a la BD.
  // Los specs corren secuenciales para no pisarse entre si — fullyParallel=false.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "list" : "list",
  timeout: 60_000, // 60s por test (la mayoria son <10s pero el build + login pueden tardar mas)
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // MapLibre + EOX tiles pueden tardar 5-10s en cargar. La mayoria de
    // tests no esperan al mapa, pero por si acaso.
    actionTimeout: 15_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
    // Firefox requiere `npx playwright install firefox` (extra ~150 MB).
    // Habilitarlo localmente descomentando este bloque:
    // {
    //   name: "firefox",
    //   use: { ...devices["Desktop Firefox"] }
    // }
  ],
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: SKIP_BUILD
    ? {
        // El caller ya levanto el server. Solo nos aseguramos que
        // este vivo en `url`.
        command: `npx next start -p ${PORT}`,
        url: `${BASE_URL}/login`,
        timeout: 30_000,
        reuseExistingServer: true,
        stdout: "pipe",
        stderr: "pipe"
      }
    : {
        // Build + start. El primer `next build` tarda ~30-50s en
        // compilar 12 routes; `next start` arranca en ~1s. Total
        // ~50-60s antes de que /login responda.
        command: `npx next build && npx next start -p ${PORT}`,
        url: `${BASE_URL}/login`,
        timeout: 240_000,
        reuseExistingServer: !process.env.CI,
        stdout: "pipe",
        stderr: "pipe"
      }
});

