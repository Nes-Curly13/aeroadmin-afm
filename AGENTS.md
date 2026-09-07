# AGENTS.md — AeroAdmin AFM

> **Si sos un agente arrancando en este proyecto, leé este archivo primero.**
> Es el índice canónico. Todo lo importante está enlazado, no duplicado.

AeroAdmin AFM es la plataforma admin para el operador de drones cañero en Valle del Cauca, Colombia. Lee datos de la nube de DJI SmartFarm, los persiste en PostGIS, y los expone vía Next.js. Cliente: 1 piloto, ~1200 parcelas, ~16k vuelos, ~17k fumigaciones. Single contributor (1 dev).

**Estado actual (2026-09-06)**: sprints **S11+ cerrado (V2 plan completo)** + **Quality Gauntlet #1 (zod) cerrado** + **Sprint QA closeout cerrado** (PRs #60-#66). Master `6ea1d20` (post-merge de PR #65 geovisor simplify; PR #66 reportes tabs en CI). Cobertura de tests ~2070+ verde, arch:check 0 errors, tsc 0 errors.

Sprints cerrados anteriores:
- **S5** (2026-07-28): migración a MapLibre + port del mockup V0
- **S6** (2026-07-29): polish del MapPageClient + sidebar de salud
- **S7 v2 + Fase 2** (2026-08-23): captura manual + perf (5 sub-PRs, master `36db3a3` → rebaseado a `da26b38`)
- **S8** (2026-08-29): E2E prod + Bloques A-G (5 fixes + bulk ops + cleanup)
- **S9** (2026-08-30): fumigaciones multi-parcela standalone (PR #25, `ac890a5`) — autoría del agente paralelo
- **S10** (2026-09-02): 4 sprints chicos de cleanup + fix real de AppShell en /login (PRs #27-#31)
- **S11+ (V2 plan)** (2026-09-05/06): 14 PRs del refactor V2 (PRs #40-#55) — ver `docs/PLAN-FUMIGACIONES-V2.md`
- **Quality Gauntlet #1 (zod)** (2026-09-06): 3 PRs de adopción zod (PRs #56-#58) — tests anti-Bug-2 + request bodies + FormState
- **QA closeout** (2026-09-06): 7 PRs del feedback del operador fumigador (PRs #60-#66) — ver "QA closeout" abajo

S10 se desglosó en:
- **S10.1** (PR #27 `8fbd391`): bulk cleanup con knip — 46 unused exports + 14 types borrados (22 archivos, +7/-1130).
- **S10.2** (PR #28 `6750419`): 4 UI audit fixes — `fmtTime` TZ Bogota (hydration #418), branch `role==="viewer"` borrado, docstring drift, test helper huérfano.
- **S10.3** (PR #29 `10b1148`): `next.config.ts` habilita SVG en `next/image` con CSP `sandbox` + `dangerouslyAllowSVG: true`.
- **S10.4** (PR #30 `70c114c` + PR #31 `daee3c8`): AppShell ya NO se muestra en `/login`. PR #30 intentó route group `(public)/` (insuficiente en Next.js 16 — los route groups son children del root, no siblings). PR #31 lo arregló con `proxy.ts` que setea `x-pathname` header + check de `PUBLIC_PATHS` en `app/layout.tsx`. TDD estructural: `tests/app-layout-login-routing.test.ts` (5 tests). Cleanup post-merge en `ef97c69`: 4 unused files → `tmp-trash/s10-4-scripts/`.

S11+ (V2 plan) se desglosó en:
- **Fase 1** (PR #42 `f2d59e5`): wizard 3 steps en `/fumigaciones/nueva` con map-after-selection. UX refactor — sin cambios al data model. 6 nuevos tests (`tests/components/admin/fumigations/new-fumigation-page-client.test.tsx`).
- **Fase 3.A** (PR #44 `23fa4b1`): schema `clients` + `farms` + FKs en `dji_parcels` + columnas `data_validity`/`last_validated_at`/`validated_by_email`. API CRUD `app/api/admin/clients/route.ts` y `app/api/admin/farms/route.ts`. **Lección**: pg 8 + multi-statement `client.query(sql)` tiene cross-statement catalog visibility — backfill se mueve a `scripts/backfill-clients-farms.js` standalone.
- **Fase 3.B/3.C UI** (PR #45 `42baacb`): dropdowns Cliente/Finca (FK) en el parcel metadata editor, vigencia chip, banner "X parcelas sin cliente/finca" en admin, breadcrumb Cliente → Finca → Parcela en parcel detail. Server actions + `updateParcelMetadata` extendido (auto-deriva name desde FK si no viene).
- **Fase 4.1-4.4** (PR #46 `8b6f703`): `cycles` (1+ por parcela) + `cycle_events` (siembra/aplicación/corte/renovación) + `phase_rules` (configurable) + `vw_current_cycle` + función `current_phase(crop, variety, start_date)` STABLE. Backfill híbrido `POST /api/admin/cycles/backfill` que crea ciclos virtuales con `source='dji_inferred'` y `data_validity='needs_review'` para gaps >120d. Endpoint `GET /api/data-quality/invariants` con 5 patrones (parcela sin cliente, sin finca, sin ciclo activo, fumigación en ciclo cerrado, ciclo sin phase rule, parcela data stale). UI parcel detail muestra cycle card con fase actual.
- **Fase 1.3 Confirm step** (PR #48 `7e0e570`): wizard 4 steps (mode/pick/form/confirm). `RegisterFumigationForm` refactoreado a `forwardRef` + `useImperativeHandle` exponiendo `getFormData()` y `triggerSubmit()`. `ConfirmStep` muestra resumen read-only. 5 nuevos tests (`tests/components/admin/fumigations/confirm-step.test.tsx`).
- **Fase 2/5 API** (PR #49 `4d176b9`): `GET /api/dji-flights/search?parcelId=X&dateFrom=Y&dateTo=Z&limit=N` con 13 tests (auth, params, query, shape). Path primer nivel (no `/api/admin/`) — read-only data reutilizable para supervisor.
- **Fase 4.4.1 UI calidad de datos** (PR #50 `058770c`): `components/data-quality/data-quality-banner.tsx` (8 tests) + `app/(auth)/admin/calidad/page.tsx` con 4 KPIs + lista agrupada. Reusa `/api/data-quality/invariants`.
- **Fase 2/5 DjiFlightPicker** (PR #51 `b09febe`): componente client con cards clickeables (tabindex=0 + role=button + onKeyDown). TZ Bogota, area m²→ha con `fmtDec`. 8 tests.
- **Fase 2/5 Step 0 cards** (PR #52 `edd6c5d`): `phase = "mode" | "pick" | "form" | "confirm"`, `ModeStep` con 2 cards (Importar/Manual), `entryMode` state, `pickedFlight` state. Step 2 muestra DjiFlightPicker cuando `entryMode === "import"`. 6 tests.
- **Fase 2/5 Auto-fill** (PR #53 `d4cbbe7`): `setFormData(data: Partial<FormState>): void` en el handle del form. `handlePickFlight` autollena `fumigation_date`, `duration_minutes`, `area_fumigated_m2`, `drone_code_used` (vía `DRONE_MODELS.find`), `notes`. 3 tests.

**Bugs críticos abiertos:**
- **Bug 2 — `/geovisor` accesible sin login** (PR #41 abrió diagnóstico con `console.log("[auth.authorized]", ...)` en `lib/auth.config.ts`). Owner: manual, requiere abrir `/geovisor` en incognito en Vercel y capturar el log. Guia en `docs/BUG-2-AUTH-DIAGNOSTIC.md` (PR #54 `3a4ff61`) — incluye sección zod anti-Bug-2.

**Backfill operacional pendiente (manual, cada ambiente, UNA sola vez):**
- `node scripts/backfill-clients-farms.js` — local, preview, prod.
- `POST /api/admin/cycles/backfill` — local, preview, prod. **NO correr dos veces** (idempotente, pero el segundo pass duplica detecciones).

**Quality Gauntlet #1 (zod) cerrado — 3 PRs, 2026-09-06:**
- **PR #56** (`986f40e`) — zod 4.5.4 devDep + `lib/api-schemas.ts` con 5 schemas de response + `parseWithSchema` helper + `formatZodIssues` + 17 tests anti-Bug-2. Cubre `errorResponseSchema`, `djiFlightSchema`, `dataQualityWarningSchema`, `authSessionSchema`. Documentación extendida en `docs/BUG-2-AUTH-DIAGNOSTIC.md`.
- **PR #57** (`34e31dc`) — zod para request bodies en 3 endpoints POST (`/api/admin/clients`, `/api/admin/farms`, `/api/admin/fumigations`). Reemplaza ~336 lineas de if-checks con 3 schemas declarativos. Response 400 ahora incluye `issues: [{ path, message }]` además de `error` (backward compat preservado). 60 tests nuevos.
- **PR #58** (`4da38d9`) — zod para FormState del wizard 4-step. `formStateSchema` valida ANTES de avanzar al step 3 (Confirm). Banner de error con field path (`data-testid="form-validation-error"`). `formStateToBody()` helper para conversion. 26 tests nuevos.

**Total Quality Gauntlet #1**: +2744 / -358 lineas, 103 tests nuevos, 0 regresiones, 2042/2042 tests verde final.

**Lecciones zod** (en `docs/PLAN-FUMIGACIONES-V2.md` + comentarios de `lib/api-schemas.ts`):
1. `z.preprocess(v, schema.nullable())` + `.transform(v => v === "" ? null : v)` = el patron para campos opcionales (string, number, int). Reemplaza 5-10 if-checks por campo.
2. `formatZodIssues(error)` retorna `{ error, issues }` — primer issue al `error` (humano), lista completa al `issues` (machine-readable).
3. Forms con `string` + `Number()` conversion: usar `z.string().refine(v => { const n = Number(v); return !isNaN(n) && ... })` deja HTML nativo y validacion runtime.
4. `zod` `path` es `PropertyKey[]` (incluye `symbol`), no `string[]`. Para mensaje legible: `String(first.path[0] ?? "form")` (TS2731 si no se coerce).
5. Compatibilidad entre schemas testeable: parsea el body derivado con el segundo schema. Si pasa, el flujo entero es coherente.

**QA closeout (2026-09-06, 7 PRs)** — feedback del operador fumigador en `C:\Users\agFab\OneDrive\Documents\Obsidian\General\TG_correcciones\QA actual.md`:

- **PR #60** (`5c09cf2`) — **QA-01 logo** sidebar: usar logo AFM original (`public/afm-logo.svg`, mismo SHA256 que `docs/afm_png.svg`) en vez del mark chico.
- **PR #61** (`caee258`) — **QA-10 drone dup** en `components/parcels/register-fumigation-form.tsx`: el `FieldSelect` ya renderea su propio label; eliminamos el wrapper externo que duplicaba el texto en "Dron usado", "Tipo de fumigación", "Fase de uso".
- **PR #62** (`047d2f5`) — **QA-11 wizard back**: botón "Volver a modalidad" en el step 1 del wizard de fumigaciones + stepper cliqueable para steps ya completados. 2 nuevos tests.
- **PR #63** (`f9515ca5`) — **QA-06 test data script**: `scripts/cleanup-test-data.js` (380 lineas) para identificar y borrar datos de prueba en prod. Dry-run por default + `--apply` + `--yes` + `--pattern=foo,bar`. 7 tablas en orden FK-safe. Tarea operacional del usuario, no auto-deploy.
- **PR #64** (`429201a0`) — **QA-12 polygon UX**: rediseño completo de `components/admin/parcels/parcel-drawer.tsx`. Toolbar flotante con Dibujar/Editar/Limpiar/Undo/Redo + search Nominatim. Toggle de basemap (Satélite/Híbrido/Callejero) con default Satélite. Empty state con "Comenzar dibujo". Display de área calculada en ha. Modo "select" (TerraDrawSelectMode) para editar vértices. Swap de columnas en `NewParcelForm` (mapa izquierda, form derecha). Bug fix 2026-08-22 preservado (setMode dentro de ready callback). 16 nuevos tests.
- **PR #65** (`6ea1d20`) — **QA-02 geovisor simplify**: `components/geovisor/geovisor-client.tsx` reescrito. Sin cadencia, sin cliente/hacienda/drone/source — solo búsqueda de texto. Date range manual (Desde / Hasta) con defaults 90 días. Lista de fumigaciones en sidebar derecho (ordenada por fecha DESC) en vez de lista de parcelas. Card de detalle del evento seleccionado. KPIs simplificados (Fumigaciones/Parcelas/Área/Última). Leyenda de cadencia removida del mapa. 10 nuevos tests.
- **PR #66** (CI al cierre de este doc) — **QA-14 reportes tabs**: refactor de `app/(auth)/reportes/page.tsx`. Bloque introductorio "¿Qué hace esta página?" con bullets explicativos. 3 tabs (Resumen / Por hacienda / Detalle) en `components/reports/reports-tabs.tsx` (client component con useState, role=tab/tabpanel, aria-selected, aria-labelledby). Tabla detallada extraida a `components/reports/fumigations-table.tsx` (server component puro). 13 nuevos tests.

**Total QA closeout**: 7 PRs, +2411 / -453 lineas, 31 tests nuevos, 0 regresiones, arch:check 0 errors, tsc 0 errors.

**Deuda S10/S10.5 anotada (separar en PRs futuros):**
- SVG 400 en `/_next/image?url=%2Fafm-logo-mark.svg` (cosmético, no bloquea login). El SVG tiene UTF-8 malformado + el `sandbox` CSP de `next.config.ts` hace que el Image optimizer rechace.
- Refactor a `app/(auth)/` route group: mover todas las pages autenticadas, poner el AppShell en `app/(auth)/layout.tsx`, remover el check de pathname en `app/layout.tsx`. El workaround `proxy.ts + x-pathname` es funcional pero no idiomático (~30 min de refactor).
- `pg` bump a `^8.20.0` en master (era `8.20.0` exacto) — el caret es para tolerar patches automáticos del lockfile.
- Index en `dji_fumigaciones.product_id` (FK sin index desde S9, ver #32) — migration con `CREATE INDEX CONCURRENTLY`. 1h.

**Candidates (próximos, en orden de prioridad):**
1. Bug 2 auth — diagnosticar `/geovisor` accesible sin login (PR #41 instrumentación lista, guía PR #54).
2. Correr backfills de `clients/farms` y `cycles` en cada ambiente.
3. Refactor a `app/(auth)/` route group (2-3h).
4. Index en `dji_fumigaciones.product_id` (1h).
5. Fix SVG 400 en Image optimizer (1h).
6. Quality Gauntlet compuertas 5-7 (StrykerJS, BDD Gherkin, smoke DB, métricas continuas) — requiere deps nuevas (autorización explícita del user).

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
10. `docs/PLAN-FUMIGACIONES-V2.md` — el plan V2 cerrado: 5 fases (wizard UX + Cliente/Finca + Ciclos Productivos + Capa de Gestión + Confirm step). Tracking cerrado + 4 lecciones aprendidas (S11+, PRs #40-#55).
11. `docs/BUG-2-AUTH-DIAGNOSTIC.md` — guia para diagnosticar por qué `/geovisor` es accesible sin login. 3 pasos para Vercel logs + sección zod anti-Bug-2.

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

> **Nota 2026-09-06**: compuerta 4 (zod para testeo de bugs) **cerrada** con PRs #56, #57, #58. Compuertas 5-7 (BDD Gherkin, mutation testing, smoke DB, métricas continuas) siguen documentadas pero **no activas** — requieren deps nuevas (StrykerJS, Cucumber, etc). Ver `docs/QUALITY_GAUNTLET.md` para el roadmap.

---

## 7. Cuando algo falla y no sabés por qué

1. **Tests fallan** → corré `npx vitest run <archivo>` para aislar. Si es flaky, re-corré 2-3 veces.
2. **Build falla** → corré `npm run build` local y mirá el output completo. Si es un error de TypeScript, `npx tsc --noEmit --pretty`.
3. **DB connection fails** → revisá `DATABASE_URL` en `.env.local`. Si es Supabase, usá la **pooled URL** (puerto 6543), no la direct (puerto 5432 = solo IPv6).
4. **Scraper falla** → `docs/DJI_SCRAPER.md` § "Troubleshooting". Casi siempre es: storage state expirado, DJI cambió schema, o rate limit.
5. **Coverage baja de golpe** → corré `npx vitest run --coverage` y mirá qué archivo perdió cobertura. Probablemente código nuevo sin test.

---

**Última actualización:** 2026-09-06 (S11+ V2 plan completo: PRs #40-#55. Quality Gauntlet #1 zod: PRs #56-#58. Master `4da38d9`, 2042/2042 tests verde).
**Mantenedor:** @agFab (single contributor, dev actual en transición — ver `docs/HANDOFF-2026-09-02.md`).
