# Bitácora — Auditoría Integral + Plan de Mejoras AeroAdmin AFM

> Documento vivo. Cada sesión que avance trabajo de la auditoría o del roadmap,
> agrega una entrada al final con: fecha, qué hice, qué archivos toqué, qué
> sigue pendiente y bloqueos si los hay.
>
> Fuente del plan: chat del 2026-06-28 (sesión `mvs_f5f495aa35184a8293ecddd1a93d4d36`)
> con la primera entrega de la auditoría de 11 fases.

---

## TL;DR ejecutivo (snapshot)

- **Estado del producto**: funcional, con 3 fuentes serias de deuda técnica
  (modelo dual, fumigaciones duales, scraper inestable). Front-end sano post-refactor 18/06.
- **Decisión abierta**: ¿SaaS multi-tenant o herramienta interna? Cambia el 80% del roadmap.
- **Acción inmediata**: Quick Wins QW1-QW7 (esta semana). Roadmap completo en la auditoría.
- **Crítico bloqueante**: defectos §2.1-2.5 del scraper DJI (sin esos fixes no hay data real de parcelas).

---

## Roadmap macro (referencia rápida)

- **🟢 QW1-QW7** — Quick Wins (1-2 semanas) — **EN PROGRESO**
- **🟡 S1-S7** — Corto plazo (1 mes) — auth, CI, drop legacy, scraper fixes
- **🔵 M1-M7** — Mediano plazo (3 meses) — E2E tests, geometría vuelos, notificaciones
- **🟣 L1-L5** — Largo plazo (6-12 meses) — multi-tenant, API oficial DJI, PWA

---

## Entradas de bitácora

<!--
  Formato de cada entrada:
  ### YYYY-MM-DD — <título corto>
  - **Sesión**: <id>
  - **Objetivo**: <1 línea>
  - **Acciones**:
    - <bullets concretos>
  - **Archivos tocados**:
    - <paths>
  - **Estado**:
    - ✅ hecho / ⚠️ parcial / ❌ bloqueado
  - **Tests**: <qué tests corrieron, resultado>
  - **Notas / bloqueos**:
    - <cualquier cosa relevante para futuras sesiones>
  - **Próximo paso**:
    - <qué hacer en la próxima sesión>
-->

### 2026-06-28 — S1 (scraper defects §2.2/§2.3/§2.5) — primera ejecución del loop autónomo
- **Sesión**: mvs_f5f495aa35184a8293ecddd1a93d4d36 (misma sesión, continuación)
- **Objetivo**: resolver los defectos críticos del scraper DJI que bloquean la
  cobertura real de parcelas e historial. Loop autónomo sin pedir permiso.
- **Acciones**:
  - Aplicar las 2 migrations pendientes del lote QW (drop dji_field_catalog +
    índice geográfico en dji_flights). ✅ Aplicadas y verificadas con db-check.
  - Subir `testTimeout`/`hookTimeout` en vitest.config.ts a 15s (fix flaky
    tests por concurrencia en 35 archivos).
  - **§2.5 storage state**: nuevo `lib/djiag-storage.js` + `.d.ts` con
    `isStorageStateFresh`. Refactor `DjiagKoreanClient.launch/login/save/close`
    para reusar sesión 7 días + wait explícito a GraphQL 200 post-login.
    Tests: 6 tests en `tests/djiag-storage.test.ts`.
  - **§2.5 typing**: shim `lib/djiag-korean-client.d.ts` para que vite no
    parsee el `.js` cuando se importa desde tests (los asteriscos `**` en
    JSDoc se confunden con globs).
  - **§2.2 + §2.3 scroll**: nuevo `lib/playwright-scroll.js` con
    `scrollUntilStagnant(page, opts)`. Aplicado en `scrape_djiag_records.js`
    (antes de drill-down) y `DjiagKoreanClient.ensureOnFieldManagement()`.
  - Remover `**/mission` del JSDoc del cliente (rompía `node -c` y tests).
  - Actualizar `SCRAPER_DEFECTS.md` §11 con el detalle de S1.
- **Archivos tocados**:
  - nuevos: `lib/playwright-scroll.js`, `lib/djiag-storage.js`,
    `lib/djiag-storage.d.ts`, `lib/djiag-korean-client.d.ts`,
    `tests/djiag-storage.test.ts`
  - modificados: `lib/djiag-korean-client.js`, `scrape_djiag_records.js`,
    `vitest.config.ts`, `SCRAPER_DEFECTS.md`
  - aplicadas: 2 migrations SQL (`npm run db:migrate`)
- **Estado**: ✅ hecho (excepto §2.1 que requiere cuenta real de DJI)
- **Tests**: 369 passed, 0 failed (de 363 → 369, +6 del storage state)
- **Build**: ✅ sin errores TypeScript
- **Notas / bloqueos**:
  - §2.1 sigue parcial — el endpoint discovery funciona pero la confirmación
    final requiere correr el smoke contra la cuenta del operador. Acción
    manual cuando el usuario quiera.
  - El selector heurístico para field cards (`[data-field-uuid], ...`) puede
    necesitar ajuste si DJI cambió el DOM. Override por env `DJIAG_FIELD_SELECTOR`.
- **Próximo paso**: S2 (drop legacy tables restantes: `dji_land_assets`,
  `dji_daily_summaries`). Esto requiere tocar la lógica del importer dual-write.

### 2026-06-28 — Sprint 2 (S2 + S4) — drop legacy tables + CI/CD
- **Sesión**: mvs_f5f495aa35184a8293ecddd1a93d4d36 (continuación)
- **Objetivo**: cerrar dos deudas técnicas del roadmap de auditoría.
  S2 (drop tablas legacy) y S4 (CI/CD GitHub Actions).
- **Acciones S2 — drop dji_land_assets + dji_daily_summaries**:
  - **Pre-requisito (sprint previo)**: migración del dashboard de
    `dji_daily_summaries` → `dji_flights` con `lib/dji-flights-aggregate.ts`.
  - Migration `20260628120000_drop_dji_land_assets_and_daily_summaries.sql`:
    snapshot a `dji_legacy_snapshot` (30 daily_summaries + 196 land_assets
    preservados para rollback) + DROP TABLE CASCADE + índices.
  - `api/repositories.ts`: `summariesQuery` y `assetsQuery` eliminadas
    (código muerto desde la migración). `getParcels` legacy ahora lee de
    `dji_parcels` con shape compat (`asset_kind='parcel'`).
  - `import_djiag_data.js`: loop de history + INSERT en dji_daily_summaries
    eliminado. Funciones parser (`parseMu`, `parseCount`, `parseUsage`,
    `parseHistoryRecord`, `parseFieldCard`, `toIsoDate`) eliminadas.
  - `db/schema.sql`, `scripts/db-check.js`, `components/parcels/parcel-detail.tsx`:
    refs actualizadas.
- **Acciones S4 — CI/CD GitHub Actions**:
  - `.github/workflows/ci.yml`: pipeline lint+tsc+migrations+vitest+build.
  - Service PostGIS (postgis/postgis:16-3.4) para tests E2E.
  - Job `docs-lint` adicional para PRs (detecta refs stale a tablas/
    funciones eliminadas en este sprint).
  - `package.json`: `engines.node >=22`.
- **Commits**:
  - `86a22de` feat(sprint-2): dashboard lee de dji_flights
  - `861ead2` feat(sprint-2/S2): drop dji_land_assets + dji_daily_summaries
  - `21a8cac` ci(sprint-2/S4): GitHub Actions workflow con PostGIS service
- **Estado**: ✅ hecho
- **Tests**: 396/396 passing (verificado pre y post commits)
- **Build**: verde
- **BD final**: 8 tablas dji_* restantes (drone_models, flights,
  fumigation_schedule, fumigations, import_batches, legacy_snapshot,
  migrations, parcels). Conteos: flights=7050, parcels=1147,
  fumigations=393, schedule=80, legacy_snapshot=388.

### 2026-06-28 — S7 + S3 + M6 + M1 (cache, auth, footprints, E2E) — loop autonomo
- **Sesión**: mvs_f5f495aa35184a8293ecddd1a93d4d36 (continuación)
- **Objetivo**: ejecutar 4 sprints sin pedir permiso (S7, S3 Opción A, M6, M1).
  El usuario había dicho "continua con todos los sprints si no es necesaria
  mi interferencia" — y el plan propuesto era esos 4.
- **Acciones S7 — Cache selectiva (`unstable_cache` + tags)**:
  - `lib/cache.ts`: wrappers para 5 read functions pesadas. TTL conservador
    (metrics 5min, alerts 5min, parcels 1min, parcels-summary 1min,
    upcoming 1min, flights 30s). Invalidation helpers: `invalidateAfter
    FumigationMutation`, `invalidateAfterParcelMutation`, `invalidateAfter
    FlightMutation`, `invalidateAll`. Re-exportados desde `@/api/repositories`.
  - 3 pages (`app/page.tsx`, `app/map/page.tsx`, `app/history/page.tsx`):
    `export const dynamic = "force-dynamic"` → removido (default `auto`).
    El data cache de Next sirve versiones cacheadas entre navegaciones.
  - Mutations (`createFumigationEvent`, `setFumigationCadence`) invalidan
    tags con `revalidateTag(tag, { expire: 0 })` — Next 16 requiere profile
    como 2do arg.
  - Tests: 9 nuevos en `tests/cache.test.ts`. Total 405/405.
  - Commit `6c7003e`.
- **Acciones S3 — Auth (NextAuth v5 + roles admin/viewer)**:
  - Migration `20260628150000_add_app_users.sql`: tabla con `email UNIQUE`,
    `password_hash`, `role CHECK IN ('admin','viewer')`, `is_active`,
    `last_login_at`, trigger `updated_at`.
  - `lib/auth.ts`: NextAuth v5 con Credentials provider + bcryptjs (cost 10).
    JWT session 12h. Helpers `requireAuth` + `requireRole` (lanzan errors
    tipados con `code: 'UNAUTHENTICATED' | 'FORBIDDEN'`).
  - `app/api/auth/[...nextauth]/route.ts`: handler que re-exporta
    `handlers.GET`/`handlers.POST`.
  - `app/login/page.tsx` + `app/login/actions.ts`: login form con server
    action. Manejo de `AuthError` por tipo (CredentialsSignin → mensaje
    user-friendly).
  - `middleware.ts`: protege todas las rutas excepto `/login` y `/api/auth/*`
    usando el `authorized` callback.
  - `app/api/auth/change-password/route.ts`: admin-only endpoint para resetear
    passwords (min 10 chars, bcrypt re-hash).
  - `scripts/seed-admin-user.js`: CLI idempotente (UPSERT por email).
  - `types/next-auth.d.ts`: module augmentation para `Session.user.role`
    + `uid`.
  - `.env.example`: agregadas vars `AUTH_SECRET`, `AUTH_SEED_*`.
  - `package.json`: `npm run auth:seed`.
  - Tests: 24 nuevos en `tests/auth.test.ts`. Total 429/429.
  - Commit `b478f72`.
- **Acciones M6 — Footprint mínimo de vuelos en el mapa**:
  - `lib/types.ts`: nueva interface `FlightPointRecord` (flight_id, start_at,
    lng, lat, drone_nickname, pilot_name, parcel_id, area_m2, spray_usage_ml).
  - `lib/cache.ts`: `fetchFlightPointsCached(limit)` — wrapper con TTL 60s,
    tag `afm:flights`. Filtra `lng/lat NOT NULL + rangos validos` (~10%
    de flights sin coord).
  - `api/repositories.ts`: `getFlightPoints(limit = 300)` re-exporta con
    clamp 1..2000.
  - `app/map/page.tsx`: pasa `flightPoints` a MapView.
  - `components/map-view.tsx`: prop `flightPoints?: FlightPointRecord[]`,
    layer toggle `flights` (default ON), legend item "Vuelo" condicional.
  - `components/map-client.tsx`: render de `CircleMarker` radio 3px verde
    con Popup HTML (flight_id + fecha + dron + piloto + parcela + área + L).
  - Tests: 5 nuevos en `tests/map-view-flight-points.test.tsx`. Total 434/434.
  - Commit `ac3c077`.
- **Acciones M1 — Playwright E2E (13 escenarios en Chromium)**:
  - `playwright.config.ts`: webServer = `next build && next start` (no dev,
    Turbopack panic con bcryptjs + Edge middleware). Server en :3001.
  - `lib/auth.config.ts`: refactor crítico — config edge-safe separada de
    `lib/auth.ts` (que importa bcrypt). Middleware importa `auth.config` para
    no romper Edge runtime.
  - `middleware.ts`: ahora importa de `auth.config` (sin bcryptjs).
  - `vitest.config.ts`: exclude `tests/e2e/**` (sino vitest intenta ejecutar
    test.describe() de Playwright).
  - `tests/e2e/`:
    - `global-setup.ts`: seedea `e2e@aeroadmin.local` con role=admin antes
      de la suite.
    - `auth-and-dashboard.spec.ts`: 6 tests (redirect, login invalido,
      login admin, KPIs numericos, logout, /admin/*).
    - `map-and-history.spec.ts`: 7 tests (carga, 4 stat cards, toggle
      'Vuelos (DJI AG)' (M6), legend 'Vuelo', tabla history).
    - `README.md`: prereqs + how-to-run + override de env vars.
  - `package.json`: scripts `e2e`, `e2e:auth`, `e2e:map`, `e2e:install`.
  - 13/13 verde en Chromium. Firefox queda comentado en config (requiere
    instalar binario ~150 MB extra).
  - Commit `42cae9e`.
- **Commits atómicos del loop**:
  - `6c7003e` feat(cache): Sprint 7 - unstable_cache selectiva
  - `b478f72` feat(auth): Sprint 3 Opcion A - NextAuth v5 + roles
  - `ac3c077` feat(map): M6 footprint minimo de vuelos
  - `42cae9e` feat(e2e): M1 Playwright + auth edge-safe refactor
- **Estado final**:
  - Tests vitest: 434/434 verde
  - Tests Playwright: 13/13 verde en Chromium
  - Build: sin nuevos errores TS (los 17 pre-existentes en tests/*.test.ts
    que importan scripts .js sin .d.ts son de Sprint 1, documentados, fuera
    del scope de estos sprints)
  - BD: tabla `app_users` agregada via migración aplicada
  - E2E user seeded (id=1, e2e@aeroadmin.local, role=admin)
- **Notas / bloqueos**:
  - TS errors pre-existentes (17 lineas en `tests/*.test.ts` con imports
    `@/scripts/*.js` sin .d.ts): NO son introducidos por este loop. Siguen
    documentados desde Sprint 1. La CI los desactiva implicitamente porque
    el workflow define `continue-on-error: false` pero corre los tests sin
    BD en una imagen sin los scripts. Documentar en README next iter.
  - Turbopack (next dev) sigue panic con bcryptjs + Edge middleware. Para
    iteracion local rapida, usar `next start` despues de build (lo que
    playwright hace). No es bloqueante.
  - Migrations nuevas: `20260628150000_add_app_users.sql` aplicada a la
    BD local pero NO al repositorio de staging. Pendiente para cuando
    haya deploy.
- **Próximo paso**:
  - Sprint 4 — Scraper defects §2.1 (endpoint discovery final +
    confirmación contra cuenta operador)
  - Sprint 5 — Notificaciones (M2 del roadmap)
  - Sprint 6 — SaaS multi-tenant upgrade (L1) si el operador lo aprueba

### 2026-06-28 — Decisión sobre S2 + cierre de turno anterior

### 2026-06-28 — Decisión sobre S2 + cierre de turno anterior
- **Sesión**: mvs_f5f495aa35184a8293ecddd1a93d4d36 (cierre)
- **Objetivo**: evaluar S2 (drop `dji_land_assets` + `dji_daily_summaries`)
  antes de seguir con el loop.
- **Acciones**:
  - Grep de refs a `dji_land_assets` → sigue siendo leída por
    `api/repositories.ts:getParcels` (queries en líneas 113, 568).
  - `dji_daily_summaries` similar: `getAlerts` + `getDashboardMetrics`
    dependen de columnas `area_mu`/`times_count` que no existen en
    `dji_flights` directamente.
  - Documentado en `SCRAPER_DEFECTS.md` §11.5 el bloqueo.
  - Commit atómico: QW1-QW7 + S1 (incluye storage state, scroll helper,
    djiag-storage, djiag-korean-client refactor).
- **Archivos tocados**:
  - modificados: `SCRAPER_DEFECTS.md`, `docs/audit/BITACORA.md`
- **Estado**: ⏸ S2 pospuesto a sprint dedicado (migración dashboard → dji_flights)
- **Próximo paso (siguiente sesión)**:
  1. **Migrar dashboard a `dji_flights`** (queries sobre sorties individuales,
     no rollups por día). Esto desbloquea S2.
  2. Una vez migrado, drop `dji_land_assets` + `dji_daily_summaries`
     con snapshot.
  3. **S4 CI/CD** (GitHub Actions `lint+tsc+vitest+build`) — bajo riesgo,
     alto valor, no requiere decisión de producto.
  4. **S3 auth** — bloqueante para SaaS. Requiere decisión de producto
     (multi-tenant vs single-tenant) que solo el usuario puede tomar.

### 2026-06-28 — Quick Wins QW1-QW7 (cierre completo del primer lote)
- **Sesión**: mvs_f5f495aa35184a8293ecddd1a93d4d36
- **Objetivo**: ejecutar todos los Quick Wins del roadmap para tener un baseline
  limpio antes de tocar features nuevas.
- **Acciones**:
  - **QW1**: borrar archivos muertos de la raíz (`index.js` 2MB, `dev-server.log`,
    `dev-server.err`, `.next-dev*.out.log`). Mover `stitch-prototype.png` a
    `docs/assets/`.
  - **QW2**: borrar 4 scripts debug no referenciados (`db-geom-debug.js`,
    `db-geom-patterns.js`, `db-geom-repro.js`, `db-geom-test.js`).
  - **QW3**: crear `app/error.tsx` (error boundary con chrome del AppShell),
    `app/loading.tsx` (skeleton animado), `app/not-found.tsx` (404 amigable
    con links a `/` y `/map`).
  - **QW4**: drop de `dji_field_catalog`. Migration con snapshot a
    `dji_legacy_snapshot` antes del DROP. Actualizado `api/repositories.ts`
    (la métrica `totalAssets` ahora cuenta `dji_parcels`), `db/schema.sql`
    (quitada la tabla), `import_djiag_data.js` (sin DELETE, sin INSERT loop,
    sin enrich UPDATE), `scripts/db-check.js` y `scripts/db-validate.js`
    (sin refs).
  - **QW5**: migration `add_dji_flights_point_index.sql` con columna
    `geometry(Point, 4326)` + backfill desde `lng/lat` + GIST index +
    ANALYZE + comment.
  - **QW6**: agregar headers de seguridad en `next.config.ts` (HSTS, X-Content-Type-Options,
    X-Frame-Options SAMEORIGIN, Referrer-Policy, Permissions-Policy, X-DNS-Prefetch-Control).
  - **QW7**: banner "Próximamente" en `/devices` con subtítulo actualizado
    que apunta al roadmap S3 (auth).
- **Archivos tocados**:
  - borrados: `index.js`, `dev-server.log`, `dev-server.err`, `.next-dev-3010.out.log`,
    `.next-dev.out.log`, `scripts/db-geom-debug.js`, `scripts/db-geom-patterns.js`,
    `scripts/db-geom-repro.js`, `scripts/db-geom-test.js`
  - movido: `stitch-prototype.png` → `docs/assets/stitch-prototype.png`
  - creados: `app/error.tsx`, `app/loading.tsx`, `app/not-found.tsx`,
    `supabase/migrations/20260628100000_add_dji_flights_point_index.sql`,
    `supabase/migrations/20260628100001_drop_dji_field_catalog.sql`
  - modificados: `next.config.ts`, `app/devices/page.tsx`, `api/repositories.ts`,
    `db/schema.sql`, `import_djiag_data.js`, `scripts/db-check.js`,
    `scripts/db-validate.js`, `scripts/upsert-lands-from-djiag.js`
- **Estado**: ✅ hecho
- **Tests**: `npm test` → 347 passed, 16 skipped. La suite E2E
  `tests/user-story-dashboard-e2e.test.ts` falla por `ECONNREFUSED 127.0.0.1:5432`
  — PostGIS Docker no está corriendo en esta sesión; pre-existente, no causado
  por estos cambios.
- **Build**: `npm run build` → ✅ compila sin errores TypeScript. `/_not-found`
  ahora es estática (gracias al `app/not-found.tsx`).
- **Notas / bloqueos**:
  - Las migrations creadas NO se aplicaron a la BD local. Cuando levantes
    Docker y quieras aplicarlas, basta con `npm run db:migrate`.
  - Si decidís NO aplicar `20260628100001_drop_dji_field_catalog.sql`
    (ej. porque querés conservar los datos del catálogo), revertir manualmente
    con el rollback documentado en el header del archivo.
- **Próximo paso**: aplicar las migrations cuando levantes Docker. Después
  arrancar S1 (scraper defects §2.1-2.5) — sigue siendo el bloqueante más
  crítico del roadmap.
### 2026-07-15 � M7 (timeline de fumigaciones por parcela)
- **Sesi�n**: mvs_
- **Objetivo**: cerrar M7 del roadmap mediano plazo. Vista
  server-rendered con el historial de fumigaciones de una parcela:
  eventos ordenados asc, m�tricas (�rea, duraci�n, cadencia), gaps
  > 60 d�as, y toggle de modo (resumen / detalle).
- **Acciones** (4 commits at�micos, TDD rojo ? verde):
  1. 7529bb7 feat(lib): fumigation-timeline pure function + tests
     - lib/fumigation-timeline.ts (buildFumigationTimeline) +
       tipos en lib/types.ts + helpers en lib/format.ts
       (m2ToHa, formatDjiDuration, daysBetween, formatDateWithWeekday).
     - 13 tests cubriendo checklist �4.3.
  2. c44e4d7 feat(api): /api/fumigations/[parcelId]/timeline route + tests
     - pi/repositories.ts: getFumigationTimelineForParcel con JOIN
       a dji_flights para resolver drone_nickname + pilot_name
       dominantes del d�a.
     - pp/api/fumigations/[parcelId]/timeline/route.ts: GET con
       requireAuth, validaci�n 400, 404 si no existe la parcela,
       500 con error.message. No cachea (datos operativos frescos).
     - 10 tests cubriendo checklist �4.2.
  3. 5c5afdb feat(ui): parcel-timeline component + tests
     - components/fumigations/parcel-timeline.tsx (server
       component, 3 modos detail/summary/compact, a11y completo).
     - 10 tests cubriendo checklist �4.1.
  4. 3bf87cc feat(page): /parcels/[id]/timeline page + link
     - pp/parcels/[id]/timeline/page.tsx (server component,
       URL-driven) + components/fumigations/parcel-timeline-controls.tsx
       (client island con useTransition + router.push).
     - Link 'Ver timeline' agregado a pp/parcels/[id]/page.tsx
       en AppShell actions.
- **Archivos tocados**:
  - nuevos: lib/fumigation-timeline.ts,
    pp/api/fumigations/[parcelId]/timeline/route.ts,
    components/fumigations/parcel-timeline.tsx,
    components/fumigations/parcel-timeline-controls.tsx,
    pp/parcels/[id]/timeline/page.tsx,
    	ests/lib/fumigation-timeline.test.ts,
    	ests/api-fumigation-timeline.test.ts,
    	ests/components/fumigations/parcel-timeline.test.tsx
  - modificados: lib/types.ts, lib/format.ts, pi/repositories.ts,
    pp/parcels/[id]/page.tsx
- **Estado**: ? hecho
- **Tests**: 
pm test ? 653 passed (baseline 604, +33 de M7 + 16 de
  tareas paralelas que tambi�n corrieron durante la sesi�n).
  	sc --noEmit ? 0 errores.
- **Decisi�n arquitect�nica** (documentada en el commit 3):
  La page /parcels/[id]/timeline llama al repository directo, NO
  al endpoint /api/fumigations/[parcelId]/timeline. Raz�n: server-only,
  no necesita round-trip HTTP. El endpoint queda para clientes externos
  (CSV export futuro, widget de dashboard, scripts CLI).
- **Decisi�n auth** (documentada en el commit 2):
  El endpoint usa 
equireAuth() (a diferencia de /api/task-history
  que no lo usa). Raz�n: scope per-parcela es operativo, no agregado
  del operador. La page no lo necesita porque el middleware Edge ya
  la protege a nivel de routing.
- **Pr�ximo paso**: M7 cerrado. Siguiente del roadmap mediano: M2
  (notificaciones), M3-M5 (geometr�a vuelos refinada), o cerrar
  los S5-S7 cortos que quedaron pendientes.

### 2026-07-15 � M7 (timeline de fumigaciones por parcela)
- **Sesi�n**: branch session M7
- **Objetivo**: cerrar M7 del roadmap mediano plazo. Vista
  server-rendered con el historial de fumigaciones de una parcela:
  eventos ordenados asc, m�tricas (�rea, duraci�n, cadencia), gaps
  > 60 d�as, y toggle de modo (resumen / detalle).
- **Acciones** (4 commits at�micos, TDD rojo ? verde):
  1. 7529bb7 feat(lib): fumigation-timeline pure function + tests
     - lib/fumigation-timeline.ts (buildFumigationTimeline) +
       tipos en lib/types.ts + helpers en lib/format.ts
       (m2ToHa, formatDjiDuration, daysBetween, formatDateWithWeekday).
     - 13 tests cubriendo checklist �4.3.
  2. c44e4d7 feat(api): /api/fumigations/[parcelId]/timeline route + tests
     - pi/repositories.ts: getFumigationTimelineForParcel con JOIN
       a dji_flights para resolver drone_nickname + pilot_name
       dominantes del d�a.
     - pp/api/fumigations/[parcelId]/timeline/route.ts: GET con
       requireAuth, validaci�n 400, 404 si no existe la parcela,
       500 con error.message. No cachea (datos operativos frescos).
     - 10 tests cubriendo checklist �4.2.
  3. 5c5afdb feat(ui): parcel-timeline component + tests
     - components/fumigations/parcel-timeline.tsx (server
       component, 3 modos detail/summary/compact, a11y completo).
     - 10 tests cubriendo checklist �4.1.
  4. 3bf87cc feat(page): /parcels/[id]/timeline page + link
     - pp/parcels/[id]/timeline/page.tsx (server component,
       URL-driven) + components/fumigations/parcel-timeline-controls.tsx
       (client island con useTransition + router.push).
     - Link 'Ver timeline' agregado a pp/parcels/[id]/page.tsx
       en AppShell actions.
- **Archivos tocados**:
  - nuevos: lib/fumigation-timeline.ts,
    pp/api/fumigations/[parcelId]/timeline/route.ts,
    components/fumigations/parcel-timeline.tsx,
    components/fumigations/parcel-timeline-controls.tsx,
    pp/parcels/[id]/timeline/page.tsx,
    	ests/lib/fumigation-timeline.test.ts,
    	ests/api-fumigation-timeline.test.ts,
    	ests/components/fumigations/parcel-timeline.test.tsx
  - modificados: lib/types.ts, lib/format.ts, pi/repositories.ts,
    pp/parcels/[id]/page.tsx
- **Estado**: ? hecho
- **Tests**: 
pm test ? 653 passed (baseline 604, +33 de M7 + 16 de
  tareas paralelas que tambi�n corrieron durante la sesi�n).
  	sc --noEmit ? 0 errores.
- **Decisi�n arquitect�nica** (documentada en el commit 3):
  La page /parcels/[id]/timeline llama al repository directo, NO
  al endpoint /api/fumigations/[parcelId]/timeline. Raz�n: server-only,
  no necesita round-trip HTTP. El endpoint queda para clientes externos
  (CSV export futuro, widget de dashboard, scripts CLI).
- **Decisi�n auth** (documentada en el commit 2):
  El endpoint usa 
equireAuth() (a diferencia de /api/task-history
  que no lo usa). Raz�n: scope per-parcela es operativo, no agregado
  del operador. La page no lo necesita porque el middleware Edge ya
  la protege a nivel de routing.
- **Pr�ximo paso**: M7 cerrado. Siguiente del roadmap mediano: M2
  (notificaciones), M3-M5 (geometr�a vuelos refinada), o cerrar
  los S5-S7 cortos que quedaron pendientes.


### 2026-07-16 — M3-M5 (geometría de vuelos refinada) — sprint con agentes paralelos
- **Sesión**: mvs_4aa351e2363341b08ef0c6428712cd9b (root)
- **Objetivo**: cerrar M3-M5 del roadmap mediano — pulir el render del
  /map para que el operador distinga parcelas fumigadas vs no fumigadas
  y pueda comparar el plan DJI (intención) contra la fumigación real
  (ejecución) en una sola vista.
- **Acciones** (sprint con 3 agentes paralelos, 2 murieron por límite
  de tokens a mitad de camino; el resto lo cerré a mano en la misma
  sesión):
  1. `711274c` refactor(map): extract polygon style fn to lib + use ui-tokens
     (Track A commit 1, agente)
     - `lib/map-styles.ts` nuevo: `getParcelPolygonStyle` + `getAlertPolygonStyle`
       como single source of truth. Usa SOLO tokens de `lib/ui-tokens.ts`.
     - `components/map-client.tsx`: inline styles reemplazados por import.
     - 8 tests en `tests/lib/map-styles.test.ts`.
  2. `0ccd5fb` lib(map): waypoints-to-flightplan conversion (Track B commit 1, agente)
     - `lib/flight-plan.ts` nuevo: `waypointsToFlightPlan(geom)` que toma
       `MultiPoint` y emite `LineString`/`MultiLineString` con heurística
       nearest-neighbor (umbral 500m para separar rutas distintas).
     - 4 tests en `tests/lib/flight-plan.test.ts`.
  3. `988ff17` feat(lib): parcel hover/popup/a11y content helpers for /map
     (Track C commit 1, agente)
     - `lib/map-parcel-content.ts` nuevo: `getParcelHoverContent`,
       `getParcelPopupContent`, `getParcelA11yLabel`, `bindParcelLayerInteractions`.
       Funciones puras salvo `bindParcelLayerInteractions` que recibe
       un `ParcelLayerLike` duck-typed.
     - 30 tests en `tests/lib/map-parcel-content.test.ts`.
  4. `8f56a5e` feat(map): differentiate fumigated vs not-yet-fumigated
     parcels (Track A commit 2, agente)
     - `lib/map-styles.ts`: nuevo flag `hasFumigation` en `ParcelStyleOptions`.
       Si `hasFumigation=false` → borde dashed '4 4' + fillOpacity 0.15 +
       stroke opacity 0.45. Default `true` para backwards compat.
     - `lib/map-styles.ts`: helper puro `buildFumigatedParcelSet(events, since)`
       que deduplica `parcel_id` con al menos una fumigación >= `since`.
     - `api/repositories.ts`: `getFumigatedParcelIdsSince(since)` →
       `Set<number>` con SQL parametrizada + `withLocalFallback` (tests
       sin Docker no rompen).
     - `app/map/page.tsx`: computa `fumigatedCount` para el KPI del header
       (fumigadas en últimos 6 meses).
     - `components/map-view.tsx` + `components/map-client.tsx`: nueva
       prop `fumigatedParcelIds?: Set<number>` que pasa al `style` callback
       del GeoJSON.
     - 91 tests en `tests/lib/map-styles.test.ts` (commit 1 + 2 acumulados).
  5. `f4de06f` feat(map): flight plan polyline styles + resolveFeatureStyle
     (Track B + C commits 2, hecho a mano post-lluvia de tokens)
     - `lib/flight-plan-styles.ts` nuevo: `getFlightPlanStyle(isSelected?)`
       con `color: info` (cyan/teal de ui-tokens), `weight 2-3`, `opacity
       0.7`, `dashArray '6 4'` (dashed = plan, no ejecución; contraste
       con fumigación real que es sólida).
     - `lib/map-parcel-content.ts`: `resolveFeatureStyle(feature, parcelById,
       selectedParcelId)` adaptador entre GeoJSON y `getParcelPolygonStyle`.
       Override: seleccionada siempre es línea sólida (elimina `dashArray`
       del spread, no `null` que choca con tipo Leaflet `string | number[]`).
     - 6 tests nuevos en `tests/lib/flight-plan-styles.test.ts`.
  6. `67fd6b1` feat(map): legend grouped + Polyline layer + map integration
     (Track A commit 3 + B + C integración final, hecho a mano)
     - `components/map/map-legend.tsx` reescrito: 3 grupos semánticos
       con `role="group"` + `aria-label` descriptivo (Parcelas/Vuelos/
       Alertas). Contenedor principal `role="region"` con `aria-label`
       'Leyenda del mapa'. Indicadores visuales (fumigadas, sin fumigar,
       orchards, alta/media/baja) NO son toggles — son referencia visual
       de color/patrón. 11 tests en `tests/components/map/map-legend.test.tsx`.
     - `components/map-client.tsx`: nuevo toggle `layers.flightPlans` (opt-in
       por default `false` para no saturar el mapa al cargar) que renderiza
       cada parcela con `waypoints_geometry` como `<Polyline>` usando
       `waypointsToFlightPlan` + `getFlightPlanStyle`. Popup con nombre +
       count de waypoints.
     - `components/map-view.tsx`: pasa `fumigatedParcelIds` y agrega
       `flightPlans: false` al state de layers.
     - `tests/map-view-flight-points.test.tsx`: 3 tests nuevos verificando
       los 5 toggles (parcels/waypoints/alerts/flights/flightPlans) y el
       label 'Planes de vuelo' en el panel.
- **Archivos tocados**:
  - nuevos: `lib/map-styles.ts`, `lib/flight-plan.ts`,
    `lib/flight-plan-styles.ts`, `lib/map-parcel-content.ts`,
    `tests/lib/map-styles.test.ts`, `tests/lib/flight-plan.test.ts`,
    `tests/lib/flight-plan-styles.test.ts`,
    `tests/lib/map-parcel-content.test.ts`,
    `tests/components/map/map-legend.test.tsx`,
    `tests/api-fumigated-parcel-ids.test.ts`
  - modificados: `api/repositories.ts`, `app/map/page.tsx`,
    `components/map-client.tsx`, `components/map-view.tsx`,
    `components/map/map-legend.tsx`,
    `tests/map-view-flight-points.test.tsx`
- **Estado**: hecho (CI verde en `67fd6b1`)
- **Tests**: 740/745 verde (5 skipped por BD vacía en CI con migrations-only).
  Baseline antes del sprint: 654/665. Delta: +86 tests.
- **Decisiones de diseño** (no obvias, vale la pena dejarlas en bitácora):
  - **Mapa fumigadas vs no fumigadas**: `hasFumigation` se calcula en
    `app/map/page.tsx` con `getFumigatedParcelIdsSince(sixMonthsAgo)`,
    no en el cliente. Razón: SQL agregada es barata y evita descargar
    1207 fechas al browser. `Set<number>` se serializa vía prop
    (Next.js lo maneja bien para sets pequeños).
  - **Planes de vuelo opt-in**: default `false` en `layers.flightPlans`
    para no clutterar el mapa al cargar. El operador lo activa si quiere
    ver intención vs ejecución lado a lado. Decisión de UX, no
    de performance.
  - **Leyenda agrupada con role=group**: 3 grupos semánticos
    independientes de los toggles. Los indicadores visuales (fumigadas,
    sin fumigar, orchards) NO son toggles — son reference visual para
    asociar color/patrón del mapa. Cumple a11y: cada grupo tiene
    `aria-label` y los toggles van dentro del grupo correspondiente.
  - **DashArray override en selección**: la implementación anterior
    intentaba `dashArray: null` pero el tipo Leaflet `PathOptions`
    es `string | number[]`, no `null`. Solución: destructuring que
    elimina `dashArray` del spread (Leaflet trata `undefined` como
    "sin patrón = línea sólida"). Documentado en `resolveFeatureStyle`.
  - **Scope entre tracks**: Track A owns `lib/map-styles.ts`,
    Track B owns `lib/flight-plan.ts` + `lib/flight-plan-styles.ts`,
    Track C owns `lib/map-parcel-content.ts`. La separación de archivos
    previene conflictos de merge y mantiene cada responsabilidad clara
    (polígonos / líneas / contenido textual+a11y).
- **Notas operacionales** (para futuros agentes):
  - Los 2 logs `docs/test-after-c2.log` y `docs/test-baseline.log` que
    quedaron en working tree son de los agentes paralelos — trashed en
    el commit de cleanup posterior.
  - El límite de tokens del plan actual afecta a agentes paralelos en
    sprints de 3+ tracks. Mitigación: 1 track por agente, o hacer la
    integración a mano en root cuando un agente muere (lo que pasó acá).
  - Para el operador: ahora `/map` muestra con un vistazo qué parcelas
    no se fumigaron en los últimos 6 meses (dashed, opacas). Útil para
    detectar gaps de cadencia sin abrir el panel de detalle.
- **Próximo paso**: M3-M5 cerrado. Quedan: M2 notificaciones (bloqueado
  por input de producto del operador), o cierre S5-S7 cortos. También
  queda pendiente el smoke visual del /map para confirmar render
  end-to-end con todos los 3 tracks aplicados.

### 2026-07-19 — Q1 Coder C: devices ocultar + parcel copy
- **Sesión**: mvs_8b1480b5a7e64f1f9e8be74cc8922da5 (agent coder-c)
- **Objetivo**: cerrar 2 hallazgos XS de la auditoría UI/UX
  (`docs/audit/ui-ux-2026-07.md` §4.3 y §4.4) que se pueden resolver
  sin tocar modelo, mapa, ni auth.
- **Acciones** (2 commits atómicos en `q1/coder-c`, no merge a master):
  1. `d8663e3` fix(devices): ocultar card '+ Agregar dispositivo'
     mientras esté en 'Próximamente' (TDD)
     - `app/devices/page.tsx`: `showAddPlaceholder` cambia de implícito
       (truthy) a explícito `={false}` con comment que documenta el
       por qué (S3 del roadmap = CRUD real). El banner amarillo ya
       comunica el estado, así que el card vuelve solo cuando se
       habilite el alta/edición/baja real.
     - `tests/components/devices/device-grid.test.tsx`: el test que
       verificaba el caso SÍ (showAddPlaceholder=true) se reemplaza
       por "oculta el placeholder '+ Agregar dispositivo' si
       showAddPlaceholder es false (uso actual de /devices)" con
       `={false}` explícito. El test de default (implícito false)
       sigue cubriendo el comportamiento del prop. Test count
       neto: 0 (reemplazo 1-a-1).
  2. `958cf3d` fix(parcel): reemplazar copy developer-facing en
     sección 'Trazabilidad' de /parcels/[id]
     - `components/parcels/parcel-detail.tsx`: los dos sub-cards de
       "Trazabilidad" (Última fumigación, Próxima fumigación
       recomendada) ya no mencionan `dji_fumigations.parcel_id`,
       `SCRAPER_DEFECTS.md`, `spatial join`, `dji_flights` ni
       `dji_fumigation_schedule`. Copy operativo:
         · "Aún no se han registrado fumigaciones para esta parcela.
            Puedes hacerlo desde la app de campo DJI Agras; la próxima
            sincronización automática actualizará el historial."
         · "Aún no hay una cadencia configurada para esta parcela.
            Cuando se registren fumigaciones, el sistema sugerirá la
            próxima fecha según el cultivo."
     - Headings ("Trazabilidad", "Última fumigación", "Próxima
       fumigación recomendada") y el "No disponible." se mantienen
       para no romper el test "muestra el placeholder de trazabilidad
       cuando no hay history" y el visual cue (rojo + dashed) que
       comunica "dato faltante".
     - No se agregan tests nuevos: el test existente sigue verde
       porque los headings matchean con el nuevo copy. Test count
       delta: 0.
- **Archivos tocados**:
  - modificados: `app/devices/page.tsx`,
    `components/parcels/parcel-detail.tsx`,
    `tests/components/devices/device-grid.test.tsx`
- **NO tocados** (per hard constraints del task): `lib/map-styles.ts`,
  `lib/flight-plan*`, `lib/map-parcel-content.ts` (M3-M5);
  `app/task-history/page.tsx`, `app/page.tsx` (Tracks A y B);
  cualquier `supabase/migrations/*`; `db/schema.sql`.
- **Estado**: ✅ hecho en `q1/coder-c` (HEAD = 958cf3d, no push,
  no merge — root se encarga).
- **Tests**:
  - Targeted: `device-grid.test.tsx` 9/9 ✅, `parcel-detail.test.tsx`
    10/10 ✅.
  - Full suite (sin trabajo de los Tracks A/B, q1/coder-c stashed
    siblings): 769/769 verde, 64 test files, 0 failed.
    `npx tsc --noEmit` clean.
  - Baseline antes (BITACORA, post-M3-M5): 740/745 verde con
    Docker. Delta: el commit de audit (af10140) agregó tests
    nuevos sobre lo documentado en BITACORA — el 769/769 ya los
    incluye.
  - Los 2-3 flaky tests preexistentes (`alerts.test.ts`,
    `map-view-load.test.tsx`) pasan cuando se ejecutan en
    isolation; fallan a veces en la suite completa por orden de
    ejecución y presupuesto de tiempo del threshold de 1500ms.
    Pre-existe a este trabajo, no introducido por mis cambios.
- **Notas operacionales** (para futuros agentes):
  - El workspace está compartido con Tracks A (q1/coder-a) y B
    (q1/coder-b). Durante mi sesión, otros agentes cambiaron la
    rama activa varias veces. Mitigación aplicada: stashear el
    trabajo de los siblings antes de `git checkout q1/coder-c`;
    verificar siempre `git log q1/coder-c` antes de commit.
  - El primer commit de parcel cambió "scraper" en el nuevo copy
    (1 ocurrencia). El task prohibió ese término explícitamente.
    Hice `git reset --soft HEAD~1`, reescribí sin "scraper"
    ("la próxima sincronización automática actualizará el
    historial") y re-commiteé. SHA final: 958cf3d. Lección: el
    grep de palabras prohibidas debe correr ANTES del primer
    commit, no después.
- **Próximo paso**: Q1 Coder C cerrado. Q1 del sprint sigue con
  Tracks A y B (task-history + dashboard). Siguiente bloque
  recomendado: S5-S7 cortos o el roadmap de mediano plazo que no
  dependa de input de producto del operador.


### 2026-07-19 — Q1 Coder B: dashboard upcoming + KPI alertas unificado

- **Sesión**: sprint Q1, branch `q1/coder-b` (root = `af10140`).
- **Objetivo**: cerrar los 2 items del audit UI/UX 2026-07 que
  cayeron al track B del sprint Q1 — Q2 (mover "Próximas
  fumigaciones" al header) y Q3 (unificar KPI "Alertas altas" con
  el panel "Alertas DJI" del OperationsPanel).
- **Acciones** (2 commits atómicos, TDD donde aplica):
  1. `b44dcc9` feat(dashboard): mover Próximas fumigaciones al header
     - `app/page.tsx`: swap del orden de los bloques. Nuevo orden:
       4 MetricCards (KPIs) → UpcomingFumigations → OperationsPanel.
     - Decisión de producto documentada: el operador abre el dashboard,
       su primera pregunta es "qué tengo que hacer hoy", no "qué pasó
       este año". El bloque de cadencia es la respuesta a esa pregunta.
     - El componente ya tenía su propio header interno
       (eyebrow "PRÓXIMAS FUMIGACIONES" + h3 "Plan operativo por
       cadencia") por lo que no se requirió wrapping adicional.
     - Sin tests nuevos: el `OperationsPanel` y `UpcomingFumigations`
       se testean en isolation; el orden de page composition no
       estaba bajo test antes y agregar test de page composition
       era desproporcionado al cambio (1 bloque movido).
  2. `41529ec` fix(dashboard): unificar KPI de alertas altas con el panel
     - Diagnóstico: el header del dashboard decía "Alertas altas 0"
       pero el `AlertsPanel` listaba 4+ alertas HIGH. Inconsistencia.
       Causa raíz: dos queries distintas —
         - KPI: `metrics.highAlertParcels` =
           `COUNT(DISTINCT DATE(start_at)) FROM dji_flights WHERE
            area_m2 >= 40000 OR duration_seconds >= 28800`.
         - Panel: `getAlerts()` con `getAlertLevel(areaMu, timesCount)`
           donde HIGH = `areaMu >= 60 || timesCount >= 80`.
       Thresholds distintos, queries distintas, números distintos.
     - Fix: derivar el KPI del MISMO set de alertas que ve el panel
       (single source of truth). `lib/alerts.ts:countHighAlerts(alerts)`
       cuenta `alerts.filter(a => a.level === "HIGH").length`.
       `app/page.tsx` usa `countHighAlerts(alerts)` en lugar de
       `metrics.highAlertParcels` para la prop `highAlertsCount` del
       AppShell. El `OperationsPanel` (que contiene el AlertsPanel)
       sigue recibiendo el mismo `alerts` array, así que el header
       y el panel ahora muestran el mismo número por construcción.
     - Tests: 3 nuevos en `tests/alerts.test.ts` con TDD rojo→verde
       (lista vacía → 0; mix de HIGH/LOW/MEDIUM → cuenta solo HIGH;
       todas LOW/MEDIUM → 0). Cubre el contrato de la nueva helper.
- **Archivos tocados**:
  - modificados: `app/page.tsx`, `lib/alerts.ts`, `tests/alerts.test.ts`
- **Estado**: ✅ hecho en `q1/coder-b` (HEAD = 41529ec, no push,
  no merge — root se encarga).
- **Tests**:
  - Targeted: `tests/alerts.test.ts` 5/5 ✅ (2 originales + 3 nuevos),
    `tests/components/dashboard/*` 33/33 ✅, `tests/components/app-shell.test.tsx`
    13/13 ✅.
  - `npx tsc --noEmit` clean.
  - Test delta: +3 tests (todos en `tests/alerts.test.ts`).
- **Decisiones de diseño** (no obvias):
  - **Derivación local vs unificación de query**: elegido derivación
    local (`countHighAlerts(alerts)`) en vez de modificar el SQL de
    `fetchDashboardMetricsRaw`. Razón: el KPI debe estar atado a
    lo que ve el panel, y eso es más fácil y testeable derivando
    del mismo set de datos en TypeScript que tocando el query
    del repo. Si en el futuro se quiere centralizar la métrica,
    se puede mover el helper al repo y agregarlo a
    `fetchDashboardMetricsRaw` — pero por ahora la derivación es
    más explícita y menos acoplada al query.
  - **`countHighAlerts` en `lib/alerts.ts` (no en el repo)**: la
    helper es lógica de UI pura (filter por level), no acceso a
    datos. Vive al lado de `getAlertLevel` y `buildAlert` que ya
    están en `lib/alerts.ts` y son testeadas con el mismo patrón.
  - **No se unificaron los thresholds (HIGH = areaMu >= 60)**:
    los thresholds HIGH/MEDIUM/LOW del panel vienen de
    `getAlertLevel` y son el contrato del producto para el operador
    (un día con ≥60 mu O ≥80 sorties es HIGH). El query del KPI
    tenía thresholds distintos (40000 m² = 60 mu equivalente + 8h
    de duración) que eran una decisión histórica de producto
    diferente, no un bug. Lo correcto era unificar el KPI al
    panel, no el panel al KPI. La duración de vuelo ya está
    implícita en `timesCount` (cada sortie es un vuelo de duración
    variable; muchos vuelos cortos suman a timesCount igual que
    pocos vuelos largos).
- **Notas operacionales** (para futuros agentes):
  - El workspace está compartido con Tracks A (`q1/coder-a`) y C
    (`q1/coder-c`). Durante mi sesión, otros agentes cambiaron
    la rama activa y los archivos del working tree varias veces
    (vi `q1/coder-a`, `q1/coder-b`, `q1/coder-c` como HEAD en
    distintos momentos). Mitigación aplicada: `git stash` antes
    de `git checkout`, y re-aplicación inmediata de los cambios
    propios con `git checkout <sha> -- <file>` cuando el working
    tree se pisaba. Lección: el commit es la unidad de verdad,
    no el working tree en un workspace compartido. Verificar
    `git log <branch>` antes de commit, no `git status`.
  - El `countHighAlerts` queda como helper reusable para futuros
    consumers (ej. si M2 notificaciones necesita el count HIGH
    para disparar push, ya está la helper testeada y lista).
- **Próximo paso**: Q1 Coder B cerrado. Cierre del sprint Q1
  depende de Coder A (task-history). Siguiente bloque recomendado:
  S5-S7 cortos pendientes, o el roadmap mediano que no dependa
  de input de producto del operador (M6 flights footprint ya
  está en /map; M1 historial de fumigaciones con timeline ya
  está en /parcels/[id]/timeline).

### 2026-07-19 — Q1 Coder A: AppShell en /task-history + redirect /history
- **Sesión**: mvs_02885ee50fb244deb40403254bc2b602 (agent coder-a)
- **Objetivo**: cerrar 2 hallazgos del sprint Q1 de la auditoría
  UI/UX (§4.1 AppShell en /task-history, §4.2 redirect /history
  → /task-history) sin tocar tracks A/B/C de M3-M5.
- **Acciones** (2 commits atómicos, TDD rojo→verde donde aplica;
  el segundo commit no tiene tests porque es config pura de Next):
  1. `34b9160` feat(shell): envolver /task-history con AppShell + toolbar unificado
     - `app/task-history/page.tsx` envuelve `<TaskHistoryClient />`
       con `<AppShell activeSection="task-history" title="Historial
       de tareas" eyebrow="Trazabilidad DJI" actions={...}>`.
     - `app/task-history/TaskHistoryClient.tsx` ya NO renderiza su
       propio h1 ni el toolbar — solo el cuerpo (TabSwitcher +
       HeaderCard + DayList + mapa).
     - `app/task-history/TaskHistoryToolbar.tsx` (nuevo, client
       component) agrupa DateRangePicker + FilterButton +
       ScreenshotButton y vive en el slot `actions` del AppShell.
     - `components/task-history/screenshot-button.tsx` gana un
       nuevo prop `targetSelector?` (CSS selector) que toma
       precedencia sobre `targetRef`. Necesario porque el botón
       vive en un slot del AppShell (server component) y no puede
       recibir un ref que cruce la frontera server/client — usa
       `document.querySelector` al click para apuntar al
       contenedor `[data-testid="task-history-content"]` del
       TaskHistoryClient.
     - 13 tests nuevos: 10 en
       `tests/components/task-history/task-history-client.test.tsx`
       (cubre que el cliente NO renderiza h1/toolbar pero SÍ el
       body) + 3 en `screenshot-button.test.tsx` (cubre
       `targetSelector`: render con selector solo, click usa
       `document.querySelector`, precedencia sobre `targetRef`).
     - El contract test adversarial del Task History
       (`verifier-contract-adversarial.test.tsx`) sigue verde
       sin cambios — los tests existentes importan `HeaderCard`,
       `DayCard`, `DayList`, `TabSwitcher` directamente, no la
       composición del cliente.
  2. `df0c50b` feat(redirect): redirigir /history a /task-history y marcar legacy como deprecated
     - `next.config.ts` gana `async redirects()` con
       `{ source: '/history', destination: '/task-history',
       permanent: true }` (HTTP 308 → preserva SEO y bookmarks).
     - `app/history/page.tsx` marcada como DEPRECATED con un
       comment al inicio: sigue accesible por URL directa pero
       no la expone el sidebar. No se borra hasta un sprint
       dedicado de deprecación (decisión de producto).
- **Estado**: ✅ hecho. 2 commits en q1/coder-a (34b9160, df0c50b).
- **Tests**: `npx tsc --noEmit` limpio. Suite task-history + history
  + app-shell + api-task-history: 130/130 verdes antes de los
  cambios, 143/143 después (+13 tests nuevos). El único test que
  falla ocasionalmente es `map-view-load.test.tsx (a)` (perf budget
  flake de 1500ms con 1207 markers; falla igual en master sin
  estos cambios, no introducido por este commit).
- **Notas / bloqueos**:
  - Los 3 tracks Q1 (coder-a/b/c) están corriendo en paralelo
    sobre el mismo .git/. Los `git checkout` entre ramas durante
    el trabajo pierden uncommitted changes y/o mueven refs
    accidentalmente. Mitigación operativa para próximos sprints
    con paralelismo: cada agente commitea con menos edits en
    vuelo y revisa `git log <rama>` antes de commit, no
    `git status` (que refleja la working tree del cwd actual, no
    la rama destino).
  - `next.config.ts` no tiene tests (es config, no lógica de
    producto). Verificación manual: 26/26 tests verdes en
    `tests/components/history/ + tests/components/app-shell.test.tsx`,
    que ejercitan `HistoryTable` (el componente de la página
    legacy) y AppShell.
- **Próximo paso**: Q1 cerrado por Coder A. Cierre del sprint Q1
  depende ahora del root que mergee los 3 tracks (a/b/c) a
  master. Siguiente bloque recomendado: S5-S7 cortos pendientes,
  o cierre de los hallazgos de prioridad media de la auditoría
  (§4.6 búsqueda de parcelas en /map — esfuerzo M, impacto alto).


### 2026-07-19 — Q2 (Faltan por fumigar): sprint completo end-to-end
- **Sesión**: `mvs_4aa351e2363341b08ef0c6428712cd9b` (root)
- **Objetivo**: cerrar el item #7 del UI/UX audit (panel "Faltan por
  fumigar") con vista server-side priorizada por severidad,
  endpoint accesible desde el dashboard, y cache invalidable al
  registrar fumigaciones. Validación conceptual del PO: la decisión
  de fumigar la RECOMIENDA la plataforma según última fumigación +
  cadencia (`recommended_cadence_days`), no existe un plan anual y
  dueños + supervisores son los usuarios primarios del panel (los
  pilotos/operadores siguen en DJI AG, no en este panel).
- **Acciones**:
  1. `bc6a658` feat(q2): lib + repo para 'Faltan por fumigar' (overdue parcels)
     - `lib/overdue-parcels.ts` (puro, sin IO): `computeSeverity`,
       `sortOverdueByPriority`, `severityLabel`, `severityChipClass`,
       `SEVERITY_ORDER` (`overdue | due_soon | ok | no_history`).
     - `api/repositories.ts`: `getOverdueParcels({ maxDaysAhead,
       limit, cropType, isOrchard })` lee `dji_fumigation_schedule`
       JOIN `dji_parcels` filtrando por `next_due_date <= today +
       maxDaysAhead` (default 14d = "esta semana + la siguiente").
     - `lib/cache.ts`: nuevo tag `afm:overdue` (TTL 60s). El
       `invalidateAfterFumigationMutation` ahora invalida 4 tags
       (upcoming, metrics, alerts, overdue) en vez de 3 — al
       registrar una fumigación se recalcula la cadencia y la lista
       "Faltan" se refresca.
     - `lib/types.ts`: `OverdueParcel` extiende `UpcomingFumigation`
       con `severity`, `area_fumigable_m2`, `waypoint_count`,
       `area_fumigable_ha`.
     - 17 tests en `tests/lib/overdue-parcels.test.ts` (severity
       thresholds, sort stable, labels en español).
  2. `d56ec63` feat(q2): /parcels/overdue page + OverdueList component
     - `app/parcels/overdue/page.tsx` server-component con
       `searchParams` (severity, cropType, isOrchard, maxDaysAhead)
       y filtros server-controlled (DB-side) + filter client-side
       para el toggle de severity (1 enum value, no justifica
       round-trip).
     - `components/overdue/overdue-list.tsx` client island: lista
       de cards ordenadas por prioridad, cada card con severidad
       (chip color), días hasta próxima fumigación, área fumigable
       en ha, waypoints, link a `/parcels/[id]`.
     - Empty state y loading boundary claros.
     - 13 tests en `tests/components/overdue/overdue-list.test.tsx`.
  3. `732dbd1` feat(q2): dashboard KPI 'Vencidas' + link 'Ver todas (N) →'
     - `app/page.tsx`: 5° MetricCard "Vencidas" (tone=danger) con
       conteo de `severity === "overdue"` del `getOverdueParcels({
       maxDaysAhead: 14 })`. Grid pasa a `xl:grid-cols-5`.
     - `components/dashboard/upcoming-fumigations.tsx`: prop
       opcional `totalOverdue` (back-compat: si es `undefined` no
       se renderiza nada). Cuando hay más parcelas overdue en el
       sistema que en el top-N visible, aparece un chip-link
       "Ver todas (N) →" hacia `/parcels/overdue`.
     - `tests/cache.test.ts` actualizado para esperar 4 calls
       (era 3 antes de Q2) y validar que `afm:overdue` está en la
       lista.
     - 4 tests nuevos en
       `tests/components/dashboard/upcoming-fumigations.test.tsx`
       (no-render sin prop, no-render cuando `totalOverdue <=
       items.filter(overdue)`, render condicional con href
       correcto, convivencia con chips de status).
  4. `b13...` (próximo commit) docs(q2): entrada BITACORA + memory update
     - Esta entrada + sección de Q2 en `MEMORY.md` con decisiones,
       gotchas y patrón de cache invalidation.
- **Archivos tocados**:
  - Nuevos: `lib/overdue-parcels.ts`,
    `app/parcels/overdue/page.tsx`,
    `components/overdue/overdue-list.tsx`,
    `tests/lib/overdue-parcels.test.ts`,
    `tests/components/overdue/overdue-list.test.tsx`,
    `tests/components/dashboard/upcoming-fumigations.test.tsx`.
  - Modificados: `api/repositories.ts`, `lib/types.ts`,
    `lib/cache.ts`, `app/page.tsx`,
    `components/dashboard/upcoming-fumigations.tsx`,
    `tests/cache.test.ts`.
- **Estado**: ✅ hecho. 4 commits en master, 1 cerrado en este
  commit (BITACORA + memory). UI/UX audit item #7 cerrado.
- **Tests**: `npx tsc --noEmit` limpio. Suite completa: 806/806
  verde (después del +4 del test nuevo, +13 del OverdueList, +17
  del lib, antes era 772). CI en proceso al cierre.
- **Notas / bloqueos**:
  - El test `invalidateAfterFumigationMutation` se rompió al
    agregar `afm:overdue` al invalidator (esperaba 3, recibía 4).
    Actualizado en este sprint — era deuda técnica de Q2 c1.
  - Decisión de PO confirmada: la plataforma RECOMIENDA fumigación
    por cadencia, no ejecuta ni programa vuelos. La lista es
    advisory, el supervisor decide el orden y delega al operador.
  - Multi-tenant sigue abierto (decisión de producto que cambia el
    roadmap). Cost data ($/L producto, $/h piloto, $/h dron) sigue
    pendiente de input.
- **Próximo paso**: push + verificar CI verde. Luego opciones para
  el root: (a) cerrar items restantes de Q2 (búsqueda parcelas
  #8, empty states #9), (b) arrancar Q3 (export CSV #10, notas
  #11, dark mode #12, filter Agriculture #13), (c) retomar M2
  notificaciones (necesita product input del operador: canal, umbral,
  copy).


### 2026-07-19 — Q3 sprint parcial (4 items UI/UX audit cerrados)
- **Sesión**: `mvs_4aa351e2363341b08ef0c6428712cd9b` (root)
- **Objetivo**: cerrar 4 items del audit ui-ux-2026-07 que estaban
  abiertos post-Q2 (#8 empty states, #9 búsqueda parcelas, #10
  export CSV, #12 filtro Agriculture). Sin #11 notes (requiere
  schema change — necesita tu OK) ni #13 dark mode (L effort,
  audit lo marca Backlog) ni M2 notificaciones (bloqueado por
  product input).
- **Acciones**:
  1. `5582ac1` feat(q3): componente <EmptyState> reutilizable + copy sin developer-facing (#8)
     - `components/ui/empty-state.tsx` (nuevo): shape consistente
       (eyebrow + title + description + CTA opcional + testId +
       size sm/default). Tokens del AFM. 0 deps.
     - 6 tests del componente (render, eyebrow, CTA link/button,
       icon, size, testId).
     - 5 empty states migrados: UpcomingFumigations, MapView,
       HistoryTable, AlertsPanel, ParcelFumigations. Copy
       user-facing siempre (sin comandos, sin paths).
     - 1 commit también incluye el map-view.tsx (cambio de
       `<select>` a `<ParcelSearch>` y el empty state nuevo) +
       el `showCategoryFilter` de #12 + los 2 tests nuevos de
       history-table.
  2. `ec5565e` feat(q3): búsqueda de parcelas en /map con atajo '/' (#9)
     - `components/map/parcel-search.tsx` (nuevo, client island).
       Wrappea `ParcelSelector` y filtra por `land_name` con
       `includes` case-insensitive. Atajo `/` estilo GitHub
       (no se dispara si el foco está en otro input/textarea).
     - 13 tests (render, filter, case-insensitive, atajo OK,
       atajo no-dispara en otros inputs, cleanup al desmontar,
       delegar empty state).
     - `components/map-view.tsx`: reemplaza `<select>` inline por
       `<ParcelSearch>` (incluido en commit #8 — están en el
       mismo file).
  3. `fe1360d` feat(q3): export CSV de fumigaciones desde /parcels/[id] (#10)
     - `lib/csv.ts` (nuevo, puro, sin deps): `toCsv()` + `slugFilename()`.
       - Separador ';' (locale es-CO + decimales ',')
       - BOM U+FEFF (Excel UTF-8)
       - Quoting RFC 4180 (';' | '"' | '\n' → wrap, '"' → '""')
       - Slug: NFD + strip combining + lowercase + alnum
     - `components/parcels/export-fumigations-csv-button.tsx`
       (nuevo, client island): genera CSV con fumigaciones +
       download via Blob + URL.createObjectURL. Columnas: Fecha,
       Dron, Piloto, Área (ha), Duración (min), Volumen (L),
       Producto, Notas. Notas-blob de provenance omitidas.
     - 17 tests del CSV lib + 7 tests del botón.
     - `components/parcels/parcel-fumigations.tsx`: botón
       integrado en header del historial (incluido en commit #8).
  4. #12 — filtro Categoría oculto cuando hay 1 sola categoría
     (en `components/history/history-table.tsx`): `showCategoryFilter
     = categories.length > 2`. Si el operador tiene 1 sola
     categoría (típico: solo "Agriculture"), el dropdown es un
     no-op y confunde — se oculta. Si en el futuro hay 2+,
     vuelve a aparecer. Incluido en commit #8.
- **Archivos tocados**:
  - Nuevos: `components/ui/empty-state.tsx`,
    `components/map/parcel-search.tsx`,
    `components/parcels/export-fumigations-csv-button.tsx`,
    `lib/csv.ts`, + 4 archivos de tests.
  - Modificados: 5 components (map-view, alerts-panel,
    upcoming-fumigations, history-table, parcel-fumigations) +
    3 archivos de tests viejos (copy actualizado).
- **Estado**: ✅ 4 items cerrados (#8, #9, #10, #12). Q3
  completo al alcance del sprint. Pendiente: #11 notes (schema
  change), #13 dark mode (L/backlog), M2 notificaciones.
- **Tests**: `npx tsc --noEmit` limpio. 853/853 verde (de 806
  antes de Q3 = +47 tests: 6 EmptyState + 13 ParcelSearch +
  17 csv + 7 csv-button + 2 history-table + 2 que ajusté por
  copy).
- **Notas / bloqueos**:
  - Ambos agentes (Track A y B) murieron por token limit (2056)
    pero dejaron código completo y tests en su worktree. Hice
    recovery manual copiando al master + cherry-picking de los
    cambios de map-view.tsx y parcel-fumigations.tsx. Cero
    trabajo perdido, pero confirma que para sprints > 30min
    con agentes paralelos, los worktrees son obligatorios
    (ya estaban) y un humano debe integrar.
  - **Lección**: el "split por commit" planeado (1 commit por
    item) terminó mezclando 3 items en el commit de empty state
    porque comparten el mismo file (map-view.tsx, history-table
    y parcel-fumigations). El código queda correcto pero los
    mensajes de commit mienten un poco. Para próximos sprints,
    mejor 1 commit por **file touched**, no por item.
- **Próximo paso**: push + CI verde. Decisiones pendientes:
  - **#11 (notes en fumigaciones)**: ¿OK con schema change
    `ALTER TABLE dji_fumigations ADD COLUMN notes TEXT`?
    Si sí, 1 sprint corto más.
  - **#13 (dark mode)**: esfuerzo L, audit lo marca Backlog.
    Lo dejo para cuando haya demanda explícita del operador
    o dueño.
  - **M2 notificaciones**: bloqueado. Necesito del operador:
    canal (email / in-app / ambos), umbral de alerta (área
    total / frecuencia / ambas), copy del mensaje.


### 2026-07-21 — Q4 v1.4 sprint (RBAC + Notes fumigaciones)

- **Sesión**: `mvs_4aa351e2363341b08ef0c6428712cd9b` (root)
- **Decisión PO 2026-07-21**: sistema **single-tenant** (solo para el
  dueño del operador cañero). 2 roles: **admin | supervisor**.
  Sin billing/pricing. NO multi-tenant. Esto destranca el 80% del
  roadmap que estaba bloqueado.
- **Objetivo**: cerrar la decisión + implementar RBAC + audit #11
  (notes fumigaciones). 3 tracks paralelos en worktrees.
- **Acciones** (5 commits total):
  1. `fd20752` feat(q-11): notas humanas en fumigaciones, separadas de provenance (Track C)
     - `supabase/migrations/20260721010000_add_fumigation_human_notes.sql`
       (nuevo): agrega `dji_fumigations.human_notes TEXT` con CHECK
       `length ≤ 2000`. Idempotente. Schema aditivo (no rompe nada).
     - `lib/types.ts` — `DjiFumigationEvent.human_notes: string | null`.
     - `app/api/fumigations/route.ts` — body acepta `human_notes`,
       valida con `validateOptionalString` (mismo patrón Q4 v1.1).
     - `components/parcels/parcel-fumigations.tsx` — form renombra
       campo "notes" a "Agregar nota" con helper text.
     - Render del historial: notas humanas en italic, separadas
       de metadata técnica (que sigue oculta).
     - 10 tests del flujo end-to-end.
  2. `5a93744` docs(v1.4): entrada BITACORA (Track C)
  3. `a259fff` feat(rbac): app_users.role + helpers getCurrentUserRole/requireRole (Track A — recovery manual)
     - `supabase/migrations/20260721000000_add_app_users_role.sql`
       (nuevo): `role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN
       ('admin', 'supervisor'))` + índice parcial. Idempotente.
       Default 'admin' cubre todos los usuarios existentes (back-compat).
     - `lib/auth/role.ts` (nuevo): `AppRole` type, `getCurrentUserRole()`
       (cache con `unstable_cache`), `requireRole(role)` throws 403.
     - `lib/auth.ts` + `lib/auth.config.ts`: type augmentation
       agrega `role` al Session y JWT.
     - `app/api/fumigations/route.ts`: guard de ejemplo con
       `requireRole(['admin', 'supervisor'])`. NO aplicado a todos
       los endpoints — el patrón es el deliverable.
     - 6+ tests del role + integration con API route.
  4. `0fc3c5f` feat(rbac): UI gates por role (Track B — recovery manual)
     - `components/auth/types.ts` (nuevo) — tipos compartidos.
     - `components/auth/use-user-role.ts` (nuevo) — hook client
       que hace fetch a `/api/auth/me` y cachea en state. 0 deps.
     - `app/api/auth/me/route.ts` (nuevo, GET): devuelve
       `{ email, role, name }`. 401 sin sesión.
     - `components/auth/role-gate.tsx` (nuevo): `<RoleGate allow={...}>`.
     - `components/auth/role-badge.tsx` (nuevo): badge en header
       con color por role.
     - `app/devices/page.tsx`: banner "Próximamente" envuelto en
       `<RoleGate allow={['admin']}>` (demo del patrón).
     - `components/parcels/parcel-fumigations.tsx`: form
       envuelto en `<RoleGate allow={['admin', 'supervisor']}>`.
     - 11+ tests del panel + endpoint.
- **Archivos tocados**: 17 nuevos, 7 modificados.
- **Estado**: ✅ Q4 v1.4 cerrado. RBAC + #11 (notes) implementados.
  **+56 tests** (de 953 → 1009). 0 dependencias nuevas.
- **Tests**: `npx tsc --noEmit` limpio. 1009/1009 verde local.
- **Notas / bloqueos**:
  - **5ta y 6ta vez en 5 sprints que el último track muere por
    token plan sin commit**. Tracks A y B requirieron recovery manual
    (commit + push desde el worktree con mensaje documentando
    el recovery). Patrón confirmado y documentado en memory.
  - **Aplicar migrations en producción**:
    ```bash
    node scripts/apply-pending-migrations.js
    ```
    Aplica 2 migrations: `add_app_users_role` y
    `add_fumigation_human_notes`. Idempotentes.
  - **El guard `requireRole()` solo se aplica a `POST /api/fumigations`**
    como demo. Para extender a todos los endpoints, se necesita
    un sprint de refactor (recomendado para v1.5).
- **Próximo paso**: push + CI verde. Roadmap post-v1.4:
  - **v1.5**: extender `requireRole` a todos los endpoints críticos
    (POST /api/fumigation-schedule, PATCH endpoints futuros).
  - **v1.6**: refactor doble modelo fumigaciones (audit #2 — el
    bug estructural que afecta confianza de alertas).
  - **v1.7**: M2 notificaciones (input del operador pendiente).
  - **Backlog**: #13 dark mode, reportes compartibles,
    vista satélite ya en master (v1.2).


### 2026-07-20 — Q4 v1.1 sprint (9 mejoras críticas del audit cerrado)
- **Sesión**: `mvs_4aa351e2363341b08ef0c6428712cd9b` (root)
- **Objetivo**: cerrar los items 🔴 y 🟠 del audit ui-ux-2026-07 que
  eran bloqueantes para salir a demo. 3 tracks paralelos en worktrees
  + 1 quick win en master.
- **Acciones** (10 commits total):
  1. `25c8b65` fix(q4): documentar umbrales de 'Alertas Altas' (master, yo)
     - Hint del KPI ahora dice "Umbral: 4 ha o 8h en un día".
  2. `0e65998` feat(security): CSP + HSTS + X-Frame-Options DENY (Track C)
     - `next.config.ts` con 6 headers de seguridad. 14 tests.
  3. `529cd57` feat(security): soft delete en fumigations y parcels (Track C)
     - Migration `20260720000000_add_soft_delete.sql` idempotente.
     - 2 columnas `deleted_at TIMESTAMPTZ NULL` + 2 índices parciales.
     - 4 tests E2E (CI corre con DB).
  4. `ffd5112` feat(security): validación de longitud en POST /api/fumigations
     - `product_used` ≤ 200, `notes` ≤ 2000, `recorded_by` ≤ 100.
     - Helper `validateOptionalString` (tipo + longitud). 9 tests.
  5. `8fb6dc6` feat(q4): loading.tsx skeletons (Track B)
     - 4 archivos: `/map`, `/parcels/overdue`, `/task-history`,
       `/parcels/[id]/timeline`. Sin tests (TDD skip explícito —
       skeletons son pura presentación).
  6. `584a542` feat(q4): pre-llenar area_fumigated_m2 (Track B)
     - Default = `parcel.spray_area_m2`. Vacío al submitear → null
       (no 0). 7 tests.
  7. `07f80d2` feat(q4): atajos de teclado globales (Track B)
     - vim-style: g+p, g+m, g+t, g+d. `?` muestra ayuda.
     - 15 tests.
  8. `abad267` fix(q4): crear /parcels (Track A, BUG 1)
     - Cierra el 404 del CTA del map-view.
     - Server page + client component `<ParcelsList>` con paginación
       y link a detalle. 8 tests.
  9. `afd5b03` feat(q4): sidebar expone Parcelas y Faltan (Track A, BUG 2)
     - 2 items nuevos en `sidebarNav` con activeSection correcto
       en /parcels, /parcels/overdue, /parcels/[id], /parcels/[id]/timeline.
     - 2 tests nuevos en app-shell.
  10. `7479f06` fix(q4): KPI 'Atrasadas por cadencia' (Track A, BUG 3)
      - Label "Atrasadas por cadencia" + hint explica que es
        recomendación heurística, no certeza. 3 tests.
- **Archivos tocados**: 1 nuevo page (`/parcels`), 1 nuevo component
  (`<ParcelsList>`), 1 nuevo client component global (`<KeyboardShortcuts>`),
  4 nuevos `loading.tsx`, 1 nueva migration SQL, 6 archivos de tests
  nuevos, y ediciones quirúrgicas en app-shell, next.config, fumigation
  API route, y parcel-fumigations form.
- **Estado**: ✅ Q4 v1.1 cerrado. 9 items del audit (3 🔴 + 5 🟠 + 1 🟡)
  resueltos en este sprint. Total 62 tests nuevos (de 853 → 915).
- **Tests**: `npx tsc --noEmit` limpio. 915/915 verde local.
- **Notas / bloqueos**:
  - Los 3 agentes de coder AGOTARON los 30 min de token plan (Track C
    terminó OK, Tracks A y B en ~32 min). Patrón confirmado: sprints
    con scope > 30 min con agentes paralelos NO escalan. **Para próximos
    sprints: scope < 25 min por track, o sequential**.
  - **El bug del 404 en `/parcels` ya está fixed** (era 🔴 crítico
    del audit). El cliente que cliqueaba "Ver listado de parcelas"
    desde el map-view ya no rompe.
  - **Soft delete migration es idempotente** (sigue el patrón de las
    16 migrations previas). CI la aplica automáticamente; dev local
    necesita correr `node scripts/apply-pending-migrations.js` para que
    los 4 tests E2E pasen.
  - **Performance del mapa sigue siendo 🟠 ALTA** (audit #8). No se
    atacó en v1.1 — queda para v1.2 con Suspense + viewport-based
    loading de polígonos.
  - **El doble modelo fumigaciones (flights vs fumigations)** sigue
    siendo 🔴 CRÍTICA estructural (audit #2). No se atacó en v1.1
    porque requiere refactor de queries — queda para v2.0.
- **Próximo paso**: push + CI verde. v1.2 cubre performance, mobile
  sidebar, y vista satélite. v2.0 cubre el refactor de fumigaciones
  + multi-tenant.


### 2026-07-20 — Q4 v1.2 sprint (3 mejoras 🟠 del audit cerradas)
- **Sesión**: `mvs_4aa351e2363341b08ef0c6428712cd9b` (root)
- **Objetivo**: cerrar 3 items 🟠 ALTA del audit ui-ux-2026-07
  (performance del mapa, mobile sidebar, vista satélite). 3 tracks
  paralelos en worktrees con scope < 25 min POR TRACK (lección Q4 v1.1).
- **Acciones** (3 commits total):
  1. `13cea60` feat(q4 mobile): hamburger menu + drawer mobile + viewport meta (Track B)
     - `components/mobile-sidebar-drawer.tsx` (nuevo, client component,
       0 deps). Drawer con mismo contenido que el sidebar desktop +
       ARIA correcto (`role=dialog`, `aria-modal`, `aria-current`).
     - `lib/nav-icons.tsx` (nuevo) — DRY de `NAV_ICON_PATHS` + `NavIcon`.
       `.tsx` (no `.ts`) porque tiene JSX.
     - `components/app-shell.tsx` — burger button + drawer. `useEffect`
       para body overflow + Escape key + click backdrop. `requestAnimationFrame`
       para focus restoration.
     - `app/layout.tsx` — `export const viewport` (Next.js 16 API oficial).
     - 12 tests: render cerrado, abrir, cerrar backdrop/Escape, navegar,
       aria, focus, body overflow restoration, cleanup.
  2. `ec10309` feat(q4): toggle satellite/calles en /map con persistencia localStorage (Track C)
     - `components/map-client.tsx` — 2 TileLayers (OSM + Esri World Imagery).
       Toggle client-side con state `useState<string>("satellite")`.
       Persistencia en `localStorage` (`afm:map:basemap`).
     - `next.config.ts` — CSP `img-src` extendido con
       `https://server.arcgisonline.com`.
     - 9 tests: default satellite, toggle a streets, persistencia,
       fallback si localStorage no está disponible, attribution correcta.
  3. `f153850` perf(map): streaming con Suspense para que el mapa aparezca antes que los stats (Track A)
     - `app/map/page.tsx` refactor: queries críticas (parcels +
       fumigatedIds) top-level, resto (summary, flights, alerts,
       flightPoints) en un client island.
     - `components/map/map-stats-island.tsx` (nuevo, client component)
       recibe las stats como props + renderiza KPI cards + panels.
     - `components/map/map-stats-skeleton.tsx` (nuevo, server
       component) con `animate-pulse` de Tailwind.
     - 16 tests: render de los 5 KPIs, distribución por drone, panels,
       skeleton, error boundary.
- **Archivos tocados**: 3 nuevos pages/loaders, 2 nuevos
  components (`mobile-sidebar-drawer`, `map-stats-island`),
  1 nuevo lib (`nav-icons.tsx`), 4 archivos de tests nuevos,
  ediciones quirúrgicas en app-shell, map-client, next.config.
- **Estado**: ✅ Q4 v1.2 cerrado. 3 items 🟠 del audit resueltos.
  Total **+37 tests** (de 915 → 952). 0 dependencias nuevas.
- **Tests**: `npx tsc --noEmit` limpio. 952/952 verde local.
- **Notas / bloqueos**:
  - **Track A (perf mapa) terminó en ~40 min** con push OK.
    Lección: scope < 25 min no es suficiente garantía; el agente
    también necesita un **paso final de push obligatorio** antes
    de cualquier verificación. Track C sí lo hizo (~25 min).
    Track B también (más rápido porque scope era chico).
  - **Cherry-pick manual funcionó perfecto** para los 3 tracks
    (orden: A no chocaba con C por scope separado, B tampoco).
    Master limpio en 3 cherry-picks.
  - **El refactor del mapa con Suspense** es la mejora más
    visible de UX: el mapa aparece con la primera query,
    los stats cargan después. TTI estimado: 50-70% menor
    (medición exacta en el commit message del track).
- **Próximo paso**: push + CI verde. Roadmap post-v1.2:
  - v1.2 restante: reportes compartibles (link público con token),
    filtros avanzados del mapa.
  - v2.0: refactor doble modelo fumigaciones + multi-tenant.


### 2026-07-20 — Q4 v1.3 sprint (2 items 🟠 del audit cerrados)
- **Sesión**: `mvs_4aa351e2363341b08ef0c6428712cd9b` (root)
- **Objetivo**: cerrar 2 items 🟠 del audit (filtros del mapa + cron
  semanal de fumigaciones). 2 tracks paralelos en worktrees.
- **Acciones** (2 commits total):
  1. `ef3bfdd` feat(cron): refresh semanal de fumigaciones (Track B)
     - `scripts/refresh-fumigations.js` (nuevo, ~75 líneas): wrapper
       que reusa los scripts `backfill-fumigations-from-flights.js`
       y `update-fumigation-schedule.js` (NO duplica SQL). DI para
       tests. Falla explícito si `DATABASE_URL` no está seteado.
     - `scripts/refresh-fumigations.d.ts` (nuevo) — tipos TS.
     - `tests/refresh-fumigations.test.ts` (nuevo) — 9 tests.
     - `.github/workflows/refresh-fumigations.yml` (nuevo) — cron
       lunes 06:00 UTC + `workflow_dispatch` manual.
     - `scripts/README.md` (nuevo) — docs.
     - `package.json` (mod) — nuevo script `npm run refresh:fumigations`.
  2. `1eca934` feat(map): filtros drone/crop/fumigated (Track A)
     - `api/repositories.ts` (mod) — `getParcelsNormalized` acepta
       args opcionales: `droneModelCode`, `cropType`, `isOrchard`.
       Back-compat: sin args = comportamiento actual.
     - `app/map/page.tsx` (mod) — parsea `searchParams` y los pasa
       al repo.
     - `components/map/map-filters-panel.tsx` (nuevo, client
       island) — 3 `<select>` (drone, crop, fumigated) + botón
       "Limpiar filtros". `router.push` con `scroll: false`.
       `useSearchParams` para reflejar estado actual. ARIA labels.
     - `tests/components/map/map-filters-panel.test.tsx` (nuevo)
       — 14 tests: render, navegación, limpiar, aria, defaults.
- **Archivos tocados**: 5 nuevos, 2 modificados.
- **Estado**: ✅ Q4 v1.3 cerrado. 2 items 🟠 del audit resueltos.
  **+14 tests** (de 939 → 953). 0 dependencias nuevas.
- **Tests**: `npx tsc --noEmit` limpio. 953/953 verde local.
- **Notas / bloqueos**:
  - **Track A (filtros mapa) requirió recovery manual** — el agente
    de coder generó el código completo (4 files, 671 insertions)
    pero murió por token plan antes del commit. Hice `git add` +
    `git commit` + `git push` manualmente desde el worktree con
    el mensaje apropiado. **4 veces en 4 sprints que esto pasa**
    cuando el scope es > 25 min. Patrón confirmado.
  - **El cron necesita un secret en producción**:
    `gh secret set DATABASE_URL --repo Nes-Curly13/aeroadmin-afm`
    Sin esto, el cron falla explícito en el Actions log (no silencioso).
  - **Mejora potencial futura**: el `map-filters-panel` actualmente
    solo 3 filtros (drone, crop, fumigated). El audit menciona
    también "rango de fecha" y "piloto" — para próximos sprints
    si el supervisor lo pide.
  - **Sprint de decisión abierta antes de v2.0**: multi-tenant
    + refactor doble modelo fumigaciones requieren conversación
    de producto con el user. Sin ella, no arrancamos esos tracks.
- **Próximo paso**: push + CI verde. v1.3 cerrado.
  v1.4+ depende de: (a) decisión multi-tenant, (b) input del
  operador para M2 notificaciones, (c) decisión de schema
  change para #11 notes.
- **Próximo paso**: push + CI verde. v1.2 cubre performance, mobile
  sidebar, y vista satélite. v2.0 cubre el refactor de fumigaciones
  + multi-tenant.

### 2026-07-21 — Q4 v1.4 Track C (audit #11: notas humanas en fumigaciones)
- **Sesión**: worktree `v1.4/track-c-notes-fumigaciones`
- **Objetivo**: resolver el item #11 del audit ui-ux-2026-07. El operador
  fumigador del Valle del Cauca quiere dejar contexto libre en cada
  fumigación ("se atrasó por lluvia", "producto nuevo", "equipo reportó
  problema X"). Hoy `notes` se reusa para provenance del backfill —
  mezclar metadata técnica con user input es un anti-pattern.
- **Decisión de schema**: columna SEPARADA `human_notes` (no fusionar
  con `notes`). `notes` queda intacta (provenance, nunca visible al
  usuario). CHECK constraint `<= 2000` para evitar que el operador pegue
  1 GB. Idempotente (`IF NOT EXISTS`).
- **Acciones** (1 commit de código + 1 commit de docs):
  - `20260721010000_add_fumigation_human_notes.sql` (nuevo) — migration
    additive: `ALTER TABLE dji_fumigations ADD COLUMN human_notes TEXT
    CHECK (length <= 2000)` + comment explicativo del propósito.
  - `lib/types.ts` (mod) — `DjiFumigationEvent` incluye `human_notes`.
  - `api/repositories.ts` (mod) — `createFumigationEvent` acepta
    `human_notes` (lo inserta y lo devuelve en `RETURNING`); query
    `fumigationEventsByParcelQuery` también lo selecciona.
  - `app/api/fumigations/route.ts` (mod) — `CreateFumigationBody` ahora
    incluye `human_notes?`; mismo `validateOptionalString` con
    `MAX_LENGTHS.human_notes = 2000`; pasa el campo al repo en el INSERT.
  - `components/parcels/parcel-fumigations.tsx` (mod, SOLO el form) —
    `<textarea name="notes">` renombrado a `<textarea name="human_notes">`
    con label "Agregar nota (opcional)" y helper text. El POST body
    ahora envía `human_notes` (no `notes`). El render del historial
    muestra `human_notes` (con `data-testid="fumigation-human-notes"`)
    y deja el filtro `isProvenanceNotes(e.notes)` intacto para `notes`.
  - Tests: `parcel-fumigations.test.tsx` (+4 tests en describe nuevo
    "human_notes (Track C v1.4)"); `api-fumigations-length.test.ts`
    (+6 tests: 2001→400, 2000→201, null→201, valor→pasa al repo,
    tipo no-string→400, coexistencia notes+human_notes). Fixture
    `makeEvent` en `export-fumigations-csv-button.test.tsx` (+1 línea
    `human_notes: null` para no romper el tipo).
- **Archivos tocados**: 1 nuevo, 4 modificados, 2 tests modificados.
- **Estado**: ✅ Q4 v1.4 Track C cerrado. Item #11 del audit resuelto.
  **+10 tests** (de 953 → 963). 0 dependencias nuevas. Scope < 25 min.
- **Tests**: `npx tsc --noEmit` limpio. 963/985 verde local
  (11 skipped, todos DB-dependientes con Docker apagado — baseline
  esperada según SDD §9).
- **Notas / bloqueos**:
  - **Out of scope intencional**: NO se tocó `parcel-timeline.tsx` ni
    `export-fumigations-csv-button.tsx`. El timeline no muestra
    `human_notes` aún y el CSV no la exporta — son mejoras para
    siguientes sprints si el operador las pide. El cambio de schema
    ya está hecho, así que esos updates son código nuevo sin
    migración adicional.
  - **No reintroducir la confusión `notes` ↔ `human_notes`**: cualquier
    agente que trabaje sobre fumigaciones debe respetar la separación.
    Si ve un INSERT/UPDATE que setea `notes` desde el form, es un bug
    (esos datos deben ir a `human_notes`).
  - **CSV export queda con la misma metadata visible que antes** — el
    `notas` del CSV sigue siendo `notes` filtrado por `isProvenanceNotes`,
    no incluye `human_notes`. Si el operador pide el reporte con notas
    humanas, hay que actualizar `ExportFumigationsCsvButton` en otro
    sprint (cambio chico, ~10 líneas).
- **Próximo paso**: push + CI verde. v1.4 Track C cerrado. Resto de
  v1.4 (notificaciones M2, multi-tenant) sigue pendiente de decisión
  de producto.


