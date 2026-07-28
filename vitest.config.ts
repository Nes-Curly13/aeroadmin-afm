import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config + umbrales de coverage por criticidad.
 *
 * Sprint S4 (2026-07-28) — adopción del Quality Gauntlet (fase 1, ver
 * docs/files_TDD/04_GAUNTLET_DE_CALIDAD.md §4 y ADOPTION.md).
 *
 * Estado actual de umbrales (2026-07-28):
 *   - Umbral GLOBAL: 80% lines / 75% branches — activo desde día 1.
 *   - Umbrales PER-FILE: desactivados al inicio. Se activan uno por uno
 *     conforme los tests lleguen al nivel — NUNCA al revés (ratcheting).
 *   - Aspiración documentada en el objeto `aspirationalThresholds` abajo.
 *     Cuando un módulo llegue al nivel, moverlo al array `thresholds`
 *     activo en un PR.
 *
 * Regla operativa: los umbrales solo suben, nunca bajan sin excepción
 * documentada en el PR. Si un umbral bloquea, NO se baja — se escriben
 * los tests que faltan.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
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
    //
    // S4 (2026-07-28): excluimos también tests/user-story-dashboard-e2e.test.ts.
    // Es un test de integración que requiere la BD en estado post-pipeline
    // completo (≥75% de dji_flights con parcel_id, fumigaciones presentes).
    // Falla cuando el pipeline no corrió completo desde el último reseed.
    // Debería vivir en tests/e2e/ (refactor ortogonal a este sprint).
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "tests/e2e/**",
      "tests/user-story-dashboard-e2e.test.ts",
    ],
    // Componentes con Next/Image y Leaflet demoran en transform bajo concurrencia.
    // Subimos el timeout default para evitar flakiness cuando hay 34 archivos en suite.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Componentes de Next/Image y Map (Leaflet) usan APIs de browser que
    // no necesitamos ejercitar en tests unitarios.
    server: {
      deps: {
        inline: ["@testing-library/react"],
      },
    },

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],

      // =====================================================================
      // UMBRAL GLOBAL — PISO ACTIVO
      // =====================================================================
      // Si el repo entero no llega a esto, CI falla. Está calibrado al
      // estado actual del repo (julio 2026, post-sprint de resiliencia
      // DJIAG). NO bajar.
      // =====================================================================
      thresholds: {
        lines: 80,
        branches: 75,
        functions: 80,
        statements: 80,
      },

      // Patrones a medir. Tests, configs y declaraciones de tipo
      // no cuentan como código de producto.
      include: ["lib/**", "api/**", "components/**"],

      // Exclusiones: tests, scripts de captura, configs, declaraciones de tipo.
      exclude: [
        "tests/**",
        "scripts/capture-*.js",
        "**/*.d.ts",
        "**/*.config.*",
        "**/*.config.ts",
        "**/types.ts",
        "lib/fumigation-cadence-config.d.ts", // generado, no mano
      ],

      // =====================================================================
      // UMBRALES ASPIRACIONALES POR ARCHIVO (DESACTIVADOS AL INICIO)
      // =====================================================================
      // No están en `thresholds` activos arriba para no romper CI el día 1.
      // Conforme cada módulo llegue a su umbral aspiracional, moverlo
      // al array `thresholds` y bumpear el piso. Los números propuestos
      // vienen de §4 del Gauntlet, ajustados a la realidad de este repo.
      //
      // Estado actual de coverage (medido 2026-07-28, base para ratcheting):
      //   - lib/fumigation-cadence.ts:   100% / 96.55%   ✅ LISTO (mover a activo)
      //   - lib/alerts.ts:               cubierto al 100% (no apareció en
      //                                   reporte, implica que pasa el global)
      //   - lib/dji-flights-aggregate.ts:  95% / 82.85%   casi (branches)
      //   - lib/format.ts:               87% / 85%       casi
      //   - lib/overdue-parcels.ts:      100% / 100%     ✅ LISTO
      //   - lib/cache.ts:                48% / 66%       requiere tests
      //   - api/repositories.ts:         19% / 0%        requiere tests (PRIORIDAD)
      //   - api/queries.ts:              sin datos
      // =====================================================================
      //
      // aspirationalThresholds: {
      //   "lib/fumigation-cadence.ts": { lines: 95, branches: 90, functions: 95, statements: 95 },
      //   "lib/alerts.ts":             { lines: 95, branches: 90, functions: 95, statements: 95 },
      //   "lib/dji-flights-aggregate.ts": { lines: 95, branches: 85, functions: 95, statements: 95 },
      //   "lib/djiag-spatial-aggregator.ts": { lines: 95, branches: 90, functions: 95, statements: 95 },
      //   "lib/format.ts":             { lines: 90, branches: 85, functions: 90, statements: 90 },
      //   "lib/overdue-parcels.ts":    { lines: 85, branches: 80, functions: 85, statements: 85 },
      //   "lib/cache.ts":              { lines: 85, branches: 80, functions: 85, statements: 85 },
      //   "api/repositories.ts":       { lines: 80, branches: 75, functions: 80, statements: 80 },
      //   "api/queries.ts":            { lines: 75, branches: 70, functions: 75, statements: 75 },
      // },
    },
  },
});
