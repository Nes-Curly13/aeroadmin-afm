import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname)
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    css: false,
    // M1 (2026-06-28): excluimos tests/e2e/** del scan de vitest. Esos
    // tests son para Playwright (que tiene su propio runner). Vitest los
    // importaba igual por la convencion tests/ y reventaba con "test.describe
    // is not a function".
    exclude: ["**/node_modules/**", "**/.next/**", "tests/e2e/**"],
    // Componentes con Next/Image y Leaflet demoran en transform bajo concurrencia.
    // Subimos el timeout default para evitar flakiness cuando hay 34 archivos en suite.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Componentes de Next/Image y Map (Leaflet) usan APIs de browser que
    // no necesitamos ejercitar en tests unitarios.
    server: {
      deps: {
        inline: ["@testing-library/react"]
      }
    }
  }
});
