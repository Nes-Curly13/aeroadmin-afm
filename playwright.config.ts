import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — M1 (2026-06-28).
 *
 * Setup:
 *   - Levanta `next dev` en puerto 3001 (no 3000 — evita pisar dev local).
 *   - Auto-seedea el usuario E2E via `scripts/seed-admin-user.js` antes de
 *     arrancar la suite (`globalSetup`), con email `e2e@aeroadmin.local`.
 *   - Usa Chromium + Firefox (los mas comunes de los operadores).
 *   - Skip WebKit (Safari quirks exagerados; no aporta en Opcion A).
 *
 * Decisiones:
 *   - Tests NO dependen de la BD scrapeada de DJI (los 7050 flights).
 *     Para que sean reproducibles en CI/test/local, validamos shape
 *     (KPIs visibles, no valores exactos).
 *   - Headless siempre. localStorage/auth cae al server-side cookie.
 *   - `webServer.timeout = 90_000` porque el primer `next dev` tarda
 *     ~30-40s en compilar y servir la home.
 *
 * Variables:
 *   - BASE_URL (default http://localhost:3001) — si querés apuntar a
 *     staging o prod, override con `BASE_URL=...`.
 *   - E2E_USER_EMAIL / E2E_USER_PASSWORD — para no hardcodear en el repo.
 */

const PORT = 3001;
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Sprint M1: secuencial para no pelearse con la BD seeded
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: process.env.CI ? "list" : "list",
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
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
  webServer: {
    // Sprint M1: usamos build + start en lugar de dev. Razon: Turbopack
    // (next dev) panic con 'Next.js package not found' cuando el bundle
    // incluye bcryptjs + middleware Edge. `next build` + `next start`
    // es estable aunque tarda ~30s mas en arrancar.
    command: `npx next build && npx next start -p ${PORT}`,
    url: `${BASE_URL}/login`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe"
  }
});
