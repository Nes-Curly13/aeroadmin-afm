# Actualización de datos — AeroAdmin AFM

> Documento de referencia (sustentación): **cómo se cargan, actualizan y mantienen
> los datos** en la plataforma, desde el dron hasta la pantalla, en los tres modos
> (automático, periódico y manual) más las cargas iniciales y los backfills.
>
> Complementa `docs/ARCHITECTURE.md` (flujo y decisiones), `docs/DJI_SCRAPER.md`
> (scraper) y `docs/OBJETIVOS-TRAZABILIDAD.md` (OE3 — flujo campo → sistema).

---

## 1. Panorama: por dónde entran/actualizan los datos

| # | Modo | Fuente | Mecanismo | Frecuencia |
|---|---|---|---|---|
| A | **Sincronización DJI** | DJI SmartFarm (nube) | Scraper Playwright → pipeline | Manual / cron externo |
| B | **Refresco de derivados** | `dji_flights` en BD | `refresh:fumigations` (MV + schedule) | Semanal (lunes 01:00 Bogotá) |
| C | **Actualización manual** | Operador/admin | UI de la plataforma (APIs `/api/admin/*`) | A demanda |
| D | **Cargas iniciales / backfills** | Legacy + DJI | Scripts one-shot (idempotentes) | Setup / mantenimiento |

Todos los caminos son **idempotentes** y escriben en **Postgres + PostGIS** (SRID 4326); la app Next.js es **read-only** contra la BD (salvo las mutaciones de C).

---

## 2. Fuente A — Sincronización con DJI SmartFarm

**Qué es:** la plataforma **no es un scraper HTML** ni usa una API REST pública de
DJI. Es un **cliente headless de Playwright** (`lib/djiag-korean-client.js`) que opera
la UI web de DJI SmartFarm y **captura las responses de la API interna (GraphQL)** que
la propia UI firma.

**Por qué así:** DJI firma sus POST con un **HMAC calculado en el navegador**
(interceptor Axios en `assets/sign.*.wasm`). Reimplementar el firmante es frágil; el
navegador de DJI firma por nosotros y solo capturamos el JSON. Es más estable que un
scraper de DOM.

**Robustez:** login UI + `accept-language: zh-CN,zh` (rutea al backend coreano),
storage state cacheado (7 días), **backoff exponencial**, **circuit breaker**
(3 fallos → cooldown 5 min), fix de race en la captura y paginación por cursor.

**Salidas** (en `djiag_exports/`, gitignored): `perflight_records.json`,
`fumigations.json`, `lands.json`, `_health.json`.

> Detalle: `docs/ARCHITECTURE.md`, `docs/DJI_SCRAPER.md`, `SCRAPER_DEFECTS.md`.

---

## 3. Pipeline principal — `npm run pipeline:djiag`

Orquestador `scripts/run-pipeline.js`: **10 steps idempotentes** (cada uno UPSERT/
`DELETE WHERE source` antes de re-insertar). Re-correr N veces no duplica filas.

| # | Step | Comando | Destino |
|---|---|---|---|
| 1 | scrape per-flight | `scrape_djiag_perflight.js --days N` | `djiag_exports/perflight_records.json` |
| 2 | scrape fumigations aggregate | `scrape_djiag_records.js --days N` | `djiag_exports/fumigations.json` |
| 3 | upsert flights | `scripts/upsert-flights-from-djiag.js` | `dji_flights` |
| 4 | spatial join vuelos ∩ parcelas | `scripts/spatial-join-flights-parcels.js --tolerance M` | `dji_flights.parcel_id` |
| 5 | upsert fumigations aggregate | `scripts/upsert-fumigations-from-djiag.js` | `dji_fumigations` (`source='dji_aggr'` / `import`) |
| 6 | backfill fumigations + schedule | `POST /api/admin/backfill-fumigations` (HTTP, bearer `BACKFILL_TOKEN`) | `dji_fumigations` + `dji_fumigation_schedule` |
| 7 | fetch lands | `scripts/fetch-lands-from-djiag.js --days N` | `djiag_exports/lands.json` |
| 8 | download land assets | `scripts/download-land-assets.js` | `djiag_exports/land_files/` (KML/polígonos) |
| 9 | upsert lands | `scripts/upsert-lands-from-djiag.js` | `dji_parcels` |
| 10 | refresh MV mensual | `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fumigations_monthly` | MV del dashboard |

**Flags útiles:** `--days N`, `--skip-scrape`, `--skip-fetch-lands`,
`--skip-download-assets`, `--skip-refresh-mv`, `--tolerance M`, `--start-from`/`--stop-at`,
`--dry-run`. El step 6 requiere el server Next arriba + `BACKFILL_TOKEN` (bearer).

**Salud:** al final escribe `djiag_exports/_health.json` **y** la tabla `djiag_health`
(singleton) → la expone `GET /api/admin/djiag-health` (admin).

---

## 4. Reconstrucción de fumigaciones (regla del operador — 2026-09-21)

Reagrupa los vuelos en **fumigaciones** por **día + DBSCAN espacial (~330 m)** y calcula
la **cobertura real** (unión de los tracks con buffer 2 m). Reemplaza el agrupado legacy
por día. Todos los scripts son **dry-run por defecto**; escriben con `--apply`.

```bash
# 1) Ingesta de tracks (KML/GeoJSON) → dji_flight_tracks + dji_flights.track
node scripts/import-flight-tracks.js --in djiag_exports/tracks.geojson --apply

# 2) Reagrupa por día + DBSCAN y calcula cobertura
node scripts/regroup-fumigations-dbscan.js --eps 0.003 --apply

# 3) Asigna parcela a huérfanas por intersección cobertura ∩ parcela
node scripts/assign-orphan-parcels.js --min-frac 0.05 --apply

# 4) Crea parcela automática por cada huérfana restante
node scripts/create-auto-parcels.js --apply

# 5) Refresca las materialized views
node scripts/refresh-fumigations.js
```

**Garantías:** `session_key = 'dbscan|<día>|<min flight_id>'` (determinista); el
reagrupado borra y recrea **solo** las fumigaciones `source='import' AND session_key IS NOT NULL`
(no toca manuales ni asignaciones). Resultado en prod: 523 fumigaciones, 523 con parcela,
0 huérfanas.

> Previews (HTML autocontenido): `scripts/preview-tracks.js`, `preview-track-groups.js`,
> `preview-prod-fumigations.js`.

---

## 5. Refresco periódico (cron) — Modo B

**`npm run refresh:fumigations`** (`scripts/refresh-fumigations.js`) — **sin re-scrapear**:
1. Refresca la MV `mv_fumigations_monthly` (dashboard).
2. Recalcula `last_fumigation_date` / `next_due_date` de `dji_fumigation_schedule`
   desde la última fumigación real por parcela.

Automático vía **GitHub Action** `.github/workflows/refresh-fumigations.yml`
(**lunes 06:00 UTC = 01:00 Bogotá**, y `workflow_dispatch` manual). Requiere el secret
`DATABASE_URL` (o `DATABASE_URL_DIRECT`).

**Monitoreo:** `npm run health:watchdog` (`scripts/health-watchdog.js`) corre cada ~6 h y
falla si `lastSuccessfulSyncAt` supera `HEALTH_STALE_HOURS`.

> Cuándo correr a mano: tras un backfill grande de vuelos, tras un fix que tocó
> `dji_flights`, o tras un import manual — para no esperar al lunes.

---

## 6. Actualización manual desde la plataforma — Modo C

Mutaciones por la UI, vía APIs `/api/admin/*` con RBAC (`admin` | `supervisor`); el
cliente hace `router.refresh()` para re-leer del servidor.

| Qué se actualiza | Dónde (UI) | API | Notas |
|---|---|---|---|
| **Fumigación** (alta) | `/fumigaciones/nueva` (wizard 3 pasos) | `POST /api/admin/fumigations` | Importar vuelo DJI o manual; auto-fill del vuelo |
| **Fumigación** (edición) | `/fumigaciones/[id]/editar` | `PATCH /api/admin/fumigations/[id]` | PATCH sparse (solo campos cambiados) |
| **Fumigación** (borrado) | detalle / listado | `DELETE …/[id]`, `/bulk-delete` | Soft-delete (`deleted_at`) + audit log |
| **Categoría** (bulk) | `/fumigaciones` | `POST /api/admin/fumigations/bulk-category` | |
| **Asignar parcela** a huérfana | geovisor (Inspector) | `POST /api/admin/fumigations/[id]/assign-parcel` | |
| **Parcela** (alta) | `/admin/parcels/new` | `POST /api/admin/parcels` | 3 secciones + geometría |
| **Parcela** (import GIS) | `/admin/parcels/import` | `POST …/import/preview` → `…/import/commit` | KML/SHP/GPKG (preview→commit) |
| **Parcela** (metadata inline) | `/admin/parcels` | `PATCH /api/admin/parcels/[id]/metadata` | Cliente/Finca (FK), municipio, variedad… |
| **Ciclo / fase** | `/parcelas/[id]` | `POST /api/admin/cycles`, `POST …/cycles/[id]/close`, `POST …/cycles/backfill` | Ver §10 |
| **Reglas fitosanitarias** | `/admin/reglas-fitosanitarias` | `POST/PATCH/DELETE /api/admin/phase-application-rules` | Ventana/cadencia por fase |
| **Catálogos** | admin | `/api/admin/clients`, `/api/admin/farms`, `/api/admin/products` | Cliente → Finca → Parcela |
| **Facturas** | detalle fumigación | `/api/admin/fumigations/[id]/invoices` | Crear / cancelar |

---

## 7. Cargas iniciales y backfills — Modo D

| Comando | Qué hace | Cuándo |
|---|---|---|
| `npm run db:init` (`import_djiag_data.js`) | Import inicial completo desde CSV/JSON de DJI | Setup de la BD |
| `node scripts/backfill-clients-farms.js` | Deriva `clients`/`farms` y las FK en `dji_parcels` | Una vez por ambiente |
| `POST /api/admin/cycles/backfill` | Crea ciclos virtuales (`source='dji_inferred'`, `needs_review`) para gaps >120 d | Una vez por ambiente (idempotente; no correr 2×) |
| `npm run db:import:lands` (`import-lands-pipeline.js`) | fetch + upsert de parcelas | Tras un scrape manual |
| `node scripts/import-flight-tracks.js --in … --apply` | Ingesta de tracks KML | Ver §4 |
| `npm run seed:cadences` / `npm run auth:seed` | Config de cadencias / admin inicial | Setup |
| `npm run db:backup` | Dump `.sql.gz` con timestamp | Antes de cambios de schema |

---

## 8. Garantías de consistencia

- **Idempotencia**: UPSERT `ON CONFLICT DO UPDATE`; borrado de `source='import'` previo;
  `session_key` determinista. Re-correr no duplica.
- **No huérfanas**: §4 asegura que cada fumigación quede con parcela (real o auto-parcela).
- **Auditoría**: `dji_fumigations` (soft-delete + `recorded_at/by`) y
  `fumigation_audit_log` (eventos `created`/…). El `batch_id` del import original se
  preserva en re-scrape.
- **Salud**: `_health.json` + `djiag_health` + `GET /api/admin/djiag-health`; watchdog
  cada ~6 h; circuit breaker + backoff del scrap.
- **Cadencia**: **fuente única** `lib/fumigation-cadence.ts` (CAD-001) deriva fase/
  vencimiento de `cycles.start_date`.

---

## 9. Variables de entorno (resumen)

```
DATABASE_URL / DATABASE_URL_DIRECT   # Postgres/PostGIS (prod: pooled 6543)
DATABASE_SSL                         # true en Supabase
AUTH_SECRET / AUTH_URL / AUTH_TRUST_HOST
BACKFILL_TOKEN                       # step 6 (backfill por HTTP) y cron
HEALTH_URL / HEALTH_TOKEN            # watchdog
DJIAG_EMAIL / DJIAG_PASSWORD         # scraper (login SmartFarm)
```

---

## 10. Consideración de campo: fecha de siembra / ciclos

La **fase del ciclo y la cadencia** dependen de `cycles.start_date`
(fecha de siembra/renovación). Ese dato **no viene confiable** de DJI (las fuentes lo
traen faltante o desactualizado), por lo que **se requiere trabajo de campo** para
asignarlo/actualizarlo. La plataforma lo permite:
- `/parcelas/[id]` → **"Iniciar nuevo ciclo"** (`POST /api/admin/cycles`) y
  **"Registrar corte"** (`POST …/cycles/[id]/close`).
- `/admin/parcels/new` → campo **"Fecha de siembra"**.

Hasta completar ese levantamiento, la fase/cadencia no se muestra como métrica de
cumplimiento en el dashboard (Fase 6 diferida). Ver `docs/PLAN-PRUEBAS-FUNCIONALIDAD-USABILIDAD.md`
§2.1 y §5 (CIC-01..07).

---

## 11. Referencias

- `docs/ARCHITECTURE.md` — flujo end-to-end, decisiones, failure modes.
- `docs/DJI_SCRAPER.md` / `docs/DJI_CLOUD_API.md` — scraper y alternativas de API.
- `docs/HEALTH-WATCHDOG.md` — monitoreo del pipeline.
- `docs/DATA-MODEL.md` — tablas, columnas, índices.
- `docs/OBJETIVOS-TRAZABILIDAD.md` — OE3 (flujo campo → sistema) y evidencia.
- `scripts/README.md` — tabla completa de scripts y cron semanal.
- `docs/PRUEBAS-EJECUCION-2026-09-23.md` — resultados de la batería de pruebas.
