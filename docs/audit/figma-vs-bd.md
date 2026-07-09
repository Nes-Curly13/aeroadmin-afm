# Audit Figma vs BD — AeroAdmin AFM

**Fecha**: 2026-07-09
**Origen del design**: Archivo Figma `AFM_SIG` (file_key `MJv8IgOcvKt5suscRzIIEQ`)
**Frames cubiertos**: 2 de ~8 (los entry points de los 2 blueprints Make.com originales)
**Frames faltantes**: Field Management Map view, Task History List view, Parcel Detail, Cloud Reconstruction, Data Analysis, Device Management, Settings, Afm Drone, Other Regions

## Frames analizados

### Frame A — Field Management (`1001-6945`)

Source blueprint: `make/www_djiag_com_mission_1920w_default.make`
URL DJI: `https://www.djiag.com/mission` → click "Field Management"
Screenshot: `make/figma-frame-field-management.png`

| # | Campo UI (label) | Tipo | Valor ejemplo | Columna BD | Cobertura | Gap |
|---|---|---|---|---|---|---|
| 1 | `name` (título card) | string | `Gertrudis STE 116C` | `dji_parcels.land_name` (text) | 1207/1207 | — |
| 2 | `area` (número) | number + `ha` suffix | `7.75 ha` | `dji_parcels.declared_area_ha` (numeric(10,4)) | 1205/1207 | PostGIS calc; los 2 nuevos del re-scrape no tienen geom aún |
| 3 | `address` (string libre) | string | `Amaime, Palmira, Sur, Valle del Cauca, Colombia` | `dji_parcels.location_label` (text) | 1207/1207 | — |
| 4 | `date` (YYYY/MM/DD) | date | `2026/07/03` | `dji_parcels.fetched_at` (timestamptz) | 1207/1207 | ⚠️ semántica distinta: UI muestra fecha DJI, BD muestra fecha de scrape |
| 5 | `type` (chip) | enum | `Farmland` / `Orchards` | `dji_parcels.field_type` (text) + `dji_parcels.is_orchard` (boolean) | 1207/1207 | — |
| 6 | `count` (header) | integer | `1205` | `count(*) FROM dji_parcels` | 1207/1207 | UI tiene 1205, BD 1207 (+2 nuevas del re-scrape) |

#### Sidebar
```
DJI SMARTFAR...
├── Cloud Reconstruction   (no cubierto)
├── Task History           (cubierto por Frame B)
├── Field Management       (cubierto por este frame)
├── Data Analysis          (no cubierto)
└── Device Management      (no cubierto)

(footer)
├── Settings               (no cubierto)
├── Afm Drone              (no cubierto)
└── Other Regions          (no cubierto)
```

#### Filtros visibles
- Search box ("Location Data")
- Tabs: `All` (active) / `Farmland` / `Orchards` (sin equivalente en mi UI actual — sólo es filtro de UI DJI, no en BD)

### Frame B — Task History Map view

Source blueprint: `make/www_djiag_com_records_1920w_default.make`
URL DJI: `https://www.djiag.com/records`
Screenshot: `make/figma-frame-task-history.png`

| # | Campo UI | Tipo | Valor ejemplo | Tabla origen BD | Gap |
|---|---|---|---|---|---|
| 1 | `date_range` (top right) | date range | `2026-01-01 → 2026-07-08` | n/a (filtro) | — |
| 2 | Header card: `Agriculture <N>mu` | float + unidad | `5462.23mu` | agregable desde `dji_fumigations` | ⚠️ sin tabla materializada |
| 3 | Header card: `8028times` | integer | `8028times` | `count(*) FROM dji_flights` (7710 actual) | ⚠️ aprox, varía según fuente |
| 4 | Header card: `100884.1L` | float + unidad | `100884.1L` | agregable desde `dji_flights.amount` o `dji_fumigations.dose_l_per_ha` | ⚠️ no equivalente directo |
| 5 | Header card: `631Hour11min23s` | duration | `631Hour11min23s` | `sum(duration_seconds) FROM dji_flights` | ⚠️ falta formato HHhMMmSSs |
| 6 | Day card: `YYYY/MM/DD<weekday>` | date | `2026/07/08 Wednesday` | agrupable desde `dji_flights.start_at::date` | ⚠️ weekday no en BD |
| 7 | Day card: `Agriculture X.XXmu` | float | `18.29mu` | (idem #2 por día) | ⚠️ idem |
| 8 | Day card: `Ntimes` | integer | `22times` | `count(*) FROM dji_flights WHERE date=...` | — |
| 9 | Day card: `XL` | float | `365.2L` | (idem #4) | ⚠️ idem |
| 10 | Day card: `XHourYminZs` | duration | `1Hour44min53s` | `sum(duration_seconds) WHERE date=...` | ⚠️ idem |
| 11 | Map (parcel polygons) | geom + label | (rectángulos con id) | `dji_parcels.spray_geom` + `dji_flights.start_at` filter | ⚠️ requiere `/map` con drill temporal |

## Unit conversion

DJI muestra `mu` (亩), unidad china:
- **1 mu = 666.67 m² = 0.0667 ha**

| Unidad DJI | Equivalente | Uso en mi BD |
|---|---|---|
| `mu` | m² × 0.0015 | `dji_parcels.spray_area_m2 / 666.67` |
| `ha` | m² × 0.0001 | `dji_parcels.declared_area_ha` (ya en ha) |
| `L` | litros (igual) | `dji_flights.amount` o `dji_fumigations.dose_l_per_ha × area_ha` |
| `Hour Mmin Ssec` | segundos / 3600, etc | `dji_flights.duration_seconds` |

## Gaps priorizados (sprint derivado)

| # | Gap | Severidad | Acción | Status |
|---|---|---|---|---|
| 1 | `declared_area_ha` NULL en 1205/1205 | 🔴 Crítico | Backfill PostGIS desde `spray_geom` | ✅ Cerrado (migration `20260709000000`) |
| 2 | `address` (location_label) no existe | 🟠 Alto | Agregar columna + re-scrape con DJI GraphQL | ✅ Cerrado (migration `20260709000000` + re-scrape 2026-07-09) |
| 3 | `dji_daily_summaries` no existe | 🟡 Medio | Crear `scripts/aggregate-daily-summaries.mjs` | ✅ Cerrado (135 días, 7710 flights) |
| 4 | `total_area_mu` / `work_area_mu` / `obstacle_area_mu` NULL | 🟡 Medio | Re-scrape con DJI GraphQL | ✅ Cerrado (1207/1207 con datos, 31 NULL en obstacle) |
| 5 | `waypoints` solo 391/1205 (32%) | 🟡 Medio | Re-scrapear lands que fallaron | ⏳ Pendiente — `download:djiag:assets` separado |
| 6 | `reference_point` solo 247/1205 (20%) | ⏳ Pendiente | ⏳ Mismo script de #5 | ⏳ |
| 7 | Frames Figma faltantes (Cloud, Data, Devices) | 🟢 Bajo | Pedir al usuario los frames restantes | ⏳ |

## Cómo se cierra esto (plan A)

1. ✅ Audit doc (este archivo).
2. ⏳ Investigar `declared_area_ha` — buscar en el raw JSON de `lands` y en `land-detail` subquery.
3. ⏳ Migración SQL: `20260709000000_add_location_label_to_parcels.sql`.
4. ⏳ `lib/djiag-from-make/field-management.ts` — wrapper tipado sobre `DjiagKoreanClient` + GraphQL lands, con JSDoc que mapea cada campo a su screen counterpart.
5. ⏳ `lib/djiag-from-make/task-history.ts` — wrapper para flights aggregation, mismo approach.
6. ⏳ `scripts/aggregate-daily-summaries.mjs` — materializa `dji_daily_summaries` desde flights+ fumigations.
7. ⏳ Tests de paridad: counts, totales, unit conversion.
8. ⏳ Commit + push.
