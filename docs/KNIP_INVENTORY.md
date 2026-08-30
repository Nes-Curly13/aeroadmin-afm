# Knip inventory — Bloque G Sprint S8

> **Fecha**: 2026-08-29
> **Comando**: `npx knip --no-exit-code`
> **Total archivos no usados**: 136 (vs 106 del runbook original — hay 30 más de Sprints 5-8)
> **Total exports no usados**: 84
> **Total deps no usadas**: 1 (`@types/bcryptjs` en `package.json:58:6`)
> **Total deps no listadas**: 1 (`server-only` en `lib/data.ts:28:8`)

## Resumen por categoría

| Categoría | Cantidad | Acción recomendada |
|---|---|---|
| **A. `scripts/_archive/2026-Q1-Q2-debug/*`** | 78 | ✅ Borrar (histórico, no se ejecuta) |
| **B. `lib/_archive/djiag-from-make-2026-08/*`** | 1 | ✅ Borrar (archivo suelto de carpeta archivada en S5) |
| **C. `tmp-prod-test/*`** | 29 | ✅ Borrar (scripts históricos de debugging E2E). Excepción: ver §Excepciones |
| **D. `scripts/*` one-offs** | 26 | 🟡 Revisar uno por uno — la mayoría son utilitarios de migración/debug antiguos |
| **E. UI primitives no usados** | 6 | ✅ Borrar (no referenciados en `app/` ni en `components/`) |
| **F. `components/geovisor/time-range.tsx`** | 1 | 🟡 Mantener (referenciado en comment de `geovisor-client.tsx:476` como "listo para usar"). Considerar borrarlo si no se va a usar pronto. |
| **G. `components/fumigations/product-picker.tsx`** | 1 | 🟡 **WIRE UP**: existe el componente y la API pero el `RegisterFumigationForm` no lo usa. Es el siguiente paso lógico. |
| **H. `scrape_djiag_perflight.js`** (raíz) | 1 | 🟡 Revisar (scrape legacy, posiblemente reemplazado por el pipeline actual). |
| **I. `playwright.prod.config.ts`** | 1 | 🟡 Mantener (no usado en `package.json` scripts, pero es útil para E2E contra prod. Considerar agregar `npm run e2e:prod` script). |
| **J. `.eslintrc.quality.cjs`** | 1 | 🟡 Revisar (es un eslint config para quality gates. Probablemente quedó obsoleto tras la simplificación del Quality Gauntlet). |
| **K. Unused exports en `api/repositories.ts`** | ~30 | 🟡 Considerar borrar (muchas son funciones legacy de la v0; verificar con git log antes). |
| **L. Unused exports en `lib/`** | ~30 | 🟡 Revisar caso por caso (algunos son helpers de djiag-* que el scraper activo ya no usa). |
| **M. `lib/_archive/*`** | (mezclado en B) | — |

**Total borrable sin riesgo**: 78 + 1 + 29 + 6 = **114 archivos** (84% de los 136 reportados).
**Total a revisar**: 22 (muchos son de Sprints tempranos, baja probabilidad de uso actual).

## Excepciones (NO borrar)

Estos archivos son importantes aunque knip no los detecte:

### `tmp-prod-test/22-real-verify.js`
Verifica el fix de login (Bloque A) en prod. Útil para regression testing rápido.

### `tmp-prod-test/27-bloque-e-verify.js`
Verifica la API de products (Bloque E) en prod. Útil para regression testing.

### `components/fumigations/product-picker.tsx`
Crítico para el siguiente sprint (wire-up del ProductPicker en RegisterFumigationForm). No borrar.

### `components/geovisor/time-range.tsx`
Marcado como "listo para usar" en `geovisor-client.tsx:476`. No borrar hasta confirmar que no se va a usar.

### `playwright.prod.config.ts`
Útil para correr E2E contra prod. Considerar agregar `package.json` script `e2e:prod` que lo use.

## Unused exports — análisis (84)

### Grupo 1: `api/repositories.ts` (~30 exports)

Funciones que knip reporta como no usadas pero probablemente lo son via `lib/data.ts` (que re-exporta varias):

- `getParcelsSummary` (line 325) — verificar si `lib/data.ts:886` (`getClients`) lo usa
- `getFumigationCategories` (line 1912) — verificar uso
- `getFumigatedParcelIdsSince` (line 2057) — verificar uso
- `getFumigationsSummary` (line 2106) — verificar uso
- `getFumigationsByMonth` (line 2183) — verificar uso
- `getFumigationsForMap` (line 2271) — verificar uso
- `setFumigationCadence` (line 2564) — verificar uso
- `getUpcomingFumigations` (line 2612) — verificar uso
- `getOverdueParcels` (line 2633) — verificar uso
- `getFlights` (line 2662) — verificar uso
- `getAlerts` (line 2704) — verificar uso
- `getDashboardMetrics` (line 2711) — verificar uso
- `getFlightPointsForMap` (line 2743) — verificar uso
- `getActivityComparison` (line 2858) — verificar uso
- `getFumigationDbStats` (line 2902) — verificar uso
- `getOrphanFumigations` (line 2967) — verificar uso
- `linkFumigationToParcel` (line 3023) — verificar uso
- `getFumigationYearlySummary` (line 3130) — verificar uso
- `getFumigationFlightTrace` (line 3218) — verificar uso
- `getFumigationYearTotals` (line 3348) — verificar uso

**Acción**: PR aparte con verificación manual de cada uno (algunos son usados via `lib/data.ts` re-exports; otros son genuinamente dead code).

### Grupo 2: `lib/data.ts` (~10 exports)

- `complianceStatus` (line 52) — `lib/data.ts` re-export, verificar
- `getSchedules` (line 714) — verificar uso en pages
- `getClients` (line 886) — verificar uso
- `getFarms` (line 891) — verificar uso

### Grupo 3: `lib/djiag-*` (~15 exports)

- `loadEnvFromLocalFile`, `KOREAN_HOST`, `DEFAULT_BASE` (lib/djiag-korean-client.js) — legacy del scraper inicial
- `MS_PER_SEC` (lib/djiag-fumigations-fetcher.js:263) — helper
- `computeDelay`, `defaultShouldRetry`, `DEFAULT_MAX_ATTEMPTS`, etc. (lib/djiag-backoff.js) — retry helpers
- `formatRemaining`, `DEFAULT_FAILURE_THRESHOLD`, etc. (lib/djiag-circuit-breaker.js) — circuit breaker
- `STALE_THRESHOLD_HOURS` (lib/djiag-health-types.ts + lib/djiag-health.ts) — duplicado en 2 archivos
- `LANDS_CLUSTER_QUERY` (lib/djiag-graphql-queries.js) — GraphQL query legacy

**Acción**: Revisar si los scripts del pipeline DJI (`scripts/`) todavía los importan. Si no, son removibles en una limpieza del pipeline.

## Plan de acción Bloque G

### Fase 1 — Limpieza segura (1 PR)
- Borrar `scripts/_archive/2026-Q1-Q2-debug/*` (78)
- Borrar `lib/_archive/djiag-from-make-2026-08/*` (1)
- Borrar `components/ui/{progress,select,separator,slider,tabs,tooltip}.tsx` (6)
- Mover `tmp-prod-test/*` a `tmp-trash/` con `mavis-trash` (excepto los 2 marcados como excepciones)

### Fase 2 — Wire-up + cleanup adicional (PRs separados)
- PR-A: Wire-up `ProductPicker` en `RegisterFumigationForm` (sustituye el `<input>` de `product_used` por el picker)
- PR-B: Decidir destino de `time-range.tsx` (¿borrar? ¿usar en geovisor?)
- PR-C: Decidir destino de `playwright.prod.config.ts` (¿agregar `e2e:prod` script?)
- PR-D: Limpiar `lib/djiag-*` unused exports
- PR-E: Limpiar `api/repositories.ts` unused exports

### Fase 3 — Quality Gauntlet re-activación
- Después de Fase 1+2, `npx knip` debería bajar de 136 a < 30 archivos.
- Recién ahí `quality-gauntlet-weekly.yml` puede correr verde (pre-requisito 1 cumplido del runbook).
- Quedan 2 pre-requisitos: fix `lib/djiag-circuit-breaker.js:245` + instalar StrykerJS.

## Config knip

Para Fase 1, crear `knip.json` con exclusiones justificadas:

```json
{
  "ignore": [
    "tmp-prod-test/22-real-verify.js",
    "tmp-prod-test/27-bloque-e-verify.js",
    "components/fumigations/product-picker.tsx",
    "components/geovisor/time-range.tsx",
    "playwright.prod.config.ts",
    ".eslintrc.quality.cjs"
  ]
}
```

Aplicar el config reduce el reporte de 136 a ~130 archivos (los 6 falsos positivos excluidos), pero el borrado de los 114 reales es lo que baja el número a 16.

## Métricas esperadas post-Fase 1

- `npx knip --no-exit-code` reportaría ~22 archivos (los de Fase 2 sin resolver).
- `quality-gauntlet-weekly.yml` puede correr el job `knip` por primera vez sin fallar.
- `git status` queda limpio de los 78 + 29 + 6 + 1 = 114 archivos.
