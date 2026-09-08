# AeroAdmin AFM — Data Model

> **Snapshot 2026-09-08**, master `3414c05` + working tree (parcel-drawer fixes).
> **Purpose**: documentar el schema PostGIS para que un AI (Claude, GPT, etc.) pueda entender la data sin tener que parsear 40 migrations.
> **Source of truth**: `db/migrations/*.sql` (40 archivos, en orden cronológico) + `lib/types.ts` (shapes de aplicación).

---

## 0. Overview

**PostgreSQL 16 + PostGIS 3.4**. Single-tenant, single-user (operador de drones cañero, Valle del Cauca, Colombia). ~1,213 fincas, ~16k vuelos, ~17k fumigaciones.

**Convenciones**:
- Todas las tablas del dominio DJI empiezan con `dji_` (legacy del scraper).
- Soft-delete: `deleted_at TIMESTAMPTZ NULL` + `deleted_by TEXT NULL`.
- Audit: `created_at`, `created_by` (o `recorded_by`), `updated_at`.
- Geometry: PostGIS SRID 4326 (WGS84). Geometry columns se serializan como GeoJSON en el boundary (repository → service → page).
- Fechas: TIMESTAMPTZ en BD, ISO 8601 string en el boundary. Fechas "del operador" (ej. `fumigation_date`, `invoiced_at`) son DATE en BD.
- TZ del operador: `America/Bogota` (COT, UTC-5).

## 1. Tablas núcleo (Dominio)

### `dji_parcels` (1,213 filas)
La parcela / finca / suerte. Centro del modelo.

| Columna | Tipo | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `external_id` | TEXT UNIQUE NOT NULL | ID público de DJI (lo usa el scraper) |
| `source` | TEXT | `dji` / `manual` / `imported` (migration `20260804081000`) |
| `land_name` | TEXT NULL | Nombre legible (ej. "Lote 5 - El Progreso") |
| `field_type` | TEXT | `Farmland` / `Orchards` |
| `declared_area_ha` | NUMERIC NULL | |
| `spray_area_m2` | NUMERIC NULL | |
| `drone_model_code` | INT NULL | 0 / 72 / 201 / 210 |
| `is_orchard` | BOOLEAN | |
| `spray_geometry` | GEOMETRY(Polygon, 4326) NULL | |
| `reference_point` | GEOMETRY(Point, 4326) NULL | |
| `waypoints_geometry` | GEOMETRY(LineString, 4326) NULL | |
| `waypoint_count` | INT NULL | |
| `crop_type` | TEXT NULL | "Caña de azúcar" / "Frutales" (migration `20260722000000`) |
| `planting_date` | DATE NULL | (migration `20260801000000`) |
| `owner_name`, `owner_contact` | TEXT NULL | |
| `supervisor_notes` | TEXT NULL | |
| `client_id` | BIGINT NULL FK → `clients.id` | (migration `20260905000000`) |
| `farm_id` | BIGINT NULL FK → `farms.id` | (migration `20260905000000`) |
| `data_validity` | TEXT NULL | `fresh` / `needs_review` / `stale` / `unknown` |
| `last_validated_at` | TIMESTAMPTZ NULL | |
| `validated_by_email` | TEXT NULL | |
| `deleted_at`, `deleted_by` | TIMESTAMPTZ/TEXT NULL | soft-delete (migration `20260720000000`) |

### `dji_flights` (~16k filas)
Vuelo individual de dron. **El evento atómico** del sistema.

| Columna | Tipo | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `parcel_id` | BIGINT NULL FK → `dji_parcels.id` | puede ser NULL (1671 huérfanos) |
| `start_at` | TIMESTAMPTZ | |
| `point` | GEOMETRY(Point, 4326) | centroide (GIST index, migration `20260628100000`) |
| `area_m2` | NUMERIC NULL | |
| `spray_usage_ml` | NUMERIC NULL | |
| `drone_nickname` | TEXT NULL | |
| `pilot_name` | TEXT NULL | |
| `external_id` | TEXT UNIQUE | |

### `dji_fumigations` (~17k filas, soft-delete aware)
**Una fumigación = N vuelos agrupados** (DJI reporta agrupado por día + parcela) **o 1 fumigación manual** del operador.

| Columna | Tipo | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `parcel_id` | BIGINT NULL FK → `dji_parcels.id` | nullable (migration `20260619140000`) |
| `parcels` | TEXT[] NULL | **multi-parcela**: external_ids de suertes secundarias (migration `20260830000000`) |
| `flight_ids` | BIGINT[] NULL | vuelos que generaron esta fumigación (backfill script) |
| `fumigation_date` | DATE NOT NULL | |
| `product_used` | TEXT NULL | texto libre legacy |
| `product_id` | BIGINT NULL FK → `products.id` | catálogo curado (migration `20260829000000`) |
| `dose_l_per_ha` | NUMERIC NULL | 95% del dataset es NULL (DJI no expone) |
| `area_fumigated_m2` | NUMERIC NULL | |
| `duration_minutes` | INT NULL | |
| `drone_code_used` | INT NULL | 0 / 72 / 201 / 210 |
| `vehicle_plate` | TEXT NULL | (migration `20260824000001`) — workaround jsonb |
| `product_registered_ica` | TEXT NULL | formato `ICA-1234-PN` (CHECK constraint) |
| `pilot_license` | TEXT NULL | formato `PCA-12345` Aerocivil (CHECK regex) |
| `human_notes` | TEXT NULL | nota libre del operador |
| `notes` | JSONB NULL | provenance del backfill + vehicle_plate jsonb |
| `category_id` | INT NULL FK → `fumigation_categories.id` | (migration `20260813160000`) |
| `application_type_id` | INT NULL FK → `application_types.id` | (migration `20260824000000`) |
| `recorded_by` | TEXT NULL | |
| `recorded_at` | TIMESTAMPTZ | |
| `source` | TEXT | `manual` / `djiscraper` / `import` |
| `deleted_at`, `deleted_by` | TIMESTAMPTZ/TEXT NULL | soft-delete (migration `20260720000000`) |

### `dji_fumigation_schedule` (1:1 con `dji_parcels`)
La cadencia esperada por parcela.

| Columna | Tipo | Notes |
|---|---|---|
| `parcel_id` | BIGINT PK FK → `dji_parcels.id` | |
| `crop_type` | TEXT NOT NULL | |
| `recommended_cadence_days` | INT NOT NULL | Farmland=14 / Orchards=10 |
| `last_fumigation_date` | DATE NULL | |
| `next_due_date` | DATE NULL | computed: `last + recommended_cadence_days` |
| `is_active` | BOOLEAN | |
| `notes` | TEXT NULL | |

## 2. Tablas de catálogo (curado)

### `fumigation_categories` (Sprint `20260813160000`)
Categorías de producto fumigado: `herbicida`, `insecticida`, `fertilizante`, `fungicida`, `bioestimulante`, `otro`. Tiene `id`, `slug`, `label`, `color`, `sort_order`, `is_active`.

### `application_types` (migration `20260824000000`)
Fase/uso de la aplicación, ortogonal a la categoría. Ej: `pre-emergente`, `post-emergente`, `bioestimulante`, `otro`.

### `dji_vehicles` (migration `20260824000000`)
Catálogo de vehículos. Tiene `plate` (CHECK regex), `description`, `is_active`, `created_at`.

### `products` (migration `20260829000000`)
Catálogo curado de productos fumigación. Tiene:
- `name` UNIQUE por `LOWER(TRIM(name))` (case-insensitive dedup)
- `category` (enum-like, CHECK)
- `active_ingredient` (e.g. "Glifosato")
- `ica_registration`
- `display_color` (hex)
- `is_active`
- `created_by`, `created_at`, `updated_at`

Seed: 4 productos comunes en caña de azúcar en Valle del Cauca (Glifosato 48% LCE, Roundup 36% SL, 2,4-D Amina 72%, Imidacloprid 35% SC).

### `clients` + `farms` (migration `20260905000000`)
Normalización S11+ Fase 3.A. FKs desde `dji_parcels`. Una finca pertenece a un cliente.

### `cycles` + `cycle_events` + `phase_rules` (migration `20260905020000`)
Capa de gestión de ciclos productivos del cultivo. S11+ Fase 4.4. `cycles` representa el ciclo vigente de una parcela (1+ por parcela), `cycle_events` son eventos de siembra/aplicación/corte/renovación, `phase_rules` configura las transiciones de fase.

### `vw_current_cycle` (view, no tabla)
View materializada que calcula el ciclo activo y la fase actual (`current_phase(crop, variety, start_date)`) para cada parcela.

## 3. Tablas de audit / log

### `fumigation_audit_log` (migration `20260815000000`)
Append-only (solo INSERT en operación normal). Campos:
- `id`, `fumigation_id` (FK → `dji_fumigations.id`)
- `action`: `created` / `edited` / `deleted` / `restored` (CHECK constraint)
- `actor_email`
- `changes` (JSONB): shape depende del action
  - `created` → `{ fields: { snapshot completo } }`
  - `edited` → `{ diff: { field: { from, to } } }` (solo campos que cambiaron)
  - `deleted` → `{ snapshot: { ... } }`
  - `restored` → `{ restored_from: { deleted_at, deleted_by } }`
- `created_at`

**Importante**: el `lib/fumigation-audit.ts` es fire-and-forget (AUD-001 del review). Si la BD falla, el operador no se entera.

### `app_users` (migration `20260715000000`)
Usuarios del panel. `id`, `email`, `name`, `password_hash` (bcrypt), `role` (`admin` / `supervisor`), `created_at`, `updated_at`.

### `dji_import_batches`
Audit del scraper: cada corrida del pipeline crea un batch con metadata (fecha, script, records importados, errores).

### `djiag_health`
Health check del scraper DJI: `last_success_at`, `last_failure_at`, `consecutive_failures`, `circuit_open_until` (migration `20260802000000`).

## 4. Tablas misceláneas

### `fumigation_invoices` (migration `20260824000000`)
Una fumigación puede tener N facturas (cuotas, pagos parciales). Campos: `id`, `fumigation_id`, `invoice_number`, `invoiced_at` (DATE), `amount_cop` (pesos colombianos, no centavos), `cancelled`, `cancelled_at`, `cancelled_by`.

### Materialized views
- `mv_fumigations_monthly` (migration `20260801000000`): agregación mensual de fumigaciones
- `mv_fumigation_flight_centroids` (migration `20260824000002`): centroides para map markers

## 5. Relaciones (ER conceptual)

```
                ┌──────────────┐
                │  app_users   │ (admin | supervisor)
                └──────────────┘
                       │
                       │ actor_email (audit)
                       ▼
clients ─1:N─► farms ─1:N─► dji_parcels ─1:1─► dji_fumigation_schedule
                              │  │
                              │  │ N
                              │  ▼
                              │  dji_fumigations ─N:M─► products (FK product_id)
                              │   │                    │
                              │   │ flight_ids[]      │ N (per day)
                              │   ▼
                              │  dji_flights (N)
                              │
                              │ audit append-only
                              ▼
                       fumigation_audit_log

cycles ─N:1─► dji_parcels
cycle_events ─N:1─► cycles
phase_rules (config)

fumigation_invoices ─N:1─► dji_fumigations
fumigation_categories (lookup)
application_types (lookup)
dji_vehicles (lookup)
```

## 6. Indices clave (perf)

- `dji_flights.point` — GIST index (PostGIS, migration `20260628100000`)
- `dji_fumigations.product_id` — partial index `WHERE product_id IS NOT NULL` (migration `20260829000000`)
- `dji_parcels.external_id` — UNIQUE
- `dji_parcels.client_id`, `dji_parcels.farm_id` — FK indexes (migration `20260905000000`)
- `products (LOWER(TRIM(name)))` — UNIQUE
- `products.name` — GIN trigram `WHERE is_active = TRUE`
- `fumigation_audit_log.fumigation_id` — btree
- `dji_flights.parcel_id` — btree (FK)

## 7. Reglas de negocio invariantes (en BD)

- `app_users.email` UNIQUE
- `app_users.role` CHECK IN ('admin', 'supervisor')
- `dji_parcels.source` CHECK IN ('dji', 'manual', 'imported')
- `dji_fumigations.source` CHECK IN ('manual', 'djiscraper', 'import')
- `dji_fumigations.product_registered_ica` ~ `^ICA-[0-9]+(-[A-Z]+)?$` (CHECK)
- `dji_fumigations.pilot_license` ~ `^PC(A)?-[0-9]+$` (CHECK, formato Aerocivil)
- `dji_vehicles.plate` ~ `^[A-Z]{3}-[0-9]{3,4}[A-Z]?$` (CHECK, formato placa colombiana)
- `products.category` CHECK IN (enum)
- `fumigation_audit_log.action` CHECK IN (4 valores)
- `cycles.start_date < cycles.end_date` (si end_date NOT NULL)

## 8. Sources of truth

- **DB schema**: `db/migrations/*.sql` (40 migrations, en orden cronológico).
- **Application types**: `lib/types.ts` (TypeScript interfaces, source of truth para el app).
- **API contracts**: `app/api/**/route.ts` (Next.js route handlers).
- **UI consumption**: `lib/data.ts` (V0 adapter), `api/repositories.ts` (raw SQL), `api/queries.ts` (shared queries).

## 9. Counts actuales (a sep 2026)

| Tabla | Filas |
|---|---|
| `dji_parcels` | ~1,213 |
| `dji_flights` | ~16,353 |
| `dji_fumigations` (activas) | ~17,000 |
| `dji_fumigation_schedule` | ~1,213 |
| `fumigation_audit_log` | ~3,500+ |
| `products` | 4 (seed) + N (creados desde UI) |
| `app_users` | 5 |
| `clients` / `farms` | creados en backfill S11+ |
| `cycles` | creados en backfill S11+ |

---

**Para implementar cambios**: leer migrations en orden cronológico (más viejo a más nuevo), luego `lib/types.ts`, luego las queries en `api/queries.ts` y `api/repositories.ts`.
