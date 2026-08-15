# Deuda técnica: `dose_l_per_ha` y `product_used` en `dji_fumigations`

> **Fecha**: 2026-08-09
> **Sprint**: feature/reports-level-2 (2026-08-08)
> **Severidad**: media (afecta los reportes por hacienda que muestran litros)
> **Owner**: @agFab

## Hallazgo

Cuando se implementó el reporte por hacienda (feature/reports-level-2), el
PDF general mostraba **1,25 L** de volumen total cuando el área fumigada
era **1.283,39 ha**. La causa: **610 de 642 fumigaciones tienen
`dose_l_per_ha = NULL`**.

### Investigación

1. **Formulario manual** (`/api/admin/fumigations` POST) — captura y
   **requiere** `product_used` y `dose_l_per_ha` con validación estricta
   (ver `app/api/admin/fumigations/route.ts:106-122`). Las 2 fumigaciones
   con `source='manual'` (las creadas por el sub-sprint 3 del sprint
   anterior) tienen **100% de los campos completos**.

2. **Scraper DJI aggregate** (`lib/djiag-fumigations-fetcher.js`) — el
   endpoint `flight_aggregation` de DJI **no expone** `product_used` ni
   `drone_code_used` (documentado en líneas 29, 133, 185). Puede inferir
   `dose_l_per_ha` con la fórmula `spray_usage_L / area_ha`, pero solo
   cuando DJI trae ambos datos crudos — que es la minoría.

3. **Scraper DJI flights + backfill** (`scripts/backfill-fumigations-from-flights.js`,
   step 6 del pipeline) — re-agrupa `dji_flights` por `(parcel_id,
   fecha Bogota)` y los inserta con `source='import'`. El endpoint de
   flights tampoco expone `product_used`, y la fórmula de inferencia
   para `dose_l_per_ha` da NULL cuando falta `spray_usage_ml` o
   `area_m2`. **Este es el origen de las 640 fumigaciones con
   `product_used` NULL y la mayoría con `dose_l_per_ha` NULL**.

### Por qué el detail page muestra "2,0 L/ha" igual

El V0 adapter de `lib/data.ts:331` hardcodea `dose_l_ha: 2.0` para todas
las parcelas cuando arma el `ParcelSummary` que consume la página de
detalle. Eso da la sensación al operador de que el dato existe, pero es
un default falso. El PDF del reporte (que lee la BD directamente) muestra
la verdad: la mayoría de las fumigaciones del dataset DJI no tienen
dosis cargada.

### Estado actual de la BD (Supabase, 2026-08-09)

```sql
SELECT source, COUNT(*), COUNT(dose_l_per_ha) AS con_dose, COUNT(product_used) AS con_product
FROM dji_fumigations WHERE deleted_at IS NULL GROUP BY source;

-- source   | total | con_dose | con_product
-- ---------+-------+----------+------------
-- import   | 640   | 30       | 0
-- manual   | 2     | 2        | 2
```

**Conclusión**: 95% del dataset DJI histórico no tiene `product_used` ni
`dose_l_per_ha`. Solo las fumigaciones manuales futuras traerán los
datos completos.

## Decisión de producto (2026-08-09)

**No backfilleamos con un valor inventado**. Las opciones eran:

- ❌ **A (conservador con product_used)**: 0 fumigaciones actualizadas
  (todas las 610 tienen `product_used` null también).
- ❌ **A' (conservador sin filtro)**: 610 fumigaciones con `2.0 L/ha`
  hardcoded (consistente con el V0 default, pero **NO es data real** —
  el operador va a creer que sí).
- ❌ **C (agresivo por producto)**: requiere tabla nueva
  `dji_product_doses` con dosis típicas — trabajo de investigación
  aparte.
- ✅ **B (no backfillear, arreglar captura)**: dejar la deuda hasta
  arreglar el scraper / endpoint. Documentar y seguir.

## Plan de fix (sprint siguiente)

### Opción 1 — Endpoint de detalle de fumigación en DJI

DJI expone `/api/v1/flight/records?page=N&page_size=M` (mencionado en
`lib/djiag-fumigations-fetcher.js:30`) que SÍ tiene detalle por vuelo
individual, incluyendo potencialmente `product_id` y `dosage`. Hay que
investigar el shape del response y ver si trae los datos que faltan.

**Esfuerzo**: 1-2 días (investigar endpoint + agregar al fetcher +
agregar tests + validar con data real).

### Opción 2 — Tabla `dji_product_doses` + heurística de import

Crear tabla:

```sql
CREATE TABLE dji_product_doses (
  product_key TEXT PRIMARY KEY,   -- ej "glifosato_48", "roundup_full"
  display_name TEXT NOT NULL,
  typical_dose_l_per_ha NUMERIC(6,2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Backfillear las fumigaciones históricas con la dosis típica del
producto detectado en `product_used` (que SÍ viene del form manual,
pero NO del scraper DJI). Para fumigaciones sin `product_used`,
backfillear con un default conservador del 2.0 L/ha y marcar el campo
`dose_is_default = true` (necesita nueva columna).

**Esfuerzo**: 2-3 días (tabla nueva + seed de productos + backfill
documentado + tests).

### Opción 3 — Solo datos manuales

Aceptar que el dataset histórico del DJI no tiene el dato. Los
reportes van a mostrar números bajos para fumigaciones DJI históricas,
pero los fumigaciones manuales (futuras) SÍ van a tener data
completa. El operador ve la diferencia clara.

**Esfuerzo**: 0 (solo documentar la decisión).

## Recomendación

**Opción 1 + Opción 3 combinadas**: implementar el endpoint de detalle
del DJI (Opción 1) para fumigaciones futuras, y documentar que las
históricas van a seguir con números bajos hasta que el operador las
cargue manualmente (Opción 3). Si en 2-3 meses vemos que la
cobertura de datos manuales es alta (>50% de fumigaciones), descartar
la Opción 1.

## Impacto downstream

- **Reportes PDF/CSV por hacienda** (nivel 2) — van a mostrar
  "volumen total" bajo para el dataset histórico. El operador va a
  ver claramente que las fumigaciones DJI (sin product) muestran 0 L,
  y las manuales (con product) muestran el cálculo real.
- **Reportes por parcela** (nivel 1) — mismo issue, mismo fix.
- **Cadencia de fumigación** — NO afectada (la cadencia viene del
  schedule, que sí tiene `recommended_cadence_days` y
  `last_fumigation_date`).
- **ICA compliance** — el form manual YA pide `product_registered_ica`
  y `pilot_license`, así que las fumigaciones nuevas (manuales) SÍ
  tienen el dato. Las históricas (DJI) no, pero eso es un issue aparte
  del ICA, no de la dosis.

## Decisión final (este sprint)

**No hacer nada en la BD**. Documentar este finding. Cerrar el feature
sin tocar data. Dejar el plan para el sprint próximo.

---

## Verificación post-investigación (2026-08-09)

Después del hallazgo original, el user pidió "implementar el fix del
scraper DJI". Investigación adicional reveló que el problema es
**estructural del backend de DJI** — no se puede arreglar desde
nuestra app:

- **Endpoint `/flight_records?page=N`** (per-flight list) — verificado
  sobre `djiag_exports/perflight_records.json` (8759 vuelos
  capturados). **NO expone** `product_id`, `dosage`, `product_name`,
  `liquid_name`, `drone_name`, `pilot_name` en ningún vuelo. Solo
  expone `usage_type`, `spray_usage` (mL), `nickname` (drone),
  `team_name` (pilot).
- **Endpoint `/flight_records/{id}`** (per-flight detail) — DJI
  expone más campos acá (ej `hardware_id` para chassis del dron,
  documentado en `docs/DJI_SCRAPER.md:76`). Probablemente también
  expone `product_id` y `dosage`, pero **NO hay captura** y requiere
  auth real con Playwright + credenciales del cliente.
- **No existe tabla `products`** en la BD. `docs/review/BUSINESS.md:432`
  lo lista como aspiracional ("lo que debería ser"). El campo
  `dji_fumigations.product_used` es texto libre, sin FK.

### Decisión revisada (2026-08-09)

**Los nuevos registros hechos desde la app SÍ van a tener data
completa**. No hay que tocar nada:

- **Form manual** (`/parcelas/[id]` → "Registrar fumigación manual",
  `components/parcels/register-fumigation-form.tsx:14-16`) — ambos
  campos son **required**:
  - `product_used` con `required` + `maxLength={200}` + placeholder
    "ej. Glifosato 48%".
  - `dose_l_per_ha` con `required` + `min="0.01"` + `max="1000"` +
    `type="number"`.
- **API POST** (`app/api/admin/fumigations/route.ts:106-122`) —
  validación server-side rechaza con 400 si cualquiera de los dos
  campos falta. Tests en `tests/api-admin-fumigations.test.ts`
  cubren el path de error.
- Las 2 fumigaciones manuales creadas en el sprint anterior (sub-3
  del feature parcel-onboarding) tienen 100% de los datos.

La deuda SOLO afecta a las 640 fumigaciones con `source='import'`
(import batch del dataset DJI histórico). El operador fumigador, a
medida que cargue fumigaciones manuales con todos los datos, va a
mejorar progresivamente la cobertura del reporte. Las fumigaciones
del dataset DJI histórico van a seguir mostrando 0 L hasta que el
operador las recargue manualmente (no vamos a backfillear la BD con
valores inventados).

### Workaround de display (idea descartada)

Consideramos agregar un "warning visual" en el PDF cuando una
fumigación tiene `area_fumigated_m2 > 0` pero `dose_l_per_ha IS NULL`
— para que el operador sepa que esa fila tiene data incompleta. **Lo
descartamos** porque la columna "Volumen" ya muestra "—" cuando la
dosis es null, y el operador entiende la diferencia entre DJI
(automático, sin producto) y manual (con producto completo). Agregar
otro warning sería ruido.

## Referencias

- `app/api/admin/fumigations/route.ts:106-122` — validación del form
  manual (demuestra que SÍ captura los datos)
- `lib/djiag-fumigations-fetcher.js:29-39` — comentario sobre lo que
  DJI expone
- `lib/djiag-fumigations-fetcher.js:185` — el `product_used` y
  `drone_code_used` quedan NULL en este fetcher
- ~~`scripts/backfill-fumigations-from-flights.js` — step 6 del pipeline~~
  → Reemplazado en 2026-08-15 por
  `scripts/backfill-fumigations-from-flights.js` (NUEVO) que asigna
  `parcel_id` (no `product_used`/`dose_l_per_ha`). Ver
  `docs/audit/FUMIGATION_PARCEL_BACKFILL.md`. El nombre del archivo
  se mantuvo por consistencia con la referencia en este doc.
- `lib/data.ts:331` — V0 adapter hardcodea `dose_l_ha: 2.0` (default
  falso, ver issue de arriba)
- `docs/DJIAG_AUDIT.md` — auditoría original del pipeline
- `docs/FUMIGATION_CADENCE.md` — cadencia de fumigación por tipo de
  cultivo
- `docs/audit/FUMIGATION_PARCEL_BACKFILL.md` — la OTRA mitad de la
  deuda (asignar `parcel_id` a fumigaciones aggregate). Sprint
  2026-08-15, feature/backfill-fumigation-parcel.
