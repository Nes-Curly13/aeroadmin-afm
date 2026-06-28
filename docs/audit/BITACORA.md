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