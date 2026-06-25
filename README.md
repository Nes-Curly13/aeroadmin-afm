# AeroAdmin AFM

Sistema de administración y visualización de datos de vuelos de drone con capacidades GIS.

## Configuración
1. `npm install`
2. Crear `.env.local` desde `.env.example`
3. Iniciar PostGIS local con `npm run db:up`
4. Ejecutar `db/schema.sql` y opcionalmente `db/seed.sql` en PostgreSQL con PostGIS
5. `npm run dev`

## Base de datos local
- Servicio Docker: `postgres` de `docker-compose.yml`
- Base de datos por defecto: `afm_flights`
- Usuario: `postgres`
- Contraseña: `postgres`
- Conexión: `postgresql://postgres:postgres@localhost:5432/afm_flights`

## Importación DJI
- Ejecutar el scraper para generar los archivos locales en `djiag_exports/`
- Cargar la estructura DJI con `npm run db:init`
- El importador usa `records_history.json`, `land_file_urls.json` y los archivos descargados en `djiag_exports/land_files/`
- Las rutas geométricas se guardan como JSON crudo y, cuando aplica, como `geometry` PostGIS para su uso en el mapa

## Pipeline DJI AG (scraping → DB)

Tira la cadena completa de captura + ingestión en un solo comando. La
primera vez tarda ~5 min (login + scraping); corridas siguientes con
`--skip-scrape` tardan ~1 min.

```bash
# Full pipeline, últimos 30 días (login + scrape + ingestión):
npm run pipeline:djiag -- --days 30

# Solo ingestión (usar exports existentes en djiag_exports/):
npm run pipeline:djiag -- --skip-scrape --skip-fetch-lands

# Dry-run (ver qué comandos correría sin ejecutarlos):
npm run pipeline:djiag:dry

# Re-correr un sub-set de pasos (e.g. solo spatial join + backfill):
npm run pipeline:djiag -- --skip-scrape --skip-fetch-lands \
  --start-from 4 --stop-at 6 --tolerance 10000
```

### Pasos ejecutados (en orden)

| # | Paso | Qué hace | Si lo querés invocar a mano |
|---|---|---|---|
| 1 | scrape per-flight | Playwright → `djiag_exports/perflight_records.json` | `node scrape_djiag_perflight.js --days 30` |
| 2 | scrape fumigations aggregate | Playwright → `djiag_exports/fumigations.json` | `node scrape_djiag_records.js --days 30` |
| 3 | upsert flights | `djiag_exports/perflight_records.json` → DB `dji_flights` | `node scripts/upsert-flights-from-djiag.js` |
| 4 | spatial join flights × parcels | `dji_flights.parcel_id` ← `dji_parcels.spray_geom` | `node scripts/spatial-join-flights-parcels.js --tolerance 10000` |
| 5 | upsert fumigations aggregate | `djiag_exports/fumigations.json` → DB `dji_fumigations` (parcel_id NULL) | `node scripts/upsert-fumigations-from-djiag.js` |
| 6 | backfill per-parcel fumigations | `dji_flights` → `dji_fumigations` (parcel_id NOT NULL, source='import') | `node scripts/backfill-fumigations-from-flights.js` |
| 7 | update fumigation schedule | `dji_fumigation_schedule.last/next_due_date` desde fumigaciones reales | `node scripts/update-fumigation-schedule.js` |
| 8 | fetch lands | Playwright + GraphQL → `djiag_exports/lands.json` | `node scripts/fetch-lands-from-djiag.js` |
| 9 | upsert lands | `lands.json` → DB `dji_parcels` (columnas API, partial UPSERT) | `node scripts/upsert-lands-from-djiag.js` |

### Flags disponibles del pipeline

- `--days N` — ventana de scraping (default 30).
- `--tolerance M` — distancia máxima en metros para el spatial join (default 500; 10000 = ~10 km para matching permisivo).
- `--skip-scrape` — no re-scrapear; usar archivos en `djiag_exports/`.
- `--skip-fetch-lands` — no tocar lands (solo fumigations + flights).
- `--start-from STEP` / `--stop-at STEP` — sub-set. Acepta número (1-9) o substring del nombre (e.g. `--start-from spatial`).
- `--dry-run` — loguea comandos sin ejecutarlos.

### Scripts utilitarios

| Comando | Para qué |
|---|---|
| `npm run db:up` / `npm run db:down` | Levantar / bajar el docker compose (PostGIS local). |
| `npm run db:migrate` | Aplicar migrations SQL pendientes (`supabase/migrations/`). Idempotente. |
| `npm run seed:cadences` | Cargar `lib/fumigation-cadence-config.json` con cadencias por cultivo. |
| `npm run scrape:djiag` / `npm run scrape:djiag:smoke` | v2 scraper (smoke mode = solo discovery de endpoints). |
| `npm run fetch:djiag:lands[:fixtures]` | Fetch de lands vía Playwright; `--save-fixtures` guarda para tests. |
| `npm run fetch:djiag:fumigations` | Fetch de fumigaciones aggregate. |
| `npm run upsert:djiag:lands` / `:fumigations` / `:flights` | Upserts individuales (cubiertos por el wrapper). |
| `npm run db:import:lands` / `:fumigations` | Pipelines específicos (cubiertos por el wrapper). |
| `npm run capture:djiag:*` | Capturar fixtures para los tests (`tests/fixtures/djiag-live/`). |
| `npm run print:djiag:aggr-by-day` / `:flight-records` | Pretty-print de exports para debugging. |
| `npm run dump:djiag:flights` | Dump rápido de la respuesta per-flight. |

### Smoke test de la DB

```bash
node scripts/smoke-test-db.js
```

Corre 8 aserciones sobre el estado actual de la DB (parcelas, vuelos,
fumigaciones, cobertura de spatial join, etc.). Exit 0 = todo OK, exit 1
= alguna falló con detalle.

## Migración a Supabase
1. Crear proyecto Supabase con PostGIS habilitado
2. Usar `supabase/migrations/20260428153000_init_afm_flight_gis.sql`
3. Cargar `supabase/seed.sql` para datos de demo
4. Configurar `DATABASE_URL` con la conexión pooled de Supabase
5. Configurar `DATABASE_URL_DIRECT` para tareas de admin
6. Configurar `DATABASE_SSL=true`

## Verificaciones
- `npm test`
- `npm run build`

## Estado actual
- Dashboard y mapa implementados
- Rutas API para parcelas, vuelos y alertas implementadas
- Pruebas cubriendo reglas de alertas, validación de parámetros y respuestas de API
- Ambiente PostGIS local preparado para desarrollo y despliegue
- Archivos SQL de migración y seed preparados para Supabase

## Rutas
- `/` - Panel de Control
- `/map` - Mapa de Operaciones
- `/api/parcels` - API de Parcelas
- `/api/flights` - API de Vuelos
- `/api/alerts` - API de Alertas
