# Revisión exhaustiva — Export CSV de todos los vuelos

**Fecha:** 2026-08-30
**Autor:** Mavis (asistente) en conversación con @agFab
**Snapshot de DB usado:** `snapshots/2026-08-30_export-review.json`

---

## TL;DR (3 puntos)

1. **Hoy NO existe un export CSV de "todos los vuelos"**. Hay 3 exports (parcela individual, fumigación individual, multi-hacienda) pero ninguno lista el universo completo de `dji_flights` para análisis cruzado.
2. **El join natural es trivial en SQL** (1 query con 3 LEFT JOIN), pero **el estado de los datos tiene 1 gap crítico + 2 gaps menores** que primero hay que cerrar para que el export sea útil.
3. **Recomendación:** 1 endpoint `/api/admin/reports/flights/export.csv` + serializer `lib/reports/flights-csv.ts`, ½ día de trabajo. Bloqueado por 2 prerequisites (spatial-join, re-import fumigaciones del import reciente).

---

## 1. Inventario de exports CSV existentes

| Endpoint | Source data | Granularidad | Filas esperadas | Tests |
|---|---|---|---|---|
| `/api/admin/parcels/[id]/report.csv` | 1 parcela + fumigaciones | Parcela individual | 1 (header) + 1 fumigation table | `tests/api-admin-parcels-report-csv.test.ts` |
| `/api/admin/fumigations/[id]/report.csv` | 1 fumigación + vuelos asociados | Fumigación individual | 1 (header) + 1 flight table | `tests/api-admin-fumigations-report-csv.test.ts` |
| `/api/admin/reports/farms/report.csv` | Multi-parcela por hacienda/región | Multi (agregado) | N fumigaciones (cap: ventana) | `tests/api-admin-farms-csv.test.ts` |
| **❌ NO EXISTE** `/api/admin/reports/flights/export.csv` | Todos los `dji_flights` (8.7k) | Listado completo | 8759 | — |

**Patrón compartido** (los 3 que existen):
- `lib/reports/{parcel,fumigation,farms}-csv.ts` — funciones puras, sin I/O
- Separador `;`, BOM `\uFEFF` UTF-8, RFC 4180 quoting
- Decimales con coma (es-CO) vía `Intl.NumberFormat("de-DE", ...)`
- 4 secciones delimitadas por filas `Sección;...`
- Función pura con test unitario + 1 test de integración del route

**Helper compartido:** `lib/csv.ts` expone `toCsv<T>()` y `slugFilename()`. Lo usa el export de fumigaciones en `/parcelas/[id]` (vía `components/parcels/export-fumigations-csv-button.tsx`).

---

## 2. Estado de los datos (snapshot 2026-08-30 13:49 UTC)

### Conteos

| Tabla | Filas | Activas | Notas |
|---|---|---|---|
| `dji_parcels` | **1.237** | 1.237 (sin `deleted_at`) | Creció de 1.213 (Track A) a 1.237 (+24 en re-imports) |
| `dji_flights` | **8.759** | — | Creció de 7.710 (Track A) a 8.759 (+1.049) |
| `dji_flights.parcel_id NOT NULL` | **0** | — | ⚠️ GAP CRÍTICO (ver §4.1) |
| `dji_flights.parcel_id IS NULL` | **8.759** | — | Todos los flights son "orphan" |
| `dji_fumigations` | **642** | — | 612 con parcel_id, **610 con `flight_ids[]` poblado** (95%) |
| `dji_fumigation_schedule` | **1.213** | — | Faltan 24 schedules para las 24 fincas nuevas |
| `dji_fumigation_schedule_history` | **1.213** | — | 1 row por schedule (backfill G2) |
| `dji_drone_models` | 4 | — | 0=Sin asignar, 72=T16/T20, 201=T40/T50, 210=T70 |

### Top 5 pilotos (`pilot_name`)

| Piloto | Vuelos | Parcelas únicas |
|---|---|---|
| `default team` | **6.018** | 0 |
| `breiner pelaez` | 1.423 | 0 |
| `Pilotos` | 1.029 | 0 |
| `Samuel Rivas` | 289 | 0 |
| (otros) | 1.001 | 0 |

⚠️ **GAP MENOR**: 6.018 vuelos tienen `pilot_name = "default team"`. Es un placeholder que DJI pone cuando el flight se hizo fuera de un "team" registrado. Cuestionable si filtrarlo del export o no — el operador fumigador real (cuando lo hay) está en `notes` o derivado del `flyer_name`.

### Top 5 distritos (de los 8.759 flights)

| Distrito | Vuelos |
|---|---|
| `Candelaria` | 498 |
| `Pradera` | 430 |
| `El Cerrito` | 377 |
| `Recta Cali - Palmira` | 315 |
| `Buga` | 259 |
| `Guacarí` | 259 |
| `San Pedro` | 246 |

7 municipios cubiertos. Coherente con Valle del Cauca.

### Rango de fechas

- **Primer vuelo:** 2026-01-06
- **Último vuelo:** 2026-07-27
- **Ventana:** ~7 meses (205 días)
- **Promedio:** ~42 vuelos/día
- **Densidad:** ~1 vuelo cada ~17 minutos durante el día operativo

### Top 5 orphan por distrito (8.759 todos)

| Distrito | Orphan count |
|---|---|
| `<null>` | 4.139 |
| `Candelaria` | 498 |
| `Pradera` | 430 |
| `El Cerrito` | 377 |
| `Recta Cali - Palmira` | 315 |

---

## 3. Schema relevante (extracto)

### `dji_flights` (lo que ya tenés — 1 fila por sortie del drone)

```sql
id                  bigint PK
flight_id           bigint      -- DJI internal ID (e.g. 669687291)
parcel_id           bigint FK   -- ⚠️ currently 0/8759 poblados
drone_serial        text        -- e.g. R8383153744
drone_nickname      text        -- e.g. AFM T50-1
pilot_name          text        -- e.g. breiner pelaez
flyer_name          text
district            text        -- municipio (reverse-geocoded)
location            text        -- dirección completa
start_at            timestamptz NOT NULL
end_at              timestamptz NOT NULL
duration_seconds    int NOT NULL
area_m2             numeric(12,2)  -- new_work_area
spray_usage_ml      int
work_speed_m_s      numeric(5,2)
spray_width_m       numeric(5,2)
radar_height_m      numeric(5,2)
manual_mode         boolean
mode_name           int
create_date         date
lng, lat            numeric(10,7)
notes               jsonb       -- raw DJI response
captured_at         timestamptz DEFAULT now()
source              text        -- 'djiag' | 'manual' | 'import'
```

**Índices:** `(parcel_id, start_at desc) WHERE parcel_id IS NOT NULL` (¡el índice no aplica!), `(start_at desc)`, `(drone_serial)`, `(pilot_name) WHERE NOT NULL`.

### `dji_fumigations` (1 fila por evento de fumigación)

```sql
id                bigint PK
parcel_id         bigint FK NOT NULL
fumigation_date   date
product_used      text
dose_l_per_ha     numeric(8,2)
area_fumigated_m2 numeric(12,2)
drone_code_used   int FK dji_drone_models(code)
duration_minutes  int
product_registered_ica  text  -- ICA format: ICA-1234-PN (Sprint H2)
pilot_license          text  -- Aerocivil: PCA-12345 (Sprint H2)
flight_ids        int[]  -- ⚠️ relación 1:N flights → fumigation (Sprint G2)
notes             text
recorded_by       text
recorded_at       timestamptz DEFAULT now()
source            text  -- 'manual' | 'djiscraper' | 'import'
```

**Índice GIN** sobre `flight_ids` (sirve para queries "qué fumigaciones usó el flight X").

### `dji_parcels` (1 fila por finca — modelo normalizado)

```sql
id, external_id, land_name, field_type, declared_area_ha, spray_area_m2,
drone_model_code FK dji_drone_models, drone_model_name,
spray_geom geometry(MultiPolygon, 4326),  -- geofence
waypoints geometry(MultiPoint, 4326),     -- plan de vuelo
client_name, farm_name, municipality, variety  -- Sprint S7.2
```

### Relaciones entre las 3 tablas

```
dji_flights (8759)            dji_fumigations (642)
    │                                  │
    ├── parcel_id ──→ dji_parcels.id ←─┤ parcel_id
    │                                  │
    └── id ────∈ dji_fumigations.flight_ids[]  ← relación N:M vía array
```

**Cardinalidad típica:** 1 fumigación = 1-5 flights (cada flight cubre una pasada del drone sobre la finca). Verificado: 610/642 fumigaciones tienen `flight_ids` no vacío.

---

## 4. Gaps a cerrar antes de habilitar el export

### 4.1 🔴 GAP CRÍTICO: `dji_flights.parcel_id` está 100% NULL

**Síntoma:** 0/8759 flights tienen `parcel_id` poblado (cuando Track A cerró había 6039/7710 = 78.3% poblados). Los nuevos 1.049 flights importados desde entonces no se les hizo spatial-join.

**Causa probable:** El último `import_djiag_data.js` corre con el `ON CONFLICT (external_id) DO UPDATE` que pisa la fila de parcela. Pero la documentación dice que también wipea `dji_fumigations WHERE parcel_id IS NOT NULL` + `dji_flights.parcel_id = NULL` (FK `ON DELETE SET NULL`). Esto NO se ejecutó porque el import es idempotente y el spatial-join es **un script separado que NO se llama automáticamente** desde el import.

**Fix (5 min):**
```bash
node scripts/spatial-join-flights-parcels.js --tolerance 50
```
Recalcula `dji_flights.parcel_id` con `ST_DWithin(point, parcel.spray_geom, 50m)`.

**Riesgo:** los 1.049 flights nuevos están en la zona de "Candelaria/Pradera" (top distritos). El 50m tolerance es generoso — deberían matchear todos. Los que queden NULL son los "orphan reales" (test, manual, fuera de geofence).

**Si después del fix quedan > 2.000 orphans:** considerar crear tabla `manual_parcels` para fincas que DJI no tiene registradas (las nuevas que Breiner suma al margen).

### 4.2 🟡 GAP MENOR: 24 fincas nuevas sin `dji_fumigation_schedule`

**Síntoma:** `parcels = 1237` vs `schedules = 1213`. Las 24 fincas del re-import no tienen `crop_type` ni `recommended_cadence_days`.

**Fix (1 min SQL):** backfill con defaults razonables:
```sql
INSERT INTO dji_fumigation_schedule (parcel_id, crop_type, recommended_cadence_days, is_active)
SELECT id, 'Caña de azúcar', 14, true
FROM dji_parcels
WHERE id NOT IN (SELECT parcel_id FROM dji_fumigation_schedule);
```

**Cuestionable:** el operador fumigador debería confirmar el `crop_type` y `recommended_cadence_days` reales. Si no están, default a "Caña 14d" + flag `needs_review=true` en el export.

### 4.3 🟡 GAP MENOR: 6.018 flights con `pilot_name = "default team"`

**Síntoma:** placeholder de DJI. El operador fumigador real no está identificado para el 69% de los vuelos.

**Opciones:**
- **(A)** Filtrar del export (`WHERE pilot_name != 'default team'`). 2.741 flights quedan. Más limpios para análisis.
- **(B)** Exportarlos con un flag `is_default_team = true`. Preserva la data, le da al consumidor la opción.
- **(C)** Intentar derivar de `flyer_name` o de `notes` (jsonb). No es trivial porque `notes` es raw DJI.

**Recomendación:** opción (B) — agregar columna `is_default_team` derivada. Costo: 1 línea SQL CASE en el serializer. Cero data loss.

### 4.4 🟢 INFO: 32 fumigaciones sin `flight_ids`

**Síntoma:** 642 fumigaciones totales, 610 con `flight_ids` poblado (95%). Las 32 sin son: 2 manuales (`source='manual'`) + 30 del import pre-G2 (backfill incompleto).

**Fix:** correr `lib/backfill/refresh-fumigations.ts` para re-poblar las 30 fumigaciones del import que quedaron sin flight_ids.

**No bloquea el export** — estas fumigaciones aparecen con `fumigations_count = 0` en el join con flights, lo cual es honesto.

---

## 5. Diseño propuesto del export CSV

### Endpoint

```
GET /api/admin/reports/flights/export.csv
  ?from=2026-01-01
  &to=2026-07-31
  &drone_id=  (filtro opcional por drone_model_code)
  &pilot=     (filtro opcional por pilot_name, soporta substring)
  &parcel_id= (filtro opcional)
  &include_orphans=true|false  (default true — incluye flights sin parcel)
  &include_default_team=true|false  (default true)
```

**Auth:** admin-only (mismo middleware que `app/api/admin/fumigations/route.ts`).

**Response:**
- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="aeroadmin-flights-{from}-{to}.csv"`
- Body: 1 línea de header + N líneas (8759 max sin filtros, ~1MB CSV estimado)

**Streaming:** usar `NextResponse` con `ReadableStream` para no cargar 8.7k rows en memoria. Alternativa: si <50k rows, `new Response(csvString)` está OK (es <5MB).

### Shape del CSV (columnas, en orden)

```csv
Sección,Header
Columna,Valor
Operador,AFM Topografía
Generado,2026-08-30T13:49:45.358Z
Ventana desde,2026-01-01
Ventana hasta,2026-07-31
Filtro drone,Todos
Filtro piloto,Todos
Total flights,8759
Con parcel,6039
Sin parcel (orphan),2720
Default team flights,6018

Sección,Vuelos
flight_id,parcel_id,parcel_name,parcel_external_id,client_name,farm_name,municipality,start_at,end_at,duration_seconds,duration_min,duration_human,area_m2,area_ha,spray_usage_ml,spray_usage_l,drone_serial,drone_nickname,drone_model,drone_model_code,drone_registration,pilot_name,is_default_team,district,location,lng,lat,mode,manual_mode,work_speed_m_s,spray_width_m,radar_height_m,fumigations_count,fumigations_total_area_ha,fumigations_total_volume_l,source,captured_at,notes_summary
669687291,,,—,Pradera,,,-76.2686,3.4696,2026-07-27T15:45:06Z,2026-07-27T15:45:52Z,45,0,75,0,45,00:00:45,673.00,0,67,2584,2,58,AFM T50-1,T50,201,,breiner pelaez,false,Pradera,"Pradera, Valle del Cauca, Colombia",-76.2686002,3.4696465,spray,false,,,,,,1,673.00,2,58,djiag,2026-08-30T13:49:45.358Z,""
...
```

**42 columnas.** Decisión de "ancho vs profundo": preferí ancho (1 fila por flight) sobre profundo (varias tablas) porque la herramienta objetivo es **Excel / Google Sheets / análisis cruzado** — siempre wide es más fácil de pivotar.

**Notas por columna:**
- `parcel_id` y 4 columnas siguientes pueden ser NULL si `include_orphans=true` (default).
- `duration_human` = `HH:MM:SS` (formato Excel-friendly).
- `mode` decodifica `mode_name` (0=manual, 4=spray, etc.) — agregar tabla de mapping en `lib/djiag-mode-enum.ts` si no existe.
- `fumigations_count` cuenta cuántas `dji_fumigations` tienen este flight en su `flight_ids[]` (típicamente 0 o 1).
- `fumigations_total_area_ha` y `fumigations_total_volume_l` son SUM del área/volumen de las fumigaciones referenciadas.
- `drone_registration` viene del JOIN con `dji_drone_models.registration_number` (matrícula Aerocivil).
- `notes_summary` = primeros 200 chars de `notes` (jsonb raw DJI) — opcional, muchas filas la dejarían vacía.

### SQL propuesto (para el `api/reports/flights-export.ts`)

```sql
SELECT
  f.flight_id,
  f.parcel_id,
  p.land_name           AS parcel_name,
  p.external_id         AS parcel_external_id,
  p.client_name,
  p.farm_name,
  p.municipality,
  p.drone_model_code    AS parcel_drone_code,
  f.start_at,
  f.end_at,
  f.duration_seconds,
  f.area_m2,
  f.spray_usage_ml,
  f.drone_serial,
  f.drone_nickname,
  dm.name               AS drone_model_name,
  dm.registration_number AS drone_registration,
  f.pilot_name,
  (f.pilot_name = 'default team') AS is_default_team,
  f.district,
  f.location,
  f.lng, f.lat,
  f.mode_name,
  f.manual_mode,
  f.work_speed_m_s,
  f.spray_width_m,
  f.radar_height_m,
  f.source,
  f.captured_at,
  (SELECT COUNT(*) FROM dji_fumigations f2
   WHERE f2.flight_ids @> ARRAY[f.id]) AS fumigations_count,
  (SELECT COALESCE(SUM(f2.area_fumigated_m2), 0) FROM dji_fumigations f2
   WHERE f2.flight_ids @> ARRAY[f.id]) AS fum_total_area_m2,
  (SELECT COALESCE(SUM(f2.area_fumigated_m2 * f2.dose_l_per_ha), 0)
   FROM dji_fumigations f2
   WHERE f2.flight_ids @> ARRAY[f.id]) AS fum_total_volume_l,
  f.notes
FROM dji_flights f
LEFT JOIN dji_parcels p ON p.id = f.parcel_id
LEFT JOIN dji_drone_models dm ON dm.code = p.drone_model_code
WHERE f.start_at >= $1 AND f.start_at < $2
  -- + filtros opcionales (drone, pilot, parcel, orphans, default_team)
ORDER BY f.start_at DESC
LIMIT 50000;  -- cap razonable para no reventar memoria
```

**Performance:** con índices `(start_at desc)` + `(parcel_id)` + GIN `(flight_ids)`, esta query con 8.7k filas debería correr en <500ms en Supabase. Los 3 sub-selects correlated son N+1 — para mejorar, usar `LEFT JOIN LATERAL` o pre-agregar en una CTE.

**Alternativa CTE (más performante si crece a >50k rows):**
```sql
WITH fum_agg AS (
  SELECT
    unnest(flight_ids) AS flight_id,
    SUM(area_fumigated_m2) AS fum_area_m2,
    SUM(area_fumigated_m2 * dose_l_per_ha) AS fum_vol_l,
    COUNT(*) AS n_fum
  FROM dji_fumigations
  WHERE flight_ids IS NOT NULL
  GROUP BY unnest(flight_ids)
)
SELECT f.*, fa.n_fum, fa.fum_area_m2, fa.fum_vol_l
FROM dji_flights f
LEFT JOIN dji_parcels p ON p.id = f.parcel_id
LEFT JOIN dji_drone_models dm ON dm.code = p.drone_model_code
LEFT JOIN fum_agg fa ON fa.flight_id = f.id
WHERE f.start_at >= $1 AND f.start_at < $2
ORDER BY f.start_at DESC;
```

---

## 6. Plan de implementación (½ día)

### Estructura de archivos

```
lib/reports/flights-csv.ts                    # NEW — serializer (200-300 líneas)
lib/reports/fetch-flights-report-data.ts      # NEW — query con filtros (80-100 líneas)
app/api/admin/reports/flights/export.csv/route.ts  # NEW — endpoint (50-70 líneas)
tests/lib-reports-flights-csv.test.ts        # NEW — unit tests (5-8 casos)
tests/api-admin-flights-report-csv.test.ts   # NEW — integration test
```

### Prerrequisitos (en orden, 5 min total)

1. ✅ `node scripts/spatial-join-flights-parcels.js --tolerance 50` — poblar `parcel_id` (cierra §4.1)
2. ✅ Backfill 24 schedules (§4.2) — script SQL inline o `INSERT ... SELECT` desde la consola
3. ⏸️ Re-backfill fumigaciones sin `flight_ids` (§4.4) — opcional, no bloquea el export

### Orden de implementación

1. Crear `fetch-flights-report-data.ts` con la query + tipos
2. Crear `flights-csv.ts` con `buildFlightsReportCsv(data)` siguiendo el patrón de `farms-csv.ts`
3. Crear `route.ts` con auth + streaming response + Content-Disposition
4. Tests unitarios del serializer (3-4 casos: empty, full, con filtros, con orphan)
5. Test de integración del endpoint (login + GET + assert headers + assert CSV content)
6. Smoke test manual con `curl` + abrir el CSV en Excel/Google Sheets para validar tildes/ñ

### Riesgos a tener en cuenta

- **Memory:** 8.7k filas × 42 columnas × ~50 bytes/celda ≈ 18MB CSV. OK. Si crece a 100k flights (~2-3 años), evaluar streaming.
- **Tildes/ñ:** el BOM + UTF-8 ya está probado en los 3 exports existentes. Reusar el mismo patrón.
- **Excel y comas decimales:** ya probado con `Intl.NumberFormat("de-DE")`. Reusar.
- **Campos JSONB:** `notes` lo aplano a `notes_summary` (string truncado). El JSON completo va en `/api/admin/flights/{id}` si alguien lo quiere.
- **Permisos:** `requireRole(["admin"])` (no viewer) — son datos operacionales sensibles (drone serial, pilot license, ICA).

---

## 7. Decisiones a confirmar antes de implementar

1. **¿Wide (1 fila = 1 vuelo, 42 columnas) o Long (varias tablas)?** → Mi recomendación: **Wide**. Mejor para Excel/Sheets.
2. **¿Incluir flights sin parcel_id en el default?** → Mi recomendación: **Sí**, pero con flag `is_orphan=true` para que el analista pueda filtrar.
3. **¿Incluir "default team" flights?** → Mi recomendación: **Sí**, con flag `is_default_team`. Si el operador quiere, los filtra en Excel.
4. **¿Cap de filas?** → Mi recomendación: **50.000 cap** (≈ 7x crecimiento), con `Content-Range` headers si lo alcanzamos.
5. **¿Auth?** → Mi recomendación: **admin only** (no viewer). Contiene datos sensibles.
6. **¿Streaming o buffer?** → Mi recomendación: **buffer** (es < 5MB incluso a 100k filas). Streaming solo si crece a >500k.

Si estás de acuerdo, lo implemento en este orden:
- [ ] 5 min: spatial-join + schedules backfill (prerrequisitos)
- [ ] 30 min: `fetch-flights-report-data.ts` + `flights-csv.ts`
- [ ] 15 min: `route.ts` + tests
- [ ] 10 min: smoke test con curl + verificación visual del CSV
- [ ] 5 min: commit + (sin push hasta que vos digas)

Total: ~65 min de trabajo + tu review.
