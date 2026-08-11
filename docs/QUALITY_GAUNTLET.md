# Quality Gauntlet — metodología + adopción

> **F7 fix (2026-08-11)**: este doc reemplaza los archivos
> `docs/files_TDD/04_GAUNTLET_DE_CALIDAD.md` y `docs/files_TDD/ADOPTION.md`
> que el proyecto referenciaba pero que **nunca se crearon** en el
> filesystem. La metodología y el estado de adopción están documentados
> acá en un solo lugar.
>
> **Audiencia**: devs + agentes que arrancan en el proyecto y necesitan
> entender qué compuertas están activas, cuáles están aspiracionales, y
> qué reglas de `arch:check` aplican a qué tipo de código.

## 1. Las 7 compuertas (metodología)

El "Quality Gauntlet" es el set de gates de calidad que el proyecto
aplica en cada PR. Cada compuerta es **una decisión de proceso**, no
una regla suelta — adoptarlas todas es lo que mantiene la deuda
técnica bajo control.

| # | Compuerta | Estado | Dónde vive |
|---|---|---|---|
| 1 | **Lint + tipos** | ✅ Activo (parcial — ESLint base pendiente) | `.eslintrc.quality.cjs` (stub) + `tsc --noEmit` en CI |
| 2 | **Arquitectura (fitness functions)** | ✅ Activo | `dependency-cruiser.config.cjs` + `npm run arch:check` |
| 3 | **Tests con coverage** | ✅ Activo (gate 45/65) | `vitest.config.ts` + `npm run test:coverage` |
| 4 | **BDD Gherkin (acceptance tests)** | ⏸ Aspiracional | Sin suite. Specs viven en `docs/SPEC.md` y `docs/SDD.md` |
| 5 | **Mutation testing (Stryker)** | ⏸ Aspiracional | Sin configurar |
| 6 | **Smoke DB (integration health)** | ⏸ Aspiracional | `npm run db:up` + `npm run db:migrate` están; falta el smoke check pre-PR |
| 7 | **Métricas continuas (latencia, error rate)** | ⏸ Aspiracional | Sin configurar. El `health-watchdog` existe en otro lado pero no mide el Quality Gauntlet |

> **Fase 1** (actual): compuertas 1-3 activas. **Fase 2-5**: 4-7 se
> activan progresivamente. El sprint S5 (2026-07-28) cerró la fase 1
> (arquitectura + coverage global). Siguiente milestone: subir coverage
> a 80/75 y activar mutation testing como signal secundario.

## 2. Reglas de arquitectura (compuerta 2 — el más concreto)

`npm run arch:check` corre `dependency-cruiser` con 6 reglas en
`dependency-cruiser.config.cjs`. **1 es error (rompe CI)**, **3 son
warn (visibles pero no bloquean)**, **2 son info (auditoría)**.

### Error (rompe CI)

1. **`no-pg-from-app-or-components`** — `pg` NUNCA se importa desde
   `app/**` ni `components/**`. La capa de data access es
   `api/repositories.ts` + `api/queries.ts` + `lib/db.ts`. Si lo rompés,
   el cliente recibe `pg` en el bundle y revienta el browser.

### Warn (aspiracional — subir a error cuando estén en 0)

2. **`components-must-not-touch-db`** — `components/**` no importa
   `lib/db`, `api/repositories`, ni `api/queries`. Si un componente
   necesita datos, los recibe por props.

3. **`djiag-scraper-not-imported-from-app`** — el cliente Playwright
   (`lib/djiag-korean-client`) y los fetchers HTTP (`lib/djiag-*-fetcher`)
   no se importan desde `app/**`. Son infraestructura de scraping. Excepción
   documentada: `lib/djiag-spatial-aggregator.ts`, `lib/djiag-health.ts`,
   y `lib/djiag-from-make/*` SÍ pueden usarse desde `app/api/**/route.ts`
   (lógica pura, no scraping).

4. **`app-pages-must-go-through-repositories`** — `app/**/page.tsx`
   (excepto `app/api/**`) no importa `getDb` directo de `lib/db`. Va
   por `api/repositories.ts` o `api/queries.ts`. Las routes en
   `app/api/**/route.ts` están exceptuadas (queries ad-hoc).

5. **`no-circular`** — sin dependencias circulares. Si aparece, resolver
   con extracción de tipos a archivo aparte o inversión de dependencias.

### Info (auditoría manual)

6. **`no-orphans`** — archivos sin referencias entrantes ni salientes.
   Suele ser código muerto. Severidad info — revisar antes de borrar.

## 3. Tests (compuerta 3)

`npm run test` corre Vitest. `npm run test:coverage` corre con
umbral de coverage.

### Umbrales activos (2026-08-11)

- **Global**: 45% lines / 65% branches (con `functions: 65`,
  `statements: 45`). Bumpeado a la baja en S8.6 (v2.5.3) por
  módulos con 0% coverage. Aspiración: 75/70 (no al revés).

### Reglas operativas

- Todo código nuevo en `lib/` viene con tests (happy path + 1 edge case).
- Tests TZ-fragiles con `toLocaleDateString` o `new Date()`: evitar
  asserting en strings exactos. Patrones en `lib/format.test.ts`.
- Un test que verifica `expect(x).toBeDefined()` no cuenta como test.

## 4. Cómo extender

Si una nueva compuerta se quiere agregar:
1. Documentar la regla en este doc.
2. Si es automatizable: agregar a `dependency-cruiser.config.cjs`,
   `vitest.config.ts`, o workflow en `.github/workflows/`.
3. Si es aspiracional: marcar con ⏸ y mover a fase 2-5.

Si una regla rompe con la realidad del repo:
1. PRIMERO arreglá la violación (refactor o delete).
2. Si la regla es incorrecta: escribir un ADR en `docs/` antes de
   tocarla en la config.
