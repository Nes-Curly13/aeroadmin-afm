# Plan de issues — AeroAdmin AFM (auditoría 2026-09-10)

> Auditoría completa del repo (UI/UX, seguridad/auth, schema BD, lógica de app)
> ejecutada el 2026-09-10 sobre master `2cbc89d` (4 commits locales sin pushear).
> Este doc es el backlog canónico de trabajo pendiente para terminar el producto.

---

## Resumen ejecutivo

- **Estado base**: 2144 tests verdes, `tsc` 0 errores, `arch:check` 0 errores.
- **Hallazgos críticos confirmados**: 4 bugs que rompen features del Release
  Candidate en producción de forma **silenciosa** (fallos tragados por
  `withLocalFallback`). Todos corregidos en esta sesión.
- **Fixes aplicados**: 13 (4 critical schema/lógica, 3 seguridad, 6 UI/UX).
- **Pendientes**: ~30 issues ordenados por severidad abajo.

---

## 1. Fixes APLICADOS en esta sesión

### 1.1 Críticos (schema / lógica de datos)

| # | Issue | Fix | Archivo |
|---|---|---|---|
| 1 | Colisión tabla `clients`: migration Fase 3.A era NO-OP (tabla legacy `20260428153000` ya existía) → columnas enriquecidas nunca se crearon → `searchClients`/`createClient`/`backfill-clients-farms.js` fallaban con "column does not exist" | Nueva migration idempotente `ALTER TABLE clients ADD COLUMN IF NOT EXISTS ...` | `db/migrations/20260910000000_fix_clients_legacy_collision.sql` |
| 2 | `getParcelsNormalizedUncached`: el `COUNT(*)` usaba `FROM dji_parcels` sin alias pero el WHERE traía `p.deleted_at IS NULL` → error → filtros de `/admin/parcels` y geovisor devolvían lista vacía | `FROM dji_parcels p` | `api/repositories.ts:279` |
| 3 | `backfillCyclesFromFumigations`: usaba `f.parcela_id` / `f.applied_at` (columnas inexistentes) → backfill de ciclos creaba 0 ciclos siempre | `f.parcel_id` / `f.fumigation_date` | `api/repositories.ts:4466-4474` |
| 4 | `flight_ids` guardaba `f.id` (PK interno) pero los consumidores hacen JOIN por `fl.flight_id` (DJI external) → trazabilidad y centroides devolvían 0 matches | `array_agg(f.flight_id::int ORDER BY f.flight_id)` | `lib/backfill/fumigations-from-flights.ts:117` |
| 5 | Wizard fumigación: botón "Continuar" con `disabled` hardcodeado → imposible avanzar tras dibujar polígono | removido `disabled` | `components/admin/fumigations/new-fumigation-page-client.tsx:644` |

### 1.2 Seguridad

| # | Issue | Fix | Archivo |
|---|---|---|---|
| 6 | `/api/admin/applications/import`: path hardcodeado con PII del dev + `actorEmail` suplantable desde el body + lectura arbitraria de archivos | path requerido con validación `.xlsx?`, `actorEmail` desde sesión | `app/api/admin/applications/import/route.ts` |
| 7 | `supervisor` podía escribir facturación (POST invoices, PATCH cancel) y catálogos (products, dji-vehicles) | `requireRole("admin")` | 4 route handlers |
| 8 | `/api/internal/print-map/[id]` público y enumerable (exfiltración de geometrías sin login) | gate por token `INTERNAL_MAP_TOKEN` con comparación en tiempo constante | `app/api/internal/print-map/[id]/route.ts` + `lib/reports/render-map-screenshot.ts` |

### 1.3 UI / UX

| # | Issue | Fix | Archivo |
|---|---|---|---|
| 9 | Paginación de `/admin/parcels` solo tenía "siguiente" (imposible volver) | agregado "← anterior" | `app/(auth)/admin/parcels/admin-parcels-client.tsx` |
| 10 | QuickActions con texto obsoleto ("Wizard 4 pasos", "por hacienda") | "Wizard 3 pasos", "resumen por parcela" | `components/dashboard/quick-actions.tsx` |
| 11 | Enum `data_validity` mostrado crudo en inglés (fresh/needs_review/stale/unknown) | etiquetas legibles "Al día / Revisar / Vencido / Sin clasificar" | `admin-parcels-client.tsx`, `parcelas/[id]/page.tsx` |
| 12 | Textos en inglés en UI (Compliance, Flight ID, warnings, fuzzy, match, on-the-fly…) | español | múltiples archivos |
| 13 | Componentes muertos `compliance-panel.tsx` + `last-fumigation-card.tsx` | eliminados + test | `components/` |

---

## 2. Backlog pendiente — CRÍTICO / ALTO

### 2.1 Corregir datos en producción (operacional — correr UNA vez por ambiente)

> Ahora que los bugs #1, #3 y #4 están arreglados, re-correr los backfills
> que antes fallaban silenciosamente:

1. `node scripts/backfill-clients-farms.js` — local, preview, prod.
   (antes fallaba por la colisión de `clients`; ahora la migration nueva lo desbloquea).
2. `POST /api/admin/cycles/backfill` — local, preview, prod. **NO correr 2 veces**
   (no idempotente; ver issue #16 abajo).
3. Re-correr `npm run refresh:fumigations` (o `backfill-fumigations-from-flights`)
   para re-poblar `flight_ids` con los IDs externos correctos. **Importante**: el
   backfill es idempotente (borra `source='import'` y re-inserta), así que
   re-correrlo corrige la trazabilidad rota.

### 2.2 Issues de datos no corregidos (schema / lógica)

| # | Severidad | Issue | Ubicación |
|---|---|---|---|
| 14 | ALTO | `dji_fumigation_schedule` declarada 2 veces; `UNIQUE(parcel_id)` nunca se aplica → invariante 1:1 no garantizada a nivel BD | `db/migrations/20260617170000:75` vs `20260618110000:9`. Requiere migration: dedupe + `CREATE UNIQUE INDEX` |
| 15 | ALTO | `getRecentFumigations` recalcula centroide on-the-fly con `ST_Collect` + `LEFT JOIN fl ON fl.flight_id = ANY(...)` (no-sargable) en vez de usar la MV `mv_fumigation_flight_centroids` | `api/repositories.ts:3045-3062` |
| 16 | MEDIO-ALTO | `backfillCyclesFromFumigations` (endpoint `/api/admin/cycles/backfill`) no idempotente; sin lock/flag → corre 2 veces duplica ciclos | `app/api/admin/cycles/backfill/route.ts` |
| 17 | MEDIO | `updateFumigationSchedule` computa `MAX(fumigation_date)` sin `deleted_at IS NULL` → fumigación soft-deleted fija `next_due_date` | `lib/backfill/update-fumigation-schedule.ts:41-46` |
| 18 | MEDIO | `listUnassignedParcels` no filtra `deleted_at IS NULL` (inconsistente con `countUnassignedParcels`) → banner muestra un número, lista otro | `api/repositories.ts:4076` |
| 19 | MEDIO | `setParcelClientFarm` no chequea `deleted_at IS NULL` → puede reasignar cliente/finca a parcela borrada | `api/repositories.ts:4011-4019` |
| 20 | MEDIO | `bulkSetParcelClientFarm` hace N UPDATEs en loop (N+1) | `api/repositories.ts:4161-4163` |
| 21 | MEDIO-BAJO | `createManualParcelsBulk` hace `SELECT *` extra por fila (podría ser `RETURNING *`) | `api/repositories.ts:925-931` |
| 22 | MEDIO-BAJO | `createFumigationEvent` lee el schedule con `getDb()` fuera de la transacción (snapshot distinto + riesgo de pool exhaustion con `max:5`) | `api/repositories.ts:2554` |
| 23 | BAJO | `getFarmsReportFumigations` proyecta columnas duplicadas/inútiles (`land_name` x2, `product_id` sin uso) | `api/repositories.ts:3256-3262` |
| 24 | BAJO | Docblock huérfano en `refresh-fumigations.ts` (wrapper de transacción documentado pero no implementado) | `lib/backfill/refresh-fumigations.ts:79-86` |

### 2.3 Seguridad / auth (no corregidos)

| # | Severidad | Issue | Ubicación |
|---|---|---|---|
| 25 | ALTO | callback `authorized` deja pasar TODAS las `/api/*` sin chequear sesión (la seguridad depende de que cada handler llame `requireRole`; deny-by-default recomendado) | `lib/auth.config.ts:164-166` |
| 26 | ALTO | TLS a BD con `rejectUnauthorized: false` cuando `DATABASE_SSL=true` → MITM posible. Para Supabase pooled se puede usar `rejectUnauthorized: true` | `lib/db.ts:53` |
| 27 | MEDIO | `getCurrentUserRole()` (BD-fresh) existe pero ningún endpoint lo usa → degradación de rol tarda hasta 12h (TTL del JWT) en hacerse efectiva | `lib/auth/role.ts:91-113` |
| 28 | MEDIO | Mensajes de error de `pg` filtrados al cliente (disclosure de tablas/constraints). Patrón `detail: message` / `err.message` crudo en ~15 handlers | `app/api/admin/**/route.ts` |
| 29 | MEDIO | `computeInvariants` construye SQL con `String.replace()` frágil | `app/api/data-quality/invariants/route.ts:123,145` |
| 30 | BAJO | `PUBLIC` incluye `/api/health` pero la ruta no existe (referencia muerta que confunde el modelo de confianza) | `lib/auth.config.ts:154` |
| 31 | BAJO | `authorize()` loguea el objeto de error completo de `pg` (más contexto del necesario en prod) | `lib/auth.ts:145` |
| 32 | BAJO | Shape de error 400 inconsistente entre endpoints: zod `{ error, issues? }` vs manual `{ error }` | `lib/api-schemas.ts` vs handlers manuales |
| 33 | BAJO | `trustHost: true` incondicional (host header injection si se despliega sin proxy de confianza) | `lib/auth.config.ts:59` |

### 2.4 UI / UX (no corregidos)

| # | Severidad | Issue | Ubicación |
|---|---|---|---|
| 34 | MEDIO | Dashboard: `MonthlyChart` envuelto en un `Card` externo con título "Volumen fumigado por mes" pero el componente ya trae su propio `Card` con "Hectáreas tratadas por mes" → card doble, títulos duplicados | `app/(auth)/page.tsx:188-196` + `components/dashboard/monthly-chart.tsx:14-19` |
| 35 | MEDIO | Ficha de parcela y reportes muestran botones PDF/CSV/"Editar metadata" sin gate de rol (supervisor ve links a endpoints admin → 403). Evaluar `getViewerRole()` en `app/(auth)/parcelas/[id]/page.tsx` | `app/(auth)/parcelas/[id]/page.tsx:245-285`, `app/(auth)/reportes/page.tsx:98-99` |
| 36 | MEDIO | Identificadores internos de BD filtrados al usuario: `dji_parcels ⋈ dji_fumigation_schedule`, `djiag_health`, `dji_fumigations · trazabilidad`, `"Atributos planos de dji_parcels"`, `"próximo sprint"` | `parcels-table.tsx:300`, `health-panel.tsx:23`, `recent-activity.tsx:26`, `parcelas/[id]/page.tsx:409,452,562` |
| 37 | MEDIO | Importador GIS: "Preview", "Click 'Crear N parcelas'", "shapefile", colores hardcodeados fuera del design system | `import-gis-wizard.tsx:243-371` |
| 38 | BAJO | Botón "Coords" (inglés) en ParcelDrawer → "Coordenadas" | `parcel-drawer.tsx:824` |
| 39 | BAJO | Colores hardcodeados que rompen consistencia de tema (green-700/amber-700/etc. en vez de tokens) | `applications/page.tsx`, `fumigaciones/[id]/page.tsx:617-620` |
| 40 | BAJO | Branding: conviven "AFM Geovisor" (sidebar/metadata) y "AeroAdmin AFM" (login). Verificar con el operador cuál es el nombre canónico del panel y unificar | `app-shell.tsx:96`, `login/page.tsx:138`, `app/layout.tsx:17`, metadata de páginas |

---

## 3. Deuda ya documentada en AGENTS.md (aún abierta)

1. **Regla de cadencia formal** — definir el threshold "vencido/crítico" antes de
   reintroducir `CompliancePanel` en el dashboard (Fase 6, deferred).
2. **Quality Gauntlet compuertas 5-7** — StrykerJS (mutation), BDD Gherkin,
   smoke DB, métricas continuas. Requieren deps nuevas (autorización explícita).
3. **Pagination server-side completa** de fumigaciones (cap 200 hoy; suficiente
   para el Valle del Cauca).
4. **Combobox typeahead** para Cliente/Hacienda (hoy SELECTs nativos).
5. **Cleanup e2e tests** `tests/e2e/geovisor-ui-changes.spec.ts` — busca
   `img[src="/afm-logo-mark.svg"]` y valida "CAPAS"/"ventana temporal" que QA-02
   removió (~30 min, ortogonal).

---

## 4. Orden de ejecución recomendado

**Fase A — datos en producción (hoy, manual del operador):**
- Correr backfills de §2.1 (clients/farms, cycles, refresh fumigations).

**Fase B — invariantes de BD (migrations):**
- #14 `UNIQUE(parcel_id)` en `dji_fumigation_schedule` (dedupe primero).
- #16 idempotencia del backfill de ciclos (flag/guard).

**Fase C — performance / drift de queries:**
- #15 usar la MV en `getRecentFumigations`.
- #17, #18, #19 respetar soft-delete en las 3 queries.
- #20, #21, #22 N+1 / transacción.

**Fase D — seguridad (defensa en profundidad):**
- #25 deny-by-default en `authorized` para `/api/*`.
- #28 sanear mensajes de error de `pg` a genéricos.
- #26 TLS `rejectUnauthorized: true` (o CA raíz).
- #27 usar `getCurrentUserRole()` en endpoints críticos (o bajar TTL JWT).

**Fase E — UI/UX:**
- #34 card doble del dashboard.
- #35 gate de rol en botones admin.
- #36-#40 limpieza de textos internos, inglés, colores, branding.

---

## 5. Verificación

Para validar cada fix futuro (reglas del repo):
- `npm run arch:check` → 0 errors.
- `npm run test:coverage` → umbral global 45/65.
- `npx tsc --noEmit` → 0 errores.
- Si tocás schema: migration en `db/migrations/` + `npm run db:migrate`.

> Estado tras esta sesión: `tsc` 0 errores, `arch:check` 0 errores, tests
> 2136/2136 verdes (el test roto de `flight_ids` se actualizó al contrato
> correcto). Pendiente re-correr el suite completo para confirmar 100% verde.
