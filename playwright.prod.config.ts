// Playwright config alternativo para correr E2E contra Vercel (prod).
// Deshabilita el `webServer` (que intentaria levantar `next start` local)
// y deja que BASE_URL apunte a la URL externa.
//
// Uso:
//   BASE_URL=https://aeroadmin-afm1.vercel.app \
//   E2E_USER_EMAIL=admin@aeroadmin.local \
//   E2E_USER_PASSWORD='xxx' \
//   DATABASE_URL='postgresql://...' \
//   npx playwright test --config=playwright.prod.config.ts
//
// No commitear este archivo (es solo para runs contra prod).

import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

export default defineConfig({
  ...baseConfig,
  testDir: baseConfig.testDir ?? "./tests/e2e",
  reporter: "list",
  use: {
    ...baseConfig.use,
    baseURL: process.env.BASE_URL ?? "https://aeroadmin-afm1.vercel.app"
  },
  // Override: NO levantar webServer local cuando BASE_URL es externo.
  webServer: undefined,
  // Mantener globalSetup para que re-seedee el user en la DB remota.
  globalSetup: baseConfig.globalSetup
});
