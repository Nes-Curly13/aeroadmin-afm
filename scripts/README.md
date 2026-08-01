# scripts/

CLI del pipeline DJI + utilitarios de mantenimiento de la BD. Scripts
Node.js que el operador corre desde la línea de comandos. **No se
exponen como API** (no son route handlers).

## Estado actual (2026-08-01, sprint S6.7)

- **57 scripts** operacionales (después de archivar 68 scripts de
  debug/migración a `_archive/2026-Q1-Q2-debug/`).
- **3 scripts de captura** (`capture-*`) — graban fixtures para tests
  del scraper.
- **0 scripts de diagnóstico** en este directorio (todos en `_archive/`).
- Pipeline principal: `run-pipeline.js` orquesta 7 pasos (scrape →
  fetch lands → upsert flights → spatial join → upsert fumigations
  agregadas → backfill fumigations → update schedule).

## Variables de entorno

Todos los scripts que tocan la BD leen `DATABASE_URL` (con fallback a
`DATABASE_URL_DIRECT`) desde `.env.local` en la raíz del proyecto.
Algunos también respetan `DATABASE_SSL=true` para Supabase.

## Tabla de scripts (operacionales)

| Comando (`npm run ...`) | Script | Qué hace | Cuándo |
|---|---|---|---|
| `db:up` | (docker compose) | Levanta Postgres+PostGIS local | Setup inicial / después de `docker compose down` |
| `db:down` | (docker compose) | Apaga la BD local | Cleanup |
| `db:migrate` | `apply-pending-migrations.js` | Aplica migrations SQL pendientes (idempotente) | Después de un `git pull` que toque `db/migrations/` |
| `db:init` / `db:bootstrap` / `db:init:v2` | `import_djiag_data.js` (raíz) | Import inicial completo desde CSV/JSON de DJI | Setup inicial de la BD |
| `db:import:lands` | `import-lands-pipeline.js` | Pasos 8-9 del pipeline (importar parcelas) | Después de un scrape manual |
| `db:import:fumigations` | `import-fumigations-pipeline.js` | Importa fumigaciones agregadas desde DJI | Después de un scrape manual |
| `db:backup` | `db-backup.js` | Genera un dump `.sql.gz` con timestamp | Antes de cambios de schema grandes |
| `seed:cadences` | `seed-cadences.js` | Puebla `dji_fumigation_cadence_config` con valores por crop | Setup inicial |
| `auth:seed` | `seed-admin-user.js` | Crea el usuario admin inicial | Setup inicial |
| `scrape:djiag` | `scrape_djiag_records.js` (raíz) | Scrape full de DJI SmartFarm Web con Playwright | Cuando se quiere data fresca de DJI |
| `scrape:djiag:smoke` | mismo, `--smoke` | Scrape de prueba (1 página, sin login) | Verificar que el scraper funciona después de cambios |
| `fetch:djiag:lands` | `fetch-lands-from-djiag.js` | Fetch HTTP de fincas desde DJI (no Playwright) | Reemplazo más rápido que el scrape Playwright para fincas |
| `fetch:djiag:lands:fixtures` | mismo, `--save-fixtures` | Igual pero guarda los responses a `tests/fixtures/` | Cuando cambia la shape de DJI y hay que actualizar fixtures |
| `fetch:djiag:fumigations` | `fetch-fumigations-from-djiag.js` | Fetch HTTP del rollup diario de fumigaciones | Cuando se quiere data fresca de fumigaciones |
| `download:djiag:assets` | `download-land-assets.js` | Descarga polígonos KML desde DJI | Después de un fetch de fincas |
| `download:djiag:assets:dry` | mismo, `--dry-run` | Muestra qué descargaría sin descargar | Verificar antes de un download grande |
| `download:djiag:assets:force` | mismo, `--force` | Re-descarga incluso si ya existe | Después de cambios de polígonos en DJI |
| `upsert:djiag:lands` | `upsert-lands-from-djiag.js` | Upsert de fincas a `dji_parcels` | Después de un fetch |
| `upsert:djiag:fumigations` | `upsert-fumigations-from-djiag.js` | Upsert de fumigaciones agregadas | Después de un fetch |
| `dump:djiag:flights` | `dump-flights-direct.js` | Dump de `dji_flights` a JSON (read-only) | Inspeccionar data sin psql |
| `print:djiag:aggr-by-day` | `print-aggr-by-day.js` | Print del rollup diario (read-only) | Inspeccionar agregaciones |
| `print:djiag:flight-records` | `print-flight-records.js` | Print de `dji_flight_records` (read-only) | Inspeccionar detail de vuelos |
| `capture:djiag:fumigations` | `capture-fumigations-fixture.js` | Captura response crudo de fumigaciones → fixture | Cuando cambia la shape y hay que regenerar |
| `capture:djiag:all-flights` | `capture-all-flight-responses.js` | Captura TODAS las responses de flights → fixture | Cuando cambia la shape y hay que regenerar |
| `capture:djiag:flight-detail` | `capture-flight-detail.js` | Captura el detail de un flight específico | Cuando cambia la shape del detail |
| `refresh:fumigations` | `refresh-fumigations.js` | Refresh fumigations (backfill + schedule), sin re-scrapear | **Cron semanal** (lunes 01:00 Bogota). También a mano después de un backfill grande |
| `health:watchdog` | `health-watchdog.js` | Verifica salud del pipeline (last run, errors) | Cron / monitoring externo |
| `pipeline:djiag` | `run-pipeline.js` | Pipeline completo: scrape + spatial join + backfill + update | Cuando se quiere un refresh end-to-end |
| `pipeline:djiag:dry` | mismo, `--dry-run` | Muestra qué haría sin ejecutar | Verificar antes de un pipeline completo |

## Scripts standalone (no en `package.json`)

Estos no están en `npm run` pero siguen siendo operacionales. Útiles
para el dev pero el operador raramente los corre.

| Script | Qué hace |
|---|---|
| `backfill-fumigations-from-flights.js` | Solo el paso 1 de `refresh:fumigations` (backfill sin schedule) |
| `update-fumigation-schedule.js` | Solo el paso 2 (re-calcular schedule desde fumigations frescas) |
| `backfill-lands-metadata.js` | Backfill de campos de metadata en `dji_parcels` (location_label, etc.) |
| `backfill-schedule-history.js` | Backfill del historial de schedule para fumigaciones pasadas |
| `check-fumigations-coverage.js` | Detector de gaps de cobertura entre flights y fumigations |
| `check-fumigations.js` | Smoke check: ¿hay fumigaciones en la BD? |
| `db-check.js` | Verifica conexión a la BD |
| `db-validate.js` | Valida constraints + foreign keys |
| `db-constraints-stress.js` | Stress test de constraints (muchas inserts concurrentes) |
| `fetch-lands-clean.js` | Fetch lands con limpieza post-proceso (normaliza nombres) |
| `fetch-lands-direct.js` / `.d.ts` | Variante de fetch lands sin normalización |
| `spatial-join-flights-parcels.js` | Llena `dji_flights.parcel_id` por proximity (PostGIS) |
| `upsert-flights-from-djiag.js` | Upsert de flights a `dji_flights` (consumido por pipeline) |
| `apply-schema.js` | Aplica un schema SQL ad-hoc (no migrations) |
| `apply-land-assets-to-bd.mjs` | Aplica assets de tierras descargados a la BD |
| `aggregate-daily-summaries.mjs` | Agrega summaries diarias (helper, usado por `refresh-fumigations`) |
| `filter-missing-lands.js` | Filtra fincas que están en DJI pero no en BD (helper de diff) |
| `normalize-lands.js` | Normaliza nombres de fincas (helper de upsert) |
| `smoke-test-db.js` | Smoke test mínimo de la BD |
| `validate-post-import.js` | Validación después de un import grande |
| `e2e-fumigation-test.js` | E2E test del flow de fumigaciones (CLI, no playwright) |
| `dashboard-queries.js` | Replica las queries del dashboard en CLI (debug) |
| `start-dev.mjs` | Helper de dev: levanta el server con logs limpios |
| `generate-icons.cjs` | Genera iconos de la app (build asset) |
| `generate-polygon-preview.js` | Genera preview HTML de polígonos (debug) |
| `backup-pre-import-fix.js` | Backup antes de aplicar un fix de import |
| `backup-djiag-health.js` | Backup del archivo `_health.json` del scraper |
| `cleanup-parcel-snapshots.js` | Limpia snapshots viejos de parcelas |
| `_batch-upsert-fumigations.js` | Batch upsert de fumigaciones (helper) |
| `_check-users.js` | Verifica usuarios en NextAuth (debug auth) |
| `_screenshot-map.cjs` | Screenshot del mapa (debug visual) |

## Cron semanal (fumigaciones)

> **Cierra el hallazgo audit ui-ux-2026-07 §9**: data stale 24-48h porque
> la BD solo se actualizaba con el backfill manual.

### `npm run refresh:fumigations`

Refresca los datos derivados de fumigaciones **sin re-scrapear DJI**.
Hace 2 cosas, en este orden, dentro de una transacción:

1. **Backfill de fumigaciones** (`backfill-fumigations-from-flights.js`):
   re-agrupa `dji_flights` por `(parcel_id, fecha local Colombia)` y
   re-inserta en `dji_fumigations` con `source='import'`. Borra las
   filas previas de este origen (idempotente).
2. **Update del schedule** (`update-fumigation-schedule.js`):
   re-calcula `dji_fumigation_schedule.last_fumigation_date` y
   `next_due_date` desde los datos frescos de `dji_fumigations`.

**Idempotente**: correr N veces = mismo resultado.

**Exit codes**: 0 = OK, 1 = error de DB.

**Output esperado**:
```
[refresh-fumigations] starting refresh...
[refresh-fumigations] done: 130 fumigations updated, 87 schedule rows, took 4231ms
```

### GitHub Action: `.github/workflows/refresh-fumigations.yml`

Corre automáticamente **todos los lunes a las 06:00 UTC** (= 01:00
America/Bogota). También triggerable a mano desde la tab "Actions"
(`workflow_dispatch`).

Para que funcione en producción, el repo debe tener configurado el
secret `DATABASE_URL` (o `DATABASE_URL_DIRECT`) en
*Settings → Secrets and variables → Actions*. Si no está, el workflow
falla explícitamente con un mensaje claro (no falla silencioso).

```bash
# Setup del secret (una vez)
gh secret set DATABASE_URL --repo <owner>/aeroadmin-afm
# Pegar el connection string de Supabase cuando lo pida.
# Formato: postgresql://postgres:PASSWORD@db.host.supabase.co:5432/postgres
```

### Cuándo correr el script a mano

- Después de un backfill manual grande de vuelos (`upsert-flights-from-djiag.js`)
  para que el panel vea los nuevos vuelos sin esperar al lunes.
- Después de un fix de datos que haya tocado `dji_flights` directamente.
- Después de un import manual de fumigaciones.

## Cuándo NO usar `refresh:fumigations`

Si **no** corriste el scraper DJI recientemente, `dji_flights` no tiene
data nueva y este script no agrega nada — solo re-procesa lo que ya
está en la BD. En ese caso, primero corré el scraper:

```bash
npm run pipeline:djiag
# o, si solo querés los vuelos y no las fumigaciones agregadas:
npm run scrape:djiag
node scripts/upsert-flights-from-djiag.js
node scripts/spatial-join-flights-parcels.js
npm run refresh:fumigations
```

## Scripts archivados

Scripts de debug/migración de sprints anteriores están en
`scripts/_archive/2026-Q1-Q2-debug/`. Cada uno tiene una entrada en el
`README.md` del archive con el bug que resolvió y el sprint. **No se
referencian desde `package.json` ni desde código de producción** —
verificado antes de archivar.

Si necesitás un script archivado para un bug similar: leé el `README.md`
del archive, entendé qué hacía, y escribí una nueva versión que use el
código actual. NO corras los scripts archivados directamente — asumen
estados de BD que ya no aplican.
