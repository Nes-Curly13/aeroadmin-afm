# AGENTS.md — AeroAdmin AFM

> **Si sos un agente arrancando en este proyecto, leé este archivo primero.**
> Es el índice canónico. Todo lo importante está enlazado, no duplicado.

AeroAdmin AFM es la plataforma admin para el operador de drones cañero en Valle del Cauca, Colombia. Lee datos de la nube de DJI SmartFarm, los persiste en PostGIS, y los expone vía Next.js. Cliente: 1 piloto, ~1200 parcelas, ~16k vuelos, ~17k fumigaciones. Single contributor (1 dev).

**Estado actual (2026-09-02)**: sprint **S10 cerrado** (cleanup, audit, SVG Image, fix real de AppShell en /login). Master `ef97c69` (post-merge de PR #31 + cleanup de 4 unused files).

Sprints cerrados anteriores:
- **S5** (2026-07-28): migración a MapLibre + port del mockup V0
- **S6** (2026-07-29): polish del MapPageClient + sidebar de salud
- **S7 v2 + Fase 2** (2026-08-23): captura manual + perf (5 sub-PRs, master `36db3a3` → rebaseado a `da26b38`)
- **S8** (2026-08-29): E2E prod + Bloques A-G (5 fixes + bulk ops + cleanup)
- **S9** (2026-08-30): fumigaciones multi-parcela standalone (PR #25, `ac890a5`) — autoría del agente paralelo
- **S10** (2026-09-02): 4 sprints chicos de cleanup + fix real de AppShell en /login (PRs #27-#31)

S10 se desglosó en:
- **S10.1** (PR #27 `8fbd391`): bulk cleanup con knip — 46 unused exports + 14 types borrados (22 archivos, +7/-1130).
- **S10.2** (PR #28 `6750419`): 4 UI audit fixes — `fmtTime` TZ Bogota (hydration #418), branch `role==="viewer"` borrado, docstring drift, test helper huérfano.
- **S10.3** (PR #29 `10b1148`): `next.config.ts` habilita SVG en `next/image` con CSP `sandbox` + `dangerouslyAllowSVG: true`.
- **S10.4** (PR #30 `70c114c` + PR #31 `daee3c8`): AppShell ya NO se muestra en `/login`. PR #30 intentó route group `(public)/` (insuficiente en Next.js 16 — los route groups son children del root, no siblings). PR #31 lo arregló con `proxy.ts` que setea `x-pathname` header + check de `PUBLIC_PATHS` en `app/layout.tsx`. TDD estructural: `tests/app-layout-login-routing.test.ts` (5 tests). Cleanup post-merge en `ef97c69`: 4 unused files (`_middleware_disabled.ts`, `scripts/debug-login.mjs`, `scripts/test-login.mjs`, `scripts/screenshot-login-clean.mjs`) → `tmp-trash/s10-4-scripts/`.

**Deuda S10 anotada (separar en PRs futuros):**
- SVG 400 en `/_next/image?url=%2Fafm-logo-mark.svg` (cosmético, no bloquea login). El SVG tiene UTF-8 malformado + el `sandbox` CSP de `next.config.ts` hace que el Image optimizer rechace.
- Refactor a `app/(auth)/` route group: mover todas las pages autenticadas, poner el AppShell en `app/(auth)/layout.tsx`, remover el check de pathname en `app/layout.tsx`. El workaround `proxy.ts + x-pathname` es funcional pero no idiomático (~30 min de refactor).
- `pg` bump a `^8.20.0` en master (era `8.20.0` exacto) — el caret es para tolerar patches automáticos del lockfile.

**S10.5 candidates (próximos, en orden de prioridad):**
1. Post-merge cleanup de knip (ya hecho, ver S10.4).
2. Index en `dji_fumigaciones.product_id` (FK sin index desde S9) — migration con `CREATE INDEX CONCURRENTLY`. 1h.
3. Fix SVG 400 en Image optimizer. 1h.
4. Refactor a `app/(auth)/` route group. 2-3h.
5. Wire-up CSV/PDF exports con date range (quick-range buttons en /reportes). 2h.
6. Quality Gauntlet compuertas 4-7 (BDD Gherkin, StrykerJS, smoke DB, métricas continuas). ~½ día cada una.

---

## 1. Mapa rápido del repo

| Directorio / archivo | Qué vive ahí |
|---|---|
| `app/` | Next.js App Router (páginas server, route handlers, layouts). `app/page.tsx` es el dashboard. Las vistas con URL pública son: `app/page.tsx` (`/`), `app/geovisor/page.tsx` (`/geovisor`, vista estrella con mapa), `app/parcelas/page.tsx` (`/parcelas`, inventario), `app/parcelas/[id]/page.tsx` (detalle de parcela), `app/admin/parcels/page.tsx` (admin), `app/login/page.tsx` (auth). |
| `api/` | Capa de data access. `api/repositories.ts` (CRUD genérico) + `api/queries.ts` (queries pre-armadas con `djiParcelsQuery` y la proyección compartida). **Único punto permitido para queries de BD desde `app/`.** |
| `lib/` | Lógica de negocio pura, framework-agnostic. Aquí viven alertas, cadencia, agregaciones, parsers. |
| `lib/data.ts` | **V0 adapter** — port del mockup V0. Re-exporta `api/repositories` mapeado a las **shapes V0** (`DjiParcel`, `DjiFumigationV0`, `GeovisorPayload` etc., tipadas en `lib/types.ts`). Header del archivo lo explica. Marcado con `import "server-only"`. Re-exporta también las constantes V0 (`NOW`, `DRONE_MODELS`, `STATUS_META`) desde `lib/data-constants.ts`. **Las pages V0 (`app/geovisor`, `app/parcelas`) importan de acá, no de `api/repositories` directo.** |
| `components/` | React components. Reciben datos por props. **No importan `api/**` ni `lib/db.ts`.** |
| `components/ui/` | Primitives accesibles propios (patrón shadcn-style): `badge`, `button`, `card`, `field-select`, `input`, `progress`, `select`, `separator`, `slider`, `table`, `tabs`, `tooltip`. Preexistentes: `page-header`, `kpi-pill`, `filter-sidebar`, `metric-card`, `bento-grid`, `empty-state`, `pagination`, `scrollable-panel`. Ver `docs/TDD.md` §2. |
| `components/geovisor/` | Vista V0 del geovisor: `geovisor-client.tsx` (componente interactivo "use client"), `time-range.tsx` (slider con histograma). Estas son las contrapartes V0 de los archivos que en S5 viven en `components/map/`. |
| `components/map/` | Wrappers del mapa (MapLibre). Hoy contiene `geo-map.tsx` (un único wrapper, MapLibre GL JS directo). Los otros wrappers que la auditoría previa listaba (`map-page-client`, `maplibre-view`, `map-filter-sidebar`, etc.) NO existen con esos nombres — la vista principal del mapa usa `components/geovisor/geovisor-client.tsx` + `components/map/geo-map.tsx`. |
| `components/parcels/` | Inventario y detalle de parcela: `parcels-table.tsx`, `parcel-map.tsx`, `fumigation-timeline.tsx`, `interval-chart.tsx`. |
| `components/dashboard/` | Paneles del dashboard (`/`): `kpi-card`, `compliance-panel`, `health-panel`, `monthly-chart`, `recent-activity`. |
| `scripts/` | CLI del pipeline DJI (scrape, upsert, backfill, refresh). Se ejecutan vía `npm run`. |
| `db/migrations/` | Migrations SQL. **A partir del sprint de reconciliación, todas las migrations viven acá** (25 archivos que antes vivían en `supabase/migrations/` fueron movidos con `git mv`). El script `npm run db:migrate` apunta a este directorio. `supabase/` queda solo con `config.toml` + `seed.sql`. |
| `supabase/` | Config de Supabase (`config.toml` + `seed.sql`). Las migrations YA NO viven acá. |
| `tests/` | Unit + integration tests de Vitest. `tests/e2e/` es para Playwright (separado). |
| `djiag_exports/` | Output crudo del scraper. Gitignored. |
| `docs/` | Docs de producto, arquitectura, y methodology. **El mockup V0 vive en `docs/v0-2026-07-28/`** (movido desde `docs/fumigation-management-dashboard/` por confundir a `arch:check` y nuevos devs — está marcado como REFERENCIA HISTÓRICA, no se ejecuta). Los blueprints de Make.com viven en `docs/make-blueprints/`. |
| `make/` | (carpeta en desuso). `make/records.txt` quedó vacío. Los `.make` originales se movieron a `docs/make-blueprints/`. |

**Documentos clave que tenés que leer antes de tocar nada:**

1. `docs/SDD.md` — diseño de producto (qué es, para quién, qué no es). **Sustituye al SDD implícito que vivía acá.**
2. `docs/TDD.md` — diseño técnico (cómo está implementado, patrones de UI, MapLibre setup, state derivado).
3. `docs/ARCHITECTURE.md` — de dónde vienen los datos, cómo fluyen, qué hace cada capa.
4. `docs/SPEC.md` — qué hace el producto, roles, vistas, KPIs.
5. `docs/STACK.md` — versiones, decisiones de stack, gotchas.
6. `docs/V0_ADAPTATION.md` — bitácora del sprint S5/S6 (qué se copió del mockup V0, qué se decidió distinto).
7. `docs/FUMIGATION_CADENCE.md` — la regla de negocio más sensible (cuándo una parcela necesita fumigación).
8. `docs/QUALITY_GAUNTLET.md` — la metodología de calidad (7 compuertas) y su estado de adopción.
9. `docs/DJI_SCRAPER.md` + `docs/DJI_CLOUD_API.md` — el scraper (la parte más frágil).

> Este AGENTS.md hace de `03_MEJORES_PRACTICAS_AGENTES.md` (prácticas para agentes). `docs/SDD.md` y `docs/TDD.md` son los `01` y `02` formales (escritos en el sprint S5, 2026-07-28).

---

## 2. Las reglas duras (no negociables)

Si una PR rompe estas reglas, el CI la bloquea. No las negocies en el PR — arreglá la violación o escribí un ADR nuevo en `docs/`.

### R1. Acceso a datos

- **`pg` NUNCA se importa desde `app/` ni `components/`.** La capa de data access es `api/repositories.ts` + `api/queries.ts` + `lib/db.ts`. Si lo rompés, el bundle del cliente lleva `pg` adentro y revienta el browser.
- **Server Components y route handlers** SÍ importan `api/repositories.ts` y `api/queries.ts` — es el patrón Next.js. Esa no es violación.
- **`components/` NUNCA importa `api/**` ni `lib/db.ts`.** Los componentes reciben datos por props.
- **V0 adapter (`lib/data.ts`)**: las pages del V0 (`app/geovisor`, `app/parcelas`, `app/parcelas/[id]`) importan de `lib/data.ts`, que a su vez importa de `api/repositories.ts` y `api/queries.ts`. Esto centraliza el mapeo project → V0 shapes. `lib/data.ts` está marcado con `import "server-only"` y no se bundlea en el cliente.

Verificado por: `dependency-cruiser` (fitness function de arquitectura). Comando: `npm run arch:check`. Config: `dependency-cruiser.config.cjs` raíz.

### R2. Scraping y fetchers de DJI

- El cliente Playwright (`lib/djiag-korean-client.js`) y los fetchers HTTP (`lib/djiag-*-fetcher.js`) son **infraestructura de scraping**.
- NUNCA se importan desde `app/**`. Se invocan desde `scripts/` (CLI pipeline) o desde wrappers en `api/`.
- **Excepción:** `lib/djiag-spatial-aggregator.ts`, `lib/djiag-health.ts`, y `lib/djiag-from-make/*` SÍ pueden usarse desde `app/api/**/route.ts` — son lógica pura / agregación, no scraping.

### R3. Tests

- **Todo código nuevo en `lib/` viene con tests** que cubren al menos el happy path + 1 edge case obvio.
- **Coverage global**: el umbral activo en `vitest.config.ts` es **45% lines / 65% branches** (con `functions: 65`, `statements: 45`). El 75/70 histórico está documentado como aspiración — bumpear al subir el piso, NO al revés. La doc previa decía 75/70 sin reflejar que el gate se bajó en S8.6 (v2.5.3, 2026-08-04) por módulos con 0% coverage (ver comentario en `vitest.config.ts:65-79`).
- Los tests de integración con BD (los que dependen de `dji_flights.parcel_id`, `dji_fumigations.flight_ids`, etc.) van en `tests/e2e/` o en archivos marcados con `.integration.test.ts` y excluidos de la cobertura unitaria.
- **Un test que verifica `expect(x).toBeDefined()` no cuenta como test.** Si Stryker sobrevive al mutante, escribí un test que verifique el valor real.

### R4. Fechas y TZ

- **Toda fecha que sale al usuario** pasa por `lib/format.ts` (`toDateString`, `formatToDateString`). TZ = `America/Bogota`.
- Los tests con `toLocaleDateString` o `new Date()` son TZ-fragiles — evitá asserting en strings exactos. Patrones en `lib/format.test.ts`.

### R5. Auth y roles

- Roles: `admin` y `viewer`. Helper: `getViewerRole()` en `lib/auth/role.ts`. Display: `lib/auth/role-display.ts`.
- **PII y secrets NUNCA en logs, comments, ni fixtures de test.** El fixture `tests/fixtures/djiag-live/` contiene responses reales — no commitear más allá de los ya sanitizados.

### R6. Cambios de schema

- Toda migration nueva va en `db/migrations/` con timestamp `YYYYMMDDHHMMSS_*.sql`.
- Aplicar local con `npm run db:migrate` (corre `scripts/apply-pending-migrations.js`, que apunta a `db/migrations/`).
- Después de un cambio de schema, correr `npm test` (los tests de repositories validan shape).
- Las migrations ya NO viven en `supabase/migrations/` (ese directorio está vacío desde el sprint de reconciliación 2026-07-29). `supabase/` queda solo para `config.toml` y `seed.sql`.

---

## 3. Comandos principales

| Acción | Comando |
|---|---|
| Levantar DB local | `npm run db:up` (docker compose) |
| Aplicar migrations | `npm run db:migrate` |
| Dev server | `npm run dev` (puerto default 3000) |
| Tests unit + integration (sin coverage) | `npm test` |
| Tests con coverage (gate de umbrales) | `npm run test:coverage` |
| Tests E2E (Playwright) | `npm run e2e` (puerto 3001) |
| E2E solo auth | `npm run e2e:auth` |
| E2E solo map | `npm run e2e:map` |
| Architecture fitness check | `npm run arch:check` |
| Architecture report (warn+info) | `npm run arch:report` |
| Pipeline DJI completo | `npm run pipeline:djiag` |
| Pipeline DJI (dry run) | `npm run pipeline:djiag:dry` |
| Build producción | `npm run build` |
| Refresh fumigations (cron) | `npm run refresh:fumigations` |

---

## 4. Cómo trabaja un agente en este repo

### Antes de tocar nada

1. **Leé** `docs/ARCHITECTURE.md` (10 min). Si no lo leíste, no sabés dónde meter el código.
2. **Buscá** si ya hay algo similar: `grep -r "<término>" lib/ api/ app/ components/`. La abstracción probablemente ya existe.
3. **Chequeá** que el branch no esté en un sprint activo. Si está, esperá o trabajá en un sub-branch.

### Cuando hacés un cambio

1. **Empezá con un test.** Si el módulo está en `lib/`, escribí el test antes o junto con la implementación. Vitest es el runner.
2. **Mantené la cobertura.** No bajes el coverage global. Si lo bajás, escribí tests en el mismo PR.
3. **Corré `npm run arch:check` y `npm run test:coverage` antes de commit.** Ambos deben pasar en verde.
4. **Si tocás schema**, agregá la migration a `db/migrations/` y mencioná en el commit.
5. **Si tocás un módulo crítico** (`lib/alerts.ts`, `lib/fumigation-cadence.ts`, `lib/dji-flights-aggregate.ts`), escribí un test que falle si alguien cambia el comportamiento esperado (no solo `toBeDefined`).

### Cuando terminás un cambio

1. Mensaje de commit en presente, español o inglés, scoped:
   - `feat(map): v1.9 — clustering de markers en zoom bajo`
   - `fix(auth): role-gate rompe con role=undefined`
   - `chore(deps): upgrade next 16.2.4 → 16.3.0`
   - `docs: documentar cadencia de arroz en FUMIGATION_CADENCE.md`
   - `chore(docs): reconcile drift — V0 mockup → docs/v0-2026-07-28/, migrations → db/migrations/, make/ → docs/make-blueprints/`
2. Si el cambio afecta el comportamiento de un operador, actualizá `docs/SPEC.md` o el doc relevante en el mismo PR.
3. Si descubrís un agujero grande (bug latente, abstracción faltante), creá un TODO en el issue tracker — no lo arregles silenciosamente en un PR no relacionado.

### Lo que NO hacés

- **No instalar dependencias sin preguntar.** Si pensás que necesitás una lib nueva, proponé en el chat antes de correr `npm install`.
- **No borrar tests** sin reemplazarlos por otros que cubran el mismo comportamiento. Si un test es flaky, arreglarlo, no borrarlo.
- **No mergear con CI rojo**, ni siquiera con `continue-on-error`. Si el CI falló por algo transitorio, re-correlo.
- **No escribir fixtures que contengan datos reales del operador.** Usá los de `tests/fixtures/` que ya están sanitizados o inventá uno nuevo con la misma forma.

---

## 5. Stack y versiones (resumen)

- **Runtime**: Node 22.14.0, npm 11.2.0
- **Framework**: Next.js 16.2.4 + React 19.2.5
- **DB**: Postgres 16 + PostGIS 3.4 (local: docker; prod: Supabase pooled URL puerto 6543)
- **Auth**: NextAuth v5 (beta.31)
- **Maps**: **MapLibre GL JS 4.7.1** (Leaflet + react-leaflet eliminados en S5; la nota sobre "6.0" del sprint de migración es obsoleta — el adapter terra-draw@1.32.x tiene peer dep `maplibre-gl: ">=4"` así que 4.7.1 es la versión real y estable. NO bumpear a 6.x sin antes validar compat del adapter)
- **Primitives UI**: propios en `components/ui/`, patrón shadcn-style con `cn()` (clsx + tailwind-merge). Adoptan `@base-ui/react 1.6` como base para 10 primitives (badge, button, input, progress, select, separator, slider, tabs, tooltip + helpers `merge-props`/`use-render`); se reemplazó shadcn CLI por primitives propios sobre `@base-ui/react`.
- **Tests**: Vitest 3.2.4 + @vitest/coverage-v8 + Playwright 1.61.1
- **TypeScript**: 5.9.3, `strict: true`, sin `any` explícito
- **Scraper**: Playwright headless contra DJI SmartFarm Web (Coreano via `accept-language: zh-CN,zh`)

Detalles y gotchas por capa en `docs/STACK.md`.

---

## 6. Definición de "listo" para un PR

Un PR de un agente está listo para merge cuando:

- [ ] `npm run arch:check` pasa (0 errors).
- [ ] `npm run test:coverage` pasa con el umbral global vigente.
- [ ] Si tocaste un módulo de los críticos (`lib/alerts.ts`, `lib/fumigation-cadence.ts`, `lib/dji-flights-aggregate.ts`, `lib/djiag-spatial-aggregator.ts`): coverage del archivo no bajó.
- [ ] Si tocaste schema: la migration está en `db/migrations/` y aplicada localmente.
- [ ] Si tocaste un doc de comportamiento (`docs/SPEC.md`, `docs/FUMIGATION_CADENCE.md`): el diff se ve bien.
- [ ] No agregaste dependencias sin avisar en el chat.
- [ ] CI en GitHub Actions pasó todos los jobs.

> **Nota 2026-07-28**: las compuertas 4-7 del Gauntlet (BDD Gherkin, mutation testing, smoke DB, métricas continuas) están documentadas pero **no activas todavía**. Ver `docs/QUALITY_GAUNTLET.md` para el roadmap. Esto es el sprint de fase 1 (arquitectura + coverage global). Las fases 2-5 se activan progresivamente.

---

## 7. Cuando algo falla y no sabés por qué

1. **Tests fallan** → corré `npx vitest run <archivo>` para aislar. Si es flaky, re-corré 2-3 veces.
2. **Build falla** → corré `npm run build` local y mirá el output completo. Si es un error de TypeScript, `npx tsc --noEmit --pretty`.
3. **DB connection fails** → revisá `DATABASE_URL` en `.env.local`. Si es Supabase, usá la **pooled URL** (puerto 6543), no la direct (puerto 5432 = solo IPv6).
4. **Scraper falla** → `docs/DJI_SCRAPER.md` § "Troubleshooting". Casi siempre es: storage state expirado, DJI cambió schema, o rate limit.
5. **Coverage baja de golpe** → corré `npx vitest run --coverage` y mirá qué archivo perdió cobertura. Probablemente código nuevo sin test.

---

**Última actualización:** 2026-09-02 (sprint S10 cerrado — knip cleanup + UI audit + SVG Image + fix real de AppShell en /login. PRs #27-#31 mergeados, master `ef97c69`).
**Mantenedor:** @agFab (single contributor).
