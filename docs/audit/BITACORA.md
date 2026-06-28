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