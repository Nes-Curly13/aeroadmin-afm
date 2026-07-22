# Software Architecture Review — AeroAdmin AFM (2026-07-22)

> Revisión técnica (no de negocio) del sistema AeroAdmin AFM.
> Lente: arquitecto de software senior. Coherencia del modelo de datos, capas, SPOFs, observability, test coverage, performance, backup, deuda técnica.
> Stack confirmado: Next.js 16 + React 19 + Tailwind v4 + Leaflet + PostGIS 16 + Supabase (local en Docker). Vitest 3.2 + jsdom + RTL. 1.279 tests verde, tsc verde, CI verde.
> Workspace real: `C:\dev\DroneFlightAFM` (no `C:\Users\agFab\OneDrive\Documents\DroneFlightAFM` — esa ruta tiene archivos online-only por OneDrive, la copia viva está en `C:\dev\`).

---

## 1. Modelo de datos

### Lo que está bien

- **Opción B (parcelas normalizadas, 1 fila por campo)** con columnas planas en `dji_parcels` (`db/schema.sql:81-127`) en lugar de JSONB es la decisión correcta. Permite queries indexadas por `drone_model_code`, `field_type`, `is_orchard`, `spray_geom` (GIST), `waypoints` (GIST), `reference_point` (GIST). El legacy `DjiAssetRecord` (3 rows per field) se eliminó limpio en `S2 / 2026-07-01`.
- **Geometrías PostGIS MultiPolygon SRID 4326** con `ST_AsGeoJSON(...)::json` en el boundary para evitar el "[object Object]" en el frontend (`api/repositories.ts:142-144`, `lib/djiag-spatial-aggregator.ts:170`).
- **Data quality checks** (migration `20260707000000`): 11 CHECK constraints (`area_fumigated_m2 >= 0`, `lng ∈ [-180, 180]`, `start_at` ≥ 2015, etc.) cierran los 8 schema gaps del `db-constraints-stress`. Patrón disciplinado.
- **Idempotencia de migrations** con `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` + checks re-entrantes. Se pueden re-aplicar sin drama.
- **`dji_import_batches`** como tabla de provenance: cada re-scrape genera un nuevo batch, y `UNIQUE (batch_id, external_id)` previene duplicados. La decisión de "preservar `batch_id` original en re-imports" (2026-07-11) está documentada en el `flight_id` index.

### Lo que falta / es débil

#### 1.1 Soft delete es zombie code (HALF-IMPLEMENTED)
- `dji_fumigations.deleted_at` y `dji_parcels.deleted_at` se agregaron el 2026-07-20 (migration `20260720000000_add_soft_delete.sql`) con índices parciales.
- **El ÚNICO lugar que filtra por `deleted_at IS NULL` es `lib/cache.ts:295-296`** (query de alertas).
- `api/repositories.ts:594-617` (`getPolygonsInRange` via `lib/djiag-spatial-aggregator.ts:140-145` `runAllParcelsQuery`) NO filtra.
- `api/repositories.ts:326-358` (`getFumigationEventsByParcel` via query en `:347`) NO filtra.
- `lib/cache.ts:383-431` (`fetchUpcomingFumigationsRaw`) NO filtra.
- `lib/cache.ts:518-548` (`fetchOverdueParcelsCached`) NO filtra.
- **No existe ningún endpoint ni script que setee `deleted_at = NOW()`**. Los únicos `DELETE FROM` que hay (`scripts/backfill-fumigations-from-flights.js:82`, `scripts/cleanup-parcel-snapshots.js:65`, `scripts/apply-land-assets-to-bd.mjs`) son HARD delete.
- **Riesgo real**: la columna existe, el índice existe, pero no hace nada. Si mañana se agrega un endpoint de soft-delete, va a "funcionar" (la fila se marca) pero seguirá apareciendo en `/map`, `/dashboard`, `/history`, `/parcels`, `/parcels/[id]`, `/parcels/[id]/timeline` porque ninguna query la excluye. El comentario del migration dice literal: *"Refactor de queries existentes para usar `WHERE deleted_at IS NULL` queda para un commit posterior"*. Ese commit nunca llegó.
- **Acción (XS)**: o bien (a) drop la columna + los 2 índices si se confirma que no se va a usar, o bien (b) grep `SELECT.*dji_fumigations|dji_parcels` y agregar `WHERE deleted_at IS NULL` a cada query + agregar un `setParcelDeleted(id)` / `setFumigationDeleted(id)` que sí use la columna. La opción (a) es la honesta para hoy.

#### 1.2 Dos `djiParcelsQuery` divergentes (DRIFT entre cache y repository)
- `api/repositories.ts:130-163` (sin cache) trae los 5 campos nuevos de la "hoja de vida" del 2026-07-22: `crop_type, planting_date, owner_name, owner_contact, supervisor_notes`.
- `lib/cache.ts:99-130` (con cache, TTL 60s, usado por `getParcelsNormalized`) **NO los trae**.
- **Consecuencia**: el dashboard (`app/page.tsx:44`), el `/map` (vía `getParcelsNormalized()`), y el `/history` (idem) muestran una shape de parcela SIN los campos de supervisor. El `/parcels/[id]` (vía `getParcelById` en `:280`) los muestra. Mismo dominio, dos shapes distintas. Si el UI de "Hoja de vida" quiere mostrar el `crop_type` en el list del dashboard, va a fallar silenciosamente (campo undefined).
- **Acción (XS)**: extraer la `djiParcelsQuery` a un archivo compartido (e.g. `api/queries.ts`) e importarla en ambos lados. O alternativamente, hacer un sólo `getParcelById` y eliminar el path duplicado.

#### 1.3 `dji_flights.point` indexado pero no usado
- La migration `20260628100000_add_dji_flights_point_index.sql` creó un índice GIST sobre `point geometry(Point, 4326)`.
- `lib/djiag-spatial-aggregator.ts:131-180` filtra por `start_at` y por `drone_serial`/`pilot_name`/`p.id`, no usa `point` ni `ST_DWithin`.
- `api/repositories.ts:701-708` (`getFlightPoints` via `fetchFlightPointsCached`) usa `point` solo para extraer `(lng, lat)` al frontend, no como filtro espacial.
- **Riesgo bajo**: el índice se mantiene en cada INSERT/UPDATE (costo de write) sin pagar beneficio de read. No es urgente, pero si no se va a usar, dropearlo. Si se va a usar (e.g. "vuelos dentro de un bbox del mapa"), documentar la intención en la migration.

#### 1.4 `dji_fumigation_schedule.is_active` y `last_fumigation_date` sin DEFAULT en `dji_fumigations`
- `dji_fumigations.source` tiene CHECK constraint en (`'manual', 'djiscraper', 'import'`) y default `'manual'`, pero `dji_fumigations.fumigation_date` NO tiene default. Si en algún flujo se inserta sin fecha, rompe (y no es un buen error — solo `null`).
- `dji_fumigation_schedule.next_due_date` se calcula en aplicación (no como columna generada en BD). Si alguien escribe directo a la BD sin pasar por el repo, queda inconsistente. Aceptable para single-tenant single-contributor, pero documentar en el comment de la tabla.

#### 1.5 Faltan índices compuestos para queries hot
- `lib/cache.ts:416-432` (upcoming) hace `WHERE s.is_active = true` — el índice `idx_dji_fumigation_schedule_next_due` ya cubre eso parcialmente, pero si se filtra además por `is_active = true AND last_fumigation_date IS NULL` (caso "no_history"), no hay índice. Hoy la tabla es de 1.207 rows, no se nota. Si crece a >50k, sí.
- `lib/djiag-spatial-aggregator.ts:166-178` (INNER JOIN) filtra por `f.start_at >= ... AND f.start_at < ...` y opcionalmente por `drone_serial`, `pilot_name`, `p.id`. El índice compuesto `(start_at, parcel_id)` cubriría el JOIN. Hoy hay índices separados pero el plan puede degradar.
- **Acción (S)**: en el próximo sprint que toque performance, agregar `CREATE INDEX CONCURRENTLY idx_dji_flights_start_parcel ON dji_flights(start_at, parcel_id)` y `idx_dji_flights_drone_start ON dji_flights(drone_serial, start_at DESC)`. `CONCURRENTLY` porque la BD es 24/7.

---

## 2. Capas y separación de responsabilidades

### Lo que está bien

- **Server components (`app/page.tsx` y demás `page.tsx`)** son server-rendered y delegan a `api/repositories.ts`. No hay client-side data fetching. El cliente (Leaflet) solo lee props ya hidratadas.
- **Funciones puras separadas** (`lib/fumigation-timeline.ts`, `lib/fumigation-cadence.ts`, `lib/format.ts`, `lib/djiag-spatial-aggregator.ts` para el join puro de SQL, `lib/djiag-health.ts`). Bien testeadas sin mockear BD. Excelente para el modelo "single contributor" — no necesitas container de integration test para validar lógica de cadencia.
- **`unstable_cache` por tag** (`lib/cache.ts:67-89`) con TTLs diferenciados (parcels 60s, alerts 5min, upcoming 60s, flights 30s) y `invalidateAfterFumigationMutation()` / `invalidateAfterParcelMutation()` re-exportados desde `api/repositories.ts:43-48`. El diseño está bien pensado: la cache sobrevive al hot-reload porque es module-level, y los tags permiten invalidación quirúrgica por dominio.
- **`withLocalFallback(queryFn, fallbackFn)`** en `api/repositories.ts:91-95` es un patrón defensivo elegante: si la BD está caída, devuelve un fallback razonable (Set vacío, []) en vez de romper la página. Útil para CI sin Docker y para mode offline.

### Lo que está mal / huele

#### 2.1 `lib/djiag-spatial-aggregator.ts` y `lib/cache.ts` duplican el contrato de la query de parcelas
- Ya cubierto en §1.2. Es un caso de "DRY violation" que ya costó drift. Solución concreta: archivo `api/queries.ts` con las SQL strings como constantes, ambos lados importan.

#### 2.2 `api/repositories.ts` mezcla dominio de parcel con dominio de fumigation
- 720 líneas, 13 funciones, 4 dominios distintos (parcels, fumigations, flights, alerts). Crecerá.
- `getParcelsNormalized` (parcel) → `getParcelsSummary` (parcel) → `updateParcelMetadata` (parcel) → `getFumigationSchedule` (fumigation) → `getFumigationEventsByParcel` (fumigation) → `createFumigationEvent` (fumigation) → `setFumigationCadence` (fumigation) → `getUpcomingFumigations` (cross-domain, pero dominantly fumigation) → `getOverdueParcels` (cross) → `getFlights` (flight) → `getAlerts` (alert) → `getDashboardMetrics` (kpi) → `getFlightPoints` (flight).
- **No es un problema HOY** (720 líneas es manejable), pero si se llega a 1500+ líneas, partir en `api/repositories/parcels.ts`, `api/repositories/fumigations.ts`, `api/repositories/flights.ts`, `api/repositories/alerts.ts`. Con el barrel file `api/repositories.ts` que re-exporta, los call-sites no cambian.
- **Acción (M, no ahora)**: solo si crece.

#### 2.3 `lib/djiag-korean-client.js` (29KB) y `lib/djiag-*.js` no están en una capa
- Es un cliente de scraping que vive en `lib/` pero conceptualmente NO es código de aplicación. Es más cercano a `scripts/`.
- Convive con lógica de UI (Leaflet, types, format) en el mismo directorio.
- **Riesgo**: un import accidental de un componente de UI a `djiag-korean-client.js` arrastra Playwright (~200MB) al bundle del cliente. Hoy los `.d.ts` companion files (e.g. `lib/djiag-korean-client.d.ts:1-624`) son declaraciones vacías que evitan el problema, pero la convención no está documentada.
- **Acción (S)**: o bien (a) mover todo `lib/djiag-*.js` a `scripts/djiag/` y dejar sólo los types puros en `lib/`, o bien (b) documentar en el README de `lib/` la regla "no importar `djiag-*.js` desde componentes de UI". La (a) es más limpia.

#### 2.4 `app/api/parcels/[id]/route.ts` y `app/api/fumigations/[parcelId]/timeline/route.ts` tienen validaciones de input distintas
- `parcels/[id]/route.ts` valida `id` como integer, pero `fumigations/[parcelId]/timeline/route.ts` no lo he auditado a fondo. Diferentes patterns de error handling.
- **Acción (XS)**: extraer un helper `parseParcelIdParam(searchParams)` o `validateParcelId(params)` en `lib/request.ts` (que ya existe, 912 bytes — está subutilizado).

#### 2.5 `app/api/task-history/route.ts:97-99` (date parser) está duplicado
- El `parseIsoDate` con regex `^\d{4}-\d{2}-\d{2}$` y la validación de "fecha calendario real" también vive, en distintas formas, en otros route handlers.
- **Acción (XS)**: mover a `lib/request.ts` o `lib/format.ts`.

---

## 3. Single points of failure y resiliencia

### SPOFs identificados

| Componente | Qué pasa si muere | Mitigación actual | Mitigación que falta |
|---|---|---|---|
| **BD Postgres en Docker local** | Pierde TODO (no hay backup automatizado). El dev machine muere = se acabó. | Volumen Docker `afm_postgres_data` persiste entre reinicios. | No hay `pg_dump` programado, no hay WAL archiving, no hay replicación. Un disk failure = game over. |
| **Cron externo que corre `pipeline:djiag`** | Si el cron se cae 24h+, `_health.json` queda stale. El health endpoint marca `status='stale'` pero **no hay alerta externa** (no Sentry, no Slack, no email). | Endpoint admin que el dueño puede chequear manualmente. | Un watchdog (GitHub Actions cron, e.g. diario a las 9am, que llame a `/api/admin/djiag-health` y falle si está stale >24h) sería mínimo viable. |
| **Storage state `djiag_session.json` (TTL 7d)** | Si expira o se corrompe, el próximo login hace un flow de redirects cross-subdomain ~5-10s más caro, y puede fallar si DJI cambió algo. | Cache + `_waitForAuthenticatedGraphql()` + retry con backoff en login. | Si DJI cambia la ruta de login (`/login → /sign-in`), falla silenciosa del login, scraper corre con `loggedIn=false` y el primer fetch tira 401. El circuit breaker (S1 de DJIAG_AUDIT) ya implementado previene martilleo. |
| **Playwright/Chromium local** | Si la versión de Chromium queda out-of-date y DJI cambia a un selector CSS nuevo, el login flow puede no encontrar el botón. | `DJIAG_FIELD_SELECTOR` env override (defensa, no proactivo). | No hay "smoke test" del login flow que detecte drift de DJI antes de producción. Un cron semanal que ejecute `scrape_djiag_perflight.js --smoke` y falle CI si rompe, sería mínimo viable. |
| **Secretos DJIAG_EMAIL / DJIAG_PASSWORD** | Si el operador de drones cambia la password, el scraper falla con 401 en el próximo login. | El circuit breaker (S1) detecta 3 fails → no martilla. Pero no hay alerta proactiva: el admin tiene que mirar `_health.json`. | Mismo problema: necesita alerta externa. |
| **Auth `app_users` con bcryptjs** | Si la BD se cae, nadie puede loguearse. Aceptable para single-tenant local, pero **el rate limit no existe**: un atacante con la URL puede intentar infinitas passwords. | NextAuth v5 beta tiene su propio throttle por cookie, pero no por IP. | `proxy.ts` no tiene rate limit. Para un admin panel privado no es urgente, pero documentar. |
| **`AUTH_SECRET` (NextAuth)** | Si cambia, invalida TODAS las sesiones existentes. | Está en `.env.local` (no en repo), documentado. | OK, pero no hay rotación documentada. |
| **Script `run-pipeline.js` (10 steps en serie)** | Si step 6 falla, los steps 7-10 no corren. `_health.json` reporta `partial`. | El pipeline es idempotente: re-correr desde el step que falló funciona. `--start-from 6` ya existe. | Pero el cron externo tiene que estar configurado con `--resume` o `--start-from` para auto-recovery. **No verifiqué la config del cron** porque está fuera del repo. |
| **`getDb()` Pool size = 5** | Si el scraper está corriendo un spatial join pesado (16k × 1207) y el dashboard pide 5 queries en paralelo, los requests web se encolan 5-15s. | `idleTimeoutMillis: 30_000`. | Subir a 10 si el síntoma aparece. Hoy 1 usuario, no se nota. |

### El que más me preocupa (high-impact, low-effort fix)
El **cron externo sin health check** es el SPOF #1. Si la PC del dev se apaga un fin de semana o el cron scheduler se cae, no hay forma de saberlo hasta que el operador entre al panel y vea data vieja de 3 días. El endpoint `/api/admin/djiag-health` ya existe (XS1 hecho, 2026-07-22). Falta solo conectarlo a algo que despierte al admin.

**Acción (XS)**: un script de ~30 líneas (`scripts/notify-djiag-health.js`) que lee `_health.json` y, si `status === 'stale' | 'failed'`, manda un POST a un webhook (Discord, Telegram bot, o un simple email vía SMTP). Lo ejecuta el cron externo al final, o un cron independiente. Si no querés servicio externo: un `curl /api/admin/djiag-health` desde un cron de GitHub Actions a las 9am que falla si está stale >24h.

---

## 4. Observability

### Lo que existe

- **`_health.json`** escrito por `scripts/run-pipeline.js:207-256` (con cada step, status, duración, error). El formato está bien pensado (versionado, `totals` para delta).
- **`GET /api/admin/djiag-health`** con `requireRole('admin')` y respuesta derivada por `lib/djiag-health.ts:96-135` (status: ok/partial/stale/unknown/failed, warnings, hoursSinceLastSync).
- **Tests** del endpoint: `tests/api-admin-djiag-health.test.ts` (6.8KB, cubre 401, 403, 200, archivo corrupto, warnings).
- **Logs estructurados** en el cliente DJI (`console.error` con prefijo `[launch]`, `[login-backoff]`, `[health]`, etc.). Para single-tenant single-contributor es aceptable, aunque no hay log shipping.
- **Circuit breaker state** persistido en el mismo `_health.json` (lib/djiag-circuit-breaker.js).

### Lo que falta

- **No hay log shipping** a un servicio externo. Si el container de Next se cae, los `console.error` se pierden. Aceptable para local dev, crítico si se hostea en algún lado.
- **No hay métricas de queries lentas**. El `pg` driver no está instrumentado con `pg-monitor` o equivalente. Si una query empieza a degradarse (e.g. el spatial join con más fincas), no hay manera de detectarlo salvo que el cliente se queje.
- **No hay correlation ID entre el cron (Node) y el Next (browser)**. Si el admin reporta "vi un error", no hay forma de cruzar con el log del scraper. `traceparent` header de W3C no se propaga.
- **El threshold de stale (24h) en `lib/djiag-health.ts:54`** es estático. Si el cron corre cada 48h, va a estar siempre `stale`. Configurable por env var sería mejor.
- **Tests E2E (`tests/e2e/auth-and-dashboard.spec.ts`, `map-and-history.spec.ts`) usan Playwright** pero NO hay un test que verifique el camino "DJI API está caída → circuit breaker se abre → scraper falla fast con countdown claro". El circuit breaker está testeado en unit (`tests/djiag-circuit-breaker.test.ts`), pero la integración end-to-end (scraper real contra DJI mockeado) no existe. **Acción (S)**: agregar un integration test que use `playwright-msw` o un mock simple del endpoint coreano y verifique el flow.
- **El admin NO recibe notificación proactiva** (ya mencionado en §3). El endpoint existe pero requiere que alguien lo visite. Para un single-contributor que mira la pantalla una vez al día, eso es OK; para producción con 50 fincas no.

### Veredicto
Nivel de observability: **suficiente para desarrollo local**, **insuficiente para producción con clientes dependientes**. Si mañana el cliente empieza a facturar sobre data del panel, hay que invertir 1-2 días en alertas externas (Slack/Discord webhook + GitHub Actions cron watchdog).

---

## 5. Test coverage — gaps críticos

### Lo que está bien cubierto
- **1.279 tests verde**. El `djiag-*-fetcher.test.ts` (9 archivos) cubren los parsers puros con fixtures (`tests/fixtures/djiag-live/*.json`).
- **`tests/api-*.test.ts`**: cubren los route handlers con auth (mock), incluyendo timeline, parcels normalized, fumigation events.
- **`tests/cache.test.ts`**: cubre la lógica de `unstable_cache` con tags.
- **`tests/djiag-capture-response.test.ts`** (16KB) cubre la race condition del listener (H4 de DJIAG_AUDIT, ya resuelto).
- **Tests E2E** (`tests/e2e/`) cubren el happy path de auth + dashboard + map.
- **`tests/user-story-dashboard-e2e.test.ts`** (26KB) es la integración más pesada: hace migrate + seed + test del flujo end-to-end. Excelente.

### Gaps críticos

#### 5.1 NO hay test que verifique que `lib/cache.ts:99-130` y `api/repositories.ts:130-163` devuelven la misma shape
- El bug del §1.2 (drift del `djiParcelsQuery`) **no está cubierto por ningún test**. Si se rompe de nuevo, nadie se entera hasta que el UI pide `parcel.crop_type` y obtiene `undefined`.
- **Acción (XS)**: agregar `tests/api-parcel-shape-consistency.test.ts` que llama a ambos `getParcelsNormalized` (cached) y `getParcelsNormalizedUncached` y assertea que el set de keys es idéntico. 30 líneas, ahorra horas.

#### 5.2 NO hay test que verifique el soft delete end-to-end
- `tests/user-story-dashboard-e2e.test.ts:585-647` verifica que las COLUMNAS existen y los índices también. Pero NO hay un test que:
  1. Inserte una fumigación
  2. La marque como deleted
  3. Verifique que `getFumigationEventsByParcel` NO la devuelve
  4. Verifique que `getOverdueParcels` NO la cuenta
- Si el refactor de queries (mencionado en el migration `20260720000000`) se hace, no hay red de seguridad.
- **Acción (S)**: una vez decidido si el soft delete se implementa o se dropea, escribir el test apropiado.

#### 5.3 NO hay test de concurrencia / race conditions en el scraper
- El cliente Playwright es inherentemente single-threaded por diseño, pero `fetchAllLandsPages` con paginación concurrente contra DJI es vulnerable a:
  - `this._responseBuffer.splice(0, ...)` (lib/djiag-korean-client.js:283) sin lock — si dos fetches concurrentes llaman a `_captureResponse`, el cap de 1000 puede dropear items del otro.
  - `this._currentLandsCursor = '0'` (lib/djiag-korean-client.js:101) se setea en `fetchLandsPage` antes de navegar — si dos `fetchLandsPage` se llaman en paralelo, el segundo pisa el cursor del primero.
- El limit conocido (single page instance) está documentado en el header del archivo (línea 22: *"Single page instance: si múltiples fetches concurrentes, el orden de responses puede mezclarse"*). Pero NO hay test que lo verifique, así que un día alguien refactoriza para paralelizar y rompe.
- **Acción (S)**: agregar `tests/djiag-korean-client-concurrency.test.ts` que dispare 2 `fetchLandsPage` en paralelo y assertea que los cursors no se pisan.

#### 5.4 NO hay test de backup/restore de la BD
- `scripts/backup-pre-import-fix.js` existe (3.3KB, hace `pg_dump` antes de un fix), pero es un script one-off. No hay un test que verifique que el dump se puede restaurar. Si `pg_dump` cambia de formato entre versiones de Postgres, te enterás cuando intentás restaurar en producción.
- **Acción (S)**: un test que corre `pg_dump`, dropea la BD, y restaura desde el dump. Ejecutar en CI mensual, no en cada PR.

#### 5.5 Cobertura de branches en scripts (no measurements, pero inferencia)
- Los `scripts/*.js` tienen coverage 0 (no están en `vitest.config.ts`'s include). Son ejecutables CLI, se prueban manualmente.
- `scripts/upsert-flights-from-djiag.js`, `scripts/spatial-join-flights-parcels.js`, `scripts/upsert-lands-from-djiag.js` tienen tests (`tests/upsert-*.test.ts`, `tests/spatial-join-*.test.ts`) pero como unit tests de la función pura, no como integration.
- Aceptable para el modelo, pero **si el `spatial-join-flights-parcels.js` cambia el algoritmo (e.g. usa `ST_DWithin` vs `ST_Intersects`), no hay test que verifique que la salida es la misma**. Documentar en cada script qué se testea y qué no.

#### 5.6 NO hay test de carga / performance
- Para 1.207 parcelas y 16.353 vuelos no hace falta, pero si en 3 años se llega a 10x (12k parcelas, 160k vuelos), no hay baseline. La primera señal será el dashboard tardando 8s.
- **Acción (M, no ahora)**: un `tests/perf/queries.bench.ts` con `pgbench`-style que mide cada query del cache layer y guarda un baseline. Solo correr en CI nightly, no en cada PR.

---

## 6. Performance y escala

### Hoy (1.207 fincas, 16.353 vuelos, 400 fumigations)
- Dashboard render: ~500ms-1.5s (cache hit) o ~3-5s (cache miss + 6 queries en `Promise.all` en `app/page.tsx:39-52`).
- `/map` render: ~1-2s (Leaflet + 1.207 polígonos GeoJSON, cache hit).
- Pipeline completo (`run-pipeline.js` 10 steps): ~10-20min. Step 9 (download 2.807 assets) es el más caro.

### 10x datos (12k fincas, 160k vuelos, 4.000 fumigations)
- **`getFlights()` en `api/repositories.ts:618-637` se rompe**. Hace `SELECT * FROM dji_flights` (sin WHERE, sin LIMIT), agrega en JS con `aggregateFlightsByDay`, después pagina. Hoy son 16k rows → 50ms en local. A 160k → 500ms. A 1.6M → 5s. **La paginación se hace EN MEMORIA**, así que el costo de transferir 160k rows al Next es prohibitivo.
- **Acción (M)**: la paginación de `getFlights()` debe hacerse en SQL (`SELECT ... FROM dji_flights ORDER BY start_at DESC LIMIT $1 OFFSET $2`) y el `aggregateFlightsByDay` debe recibir SOLO la página actual. Hoy la "paginación" es cosmética.
- **`getPolygonsInRange` (lib/djiag-spatial-aggregator.ts:131-180)**: 1.207 rows en `dji_parcels` × spatial JOIN a `dji_flights`. A 12k × 160k = 1.92B combinaciones potenciales. El `ST_Intersects` en el WHERE de `dji_parcels` con `spray_geom` GIST reduce el set, pero el GROUP BY con `array_agg(DISTINCT ...)` se va a poner feo.
- **Acción (S)**: a 10x, precomputar un `dji_flights_summary` materializado con `(parcel_id, summary_date, area_m2_total, duration_seconds_total, drone_serial_dominant, pilot_name_dominant)`. Refresh on pipeline. La query del mapa se vuelve O(parcels) en vez de O(parcels × flights).
- **`lib/cache.ts:99-130` `djiParcelsQuery`** sin LIMIT — la `fetchParcelsNormalizedRaw` (línea 142) hace `LIMIT $1 OFFSET $2` pero la COUNT query no filtra por `deleted_at IS NULL`. A 10x con muchas soft-deletes, la COUNT diverge del total real.
- **El JSON que devuelve `/api/parcels/normalized`** a 12k fincas con 3 geometrías GeoJSON cada una = ~30MB de payload JSON. Va a matar el navegador. **Acción (S)**: el endpoint del mapa debería devolver solo `spray_geometry` (la que se renderiza), no `reference_point` ni `waypoints_geometry`. Hoy devuelve las 3.
- **`getFlightPoints(limit=2000)`** (api/repositories.ts:701) ya tiene cap defensivo (`Math.min(limit, 2000)`). OK. Pero a 10x datos, 2000 puntos en el mapa es poco, y 2000 con `start_at` ORDER BY DESC sin índice compuesto `(start_at DESC)` puede degradar. El índice `idx_dji_flights_start_at` que asumo existe (no lo vi en `db/schema.sql`, pero está implícito porque pg crea uno automático en el PK) sirve, pero a 160k rows el sort en memoria puede ser lento. **Acción (S)**: verificar con `EXPLAIN ANALYZE` que el plan usa index scan; si no, crear `CREATE INDEX CONCURRENTLY idx_dji_flights_start_at_desc ON dji_flights(start_at DESC)`.

### Cuellos de botella visibles HOY (sin esperar 10x)
1. **`getFlights()` sin WHERE**: 16k rows transferidas por cada `fetchFlightPointsCached` miss. Cache TTL 30s lo amortigua, pero un cache stampede (10 tabs abiertas justo cuando expira) puede tumbar la BD.
2. **`getDashboardMetrics`** (`lib/cache.ts:170-200` aprox) hace 4 queries: `COUNT(*) FROM dji_flights`, `SUM(area_covered)`, etc. A 10x datos con índices correctos sigue siendo <100ms. Sin índices correctos, 2-3s.
3. **`fetchUpcomingFumigationsRaw` (`lib/cache.ts:383-432`)**: trae TODAS las filas de `dji_fumigation_schedule` con JOIN a `dji_parcels` y filtra `WHERE s.is_active = true`. No hay LIMIT, no hay paginación. A 1.207 fincas = OK. A 12k = todavía OK porque el JOIN es por PK. Pero el `enriched.sort()` en JS (línea 414-422) es O(n log n) en memoria, ~3ms a 12k.

### Veredicto
Para el estado actual, **bien**. A 10x hay 2-3 lugares que necesitan optimización: `getFlights` (paginación real en SQL), `getPolygonsInRange` (materialización), y el bundle de `/api/parcels/normalized` (slim it). A 100x hay que repensar la arquitectura de queries.

---

## 7. Backup y recovery

### Lo que existe
- **Volumen Docker `afm_postgres_data`** persiste los datos entre reinicios del container.
- **Migrations versionadas** en `supabase/migrations/` con timestamps y bodies idempotentes. Re-aplicar es seguro.
- **Tests con PostGIS en CI** (`.github/workflows/ci.yml`) — el schema está validado en cada PR contra una BD fresca.

### Lo que NO existe (y debería)
1. **No hay `pg_dump` programado**. Si el disco muere, perdés 16k vuelos, 1.207 fincas, todo. **Crítico para single-contributor**: tu tiempo de recoverability es literalmente la duración de un `pg_dump` + restore. Configurar un cron semanal o diario que escriba a `backups/afm_$(date).sql.gz` y retenga 7 días. Effort: 30 min.
2. **No hay WAL archiving ni replicación**. Inaceptable para producción con clientes, aceptable para local dev.
3. **No hay restore drill automatizado**. El `tests/api-admin-djiag-health.test.ts` verifica el endpoint pero nadie verifica que `pg_dump` se puede restaurar. **Acción (S)**: un test manual programado (mensual) que: (a) `pg_dump` la BD, (b) levanta un container limpio, (c) `psql -f` el dump, (d) corre los smoke tests. Si pasa, OK. Si falla, aprendés algo.
4. **Los `djiag_exports/*.json` no se respaldan**. Si DJI cambia la shape del response y el parser viejo los sobreescribe con data vacía, perdés el último response bueno. **Acción (XS)**: después de cada pipeline run exitoso, copiar `djiag_exports/lands.json` a `backups/lands_$(date).json`. Compreso, retención 30 días. Effort: 1h.
5. **El `djiag_session.json` (cookies del browser)** está en `.gitignore` pero NO respaldado. Si se pierde, hay que re-loguearse (5-10s). No es data crítica, pero el ciclo de "DJI cambió el login → cookies expiran → re-login falla → admin a mano" es molesto. Effort: copiar a `backups/`.

### Recovery ante cambio de schema de DJI
- El cliente usa `page.route()` para inyectar cursors y se basa en selectores CSS para los botones del login. Si DJI cambia:
  - **HMAC schema change**: el cliente Playwright reusa el HMAC del browser de DJI, así que mientras la UI siga funcionando, el firmado sigue OK. **Bypass automático**, no hay acción.
  - **Login flow (redirects cross-subdomain)**: `_waitForAuthenticatedGraphql` (línea 308) espera un 200 de `/graphql` post-login. Si DJI cambia la ruta, falla. **Detección**: el primer fetch tira 401. **Mitigación**: el circuit breaker (S1) se abre, no martilla. **Recuperación**: 1-2 horas de dev para actualizar el flow. Documentar el fix en `SCRAPER_DEFECTS.md`.
  - **GraphQL response shape change**: H3 de DJIAG_AUDIT (no resuelto). El parser tira "Field `totalArea` expected number, got string". El error es CRÍPTICO. **Acción (XS)**: agregar al parser un `validateFieldType(node, 'totalArea', 'number')` que tire error específico. Effort: 1h.
  - **Asset signed URL TTL cambia de 12h a 1h**: H5 de DJIAG_AUDIT (parcialmente resuelto). El download puede fallar. **Mitigación**: el `--metrics-json` que se sugirió en DJIAG_AUDIT H7 NUNCA se implementó. Hoy no hay forma de saber cuántas URLs fallaron por 403. **Acción (XS)**: en `scripts/download-land-assets.js`, contar los 403 y loguear al final. Si >20% son 403, exit code != 0.

---

## 8. Deuda técnica priorizada (8 items)

| # | Item | Esfuerzo | Por qué | Cuándo |
|---|---|---|---|---|
| 1 | **Eliminar o implementar soft delete** (`deleted_at` en `dji_fumigations` y `dji_parcels`): hoy la columna existe + 2 índices parciales, pero solo UN query la usa, y NADIE setea el valor. | XS (1h) | Zombie code que confunde a futuros mantenedores. El comment del migration reconoce "queda para un commit posterior" que nunca llegó. | Antes del próximo sprint que toque security o parcels. |
| 2 | **Unificar `djiParcelsQuery`** (extraer a `api/queries.ts`): hoy `lib/cache.ts:99-130` y `api/repositories.ts:130-163` tienen 2 copias divergentes. El sprint "hoja de vida" (2026-07-22) agregó 5 columnas a UNO pero no al otro. | XS (1-2h) | Drift silencioso. El dashboard y el detail page devuelven shapes distintas. | Antes del próximo sprint de UI de parcelas. |
| 3 | **Alerta externa de health** (webhook a Discord/Telegram + cron de GitHub Actions que falle si stale >24h): el endpoint existe, falta el watchdog. | XS (2-3h) | SPOF #1 del sistema. Si el cron externo se cae, no hay forma de saber. | Antes de tener 2+ fincas dependientes del panel. |
| 4 | **`getFlights()` paginación real en SQL**: hoy hace `SELECT *` y pagina en memoria. A 10x datos, esto se rompe. | S (3-4h) | Cuello de botella predecible. | Antes de llegar a 50k vuelos acumulados. |
| 5 | **`pg_dump` programado + restore drill**: hoy no hay backup automatizado. | XS (1-2h) | Single point of failure del dev machine muriendo. | **Inmediato**. Esto es "no me puedo creer que no esté". |
| 6 | **Mover `lib/djiag-*.js` a `scripts/djiag/`** (o documentar la convención "no importar desde UI"): el cliente Playwright vive en `lib/` junto a lógica de UI. | S (3-4h) | Riesgo de bundling. Si un día un dev hace `import { something } from '@/lib/djiag-asset-downloader'` desde un componente client, rompe el build. | Antes de crecer más. |
| 7 | **`--metrics-json` en run-pipeline.js** (DJIAG_AUDIT H7, no implementado): cada step reporta stats a un JSON. Permite detectar 403 silenciosos en download-assets. | XS (2-3h) | Visibilidad operacional. Hoy no hay forma de saber cuántas URLs expiraron sin abrir el log. | Antes de producción con clientes. |
| 8 | **Schema versioning + field-type validation en parsers** (DJIAG_AUDIT H3, no implementado): `SCHEMA_VERSION = 1` exportado por fetcher, validación de tipo en cada field, error específico si DJI cambia. | S (4-6h) | Cuando DJI cambie una query, el error actual es críptico. Detectarlo en minutos vs. horas. | Cuando el scraper falle con error genérico por primera vez. |

**Effort key**: XS = <2h, S = 2-6h, M = 1-2 días, L = >2 días.

---

## 9. Lo que NO se debe hacer (over-engineering tentador)

Esto es para vos, futuro dev solo, cansado a las 2am, tentado de meterle más fierros:

- **NO agregar un ORM (Prisma, Drizzle)**. El driver `pg` raw con queries SQL explícitas funciona. Un ORM agrega 200KB al bundle, debugging más opaco, y cada JOIN con PostGIS que hagas va a tener que volver a SQL crudo igual. El código actual ya tiene los `query<T>` genéricos que dan el 80% del type safety de un ORM.
- **NO mover a microservicios**. "El scraper y el Next son cosas distintas" — sí, pero viven en el mismo repo, mismo `package.json`, mismo Docker. Separarlos a 2 servicios agrega network latency, deploy coordination, y una capa de "service discovery" que para 1 dev no aporta. Si algún día hace falta, será obvio; hoy no.
- **NO agregar Redis como cache layer**. `unstable_cache` de Next con tags ya cubre el 90% de los casos. Redis agrega infra (otro container que mantener), un failure mode nuevo, y la invalidación por tag ya la tenés en Next. Si `unstable_cache` se queda corto (e.g. quieres compartir cache entre múltiples instancias de Next en el futuro), reconsiderar.
- **NO convertir el scraper JS a TypeScript**. El código JS está bien testeado (9 archivos `djiag-*.test.ts` con fixtures). El costo de migrar a TS para 30KB de código no se justifica. Sí podés mejorar las `.d.ts` companion files.
- **NO agregar un message queue (RabbitMQ, BullMQ)**. El pipeline es 10 steps en serie, secuencial, idempotente. Un MQ te permitiría paralelizar steps, pero los steps tienen dependencias (step 4 necesita el output de step 3) y los assets de step 9 dependen de los signed URLs de step 8 (12h TTL). Paralelizar te mata.
- **NO agregar un frontend framework de UI (Chakra, MUI, shadcn)**. Tailwind v4 ya cubre el design system (`lib/ui-tokens.ts`). Agregar una lib de componentes = 6 meses migrando cada `className`.
- **NO escribir tests E2E para el scraper contra DJI real**. Los tests E2E contra servicios externos flaky son la mayor fuente de falsos positivos en CI. Los parsers puros con fixtures (lo que ya hay) son la mejor relación esfuerzo/coverage.
- **NO invertir en feature flags, A/B testing, o multi-tenancy**. El sistema es single-tenant (migration `20260721000000` confirma: "El sistema es single-tenant"). Agregar tenancy es 3-6 meses de refactor (clients + parcels + fumigations + auth). Solo hacerlo si el cliente paga.
- **NO agregar CI de lint estricto (eslint --max-warnings 0)**. El repo tiene `tsc --noEmit` que ya cubre tipos. ESLint estricto en un proyecto con 50% JS legacy (scraper) y 50% TS estricto genera más fricción que valor.
- **NO persigas 100% test coverage**. Hoy ~70% (estimado, no medido) está bien. Los últimos 10% son branches defensivos de error que solo se testean con mocks feos. Esfuerzo > valor.

---

## Resumen ejecutivo

**El sistema es sólido para su escala y modelo (single-tenant, single-contributor, 1.207 fincas, single PC).** El código está bien documentado, las migrations son idempotentes, los parsers son puros, los tests cubren los caminos críticos, y el cliente Playwright es notablemente maduro (storage state, circuit breaker, cursor injection).

**Los 3 hallazgos más críticos** (los que más rápido escalan a problema real):

1. **Soft delete zombie** (migration `20260720000000`): columna + 2 índices + 1 query que la usa + 0 endpoints que la seteen. O se implementa o se dropea. Effort: 1h.
2. **`djiParcelsQuery` divergente** entre `lib/cache.ts:99-130` y `api/repositories.ts:130-163`: el dashboard, /map y /history muestran parcelas SIN `crop_type/planting_date/owner_*`, pero el detail page SÍ los muestra. Ya pasó (sprint 2026-07-22). Va a pasar de nuevo. Effort: 1-2h.
3. **Sin backup automatizado + sin alerta de health**: el dev machine muriendo = perder 16k vuelos + 1.207 fincas. El cron externo cayéndose 48h = data stale silenciosa. Effort: 3-4h combined.

El resto (observability, performance 10x, multi-page Playwright) son importantes pero NO urgentes. Invertí en los 3 de arriba este sprint.

---

**Auditor**: Mavis, mini-coder-max lens.  
**Fecha**: 2026-07-22.  
**Próxima revisión sugerida**: cuando se llegue a 5.000 fincas, o cuando se agregue un 2do desarrollador, o cuando un cliente dependa de la data del panel para decisiones de negocio (facturación, etc.).
