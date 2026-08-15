# Backfill fumigaciones aggregate → `parcel_id`

> **Fecha**: 2026-08-15
> **Sprint**: feature/backfill-fumigation-parcel
> **Owner**: @agFab
> **Severidad**: media (afecta los reportes por parcela, dashboard cadencia, geovisor)

## Hallazgo

El aggregate de DJI que se inserta vía `lib/djiag-fumigations-fetcher.js` +
`scripts/upsert-fumigations-from-djiag.js` siempre queda con
`parcel_id = NULL` porque el endpoint GraphQL de DJI es **agregado por
día** para toda la cuenta — no sabe a qué parcela corresponde cada
fumigación (ver `lib/djiag-fumigations-fetcher.js:130-131`).

**Síntomas**:
- `dji_fumigations.parcel_id IS NULL` para todas las fumigaciones
  con `source = 'djiscraper'` (o `'import'` en el dataset legacy).
- Las fumigaciones SÍ tienen `flight_ids` (array de `dji_flights.id`)
  poblado desde la migration `20260725000000_g2_flight_trace_and_schedule_history.sql`.
- Pero ese array no se usaba para nada — nadie cerraba el JOIN con
  `dji_flights.parcel_id` (poblado por el spatial join).

**Consecuencias downstream** (mientras `parcel_id` esté NULL):
- `getRecentFumigations` (sprint fumigaciones-detail-v2) devuelve
  fumigaciones huérfanas en `/fumigaciones` con parcela "—".
- El `FumigationMap` del detail page no renderiza el pin (no hay parcela).
- Los reportes por hacienda (nivel 2) subcuentan fumigaciones
  huérfanas como data perdida.
- La cadencia por parcela (dashboard) no sabe cuándo se fumigó
  cada parcela.

## Solución

**`scripts/backfill-fumigations-from-flights.js`** (NUEVO, sprint
2026-08-15). Cierra el loop con la moda de los flights asociados:

### Algoritmo

1. Para cada fumigación con `parcel_id IS NULL` y `flight_ids` no vacío:
   - JOIN con `dji_flights` via `flight_id = ANY(f.flight_ids)`.
   - Cuenta flights totales vs flights con `parcel_id` no NULL.
   - Si el **consenso** (`with_parcel / total`) ≥ threshold (default 50%),
     asigna la **moda** de `fl.parcel_id` via `mode() WITHIN GROUP (ORDER BY fl.parcel_id)`.
   - Guarda metadata del backfill en `notes->parcel_backfill`
     (count, ratio, threshold, timestamp, distinct_parcels).

2. UPDATE atómico via CTE.

3. Stats detalladas:
   - `matched` — fumigaciones con UPDATE aplicado.
   - `no_consensus` — flights asociados, pero ratio < threshold.
   - `no_parcel_in_flight` — flights asociados, pero TODOS sin parcela.
   - `no_flights` — fumigaciones con `flight_ids` NULL o vacío.

### Flags CLI

| Flag | Default | Descripción |
|---|---|---|
| `--dry-run` | `false` | Solo cuenta, no UPDATE. Imprime sample (top 20). |
| `--consensus 0.5` | `0.5` | Threshold de consenso (0-1). 0.5 = mayoría simple. |
| `--parcel <id>` | — | Filtrar por parcela específica (debug). |

### Uso

```bash
# 1) Dry-run primero (siempre — ver el match rate antes de UPDATE)
node scripts/backfill-fumigations-from-flights.js --dry-run

# 2) Run real con consenso por defecto (50%)
node scripts/backfill-fumigations-from-flights.js

# 3) Más estricto (70%) si querés menos falsos positivos
node scripts/backfill-fumigations-from-flights.js --consensus 0.7

# 4) Debug por parcela específica
node scripts/backfill-fumigations-from-flights.js --parcel 3107 --dry-run
```

## Prerrequisitos

**CRÍTICO**: los `dji_flights.parcel_id` deben estar poblados antes de
correr el backfill. Si no, la moda va a ser `NULL` y nada se asigna.

Orden correcto:
```bash
# 1) Asignar parcel_id a flights via spatial join
node scripts/spatial-join-flights-parcels.js

# 2) Verificar que la mayoría de flights tienen parcel_id
psql $DATABASE_URL -c "
  SELECT
    COUNT(*) AS total,
    COUNT(parcel_id) AS con_parcel,
    COUNT(*) FILTER (WHERE lng IS NOT NULL AND lat IS NOT NULL) AS georeferenced
  FROM dji_flights
  WHERE deleted_at IS NULL;
"

# 3) Dry-run del backfill
node scripts/backfill-fumigations-from-flights.js --dry-run

# 4) Run real
node scripts/backfill-fumigations-from-flights.js
```

## Integración al pipeline

`scripts/import-fumigations-pipeline.js` ahora corre 3 steps:

```
1/3 — fetch fumigaciones desde DJI
2/3 — upsert a dji_fumigations
3/3 — backfill parcel_id a fumigaciones aggregate   ← NUEVO
```

Skip con `--skip-backfill` si querés solo fetch+upsert.

## Limitaciones

1. **Depende de `dji_flights.parcel_id` poblado.** Si el spatial join
   no corrió o falló por tolerance, el backfill no va a poder asignar
   nada. Validar antes con la query del paso 2 arriba.

2. **Threshold default 50% (mayoría simple).** Si una fumigación
   tiene flights asociados a 3 parcelas distintas (33% cada una),
   el threshold no se cumple y queda sin asignar. Operador puede
   ajustar `--consensus 0.3` para backfill más agresivo, o dejar
   que el operador fumigador lo arregle manualmente.

3. **`flight_ids` puede estar vacío** en fumigaciones importadas con
   versiones viejas del fetcher (pre-20260725). El script las cuenta
   como `no_flights` y no las toca.

4. **No se re-ejecuta automáticamente.** El backfill es one-shot.
   Para fumigaciones NUEVAS del scraper, el `import-fumigations-pipeline.js`
   las crea con `parcel_id=NULL` y el pipeline las backfillea en el
   mismo run. Si querés un cron semanal que re-aplique, agregalo al
   `refresh-fumigations.yml` (con `--consensus 0.5`).

## Decisiones de diseño

- **Moda con `mode()` de Postgres, no código JS.** Postgres lo hace
  en una sola query con `WITHIN GROUP (ORDER BY)`, mucho más eficiente
  que traer todos los flights a Node y contar.
- **Threshold configurable, default 50%.** Si en el futuro vemos
  que el match rate es bajo (<30%), bajamos el default. Documentado
  en el flag.
- **Metadata en `notes` JSONB, no columna nueva.** La tabla ya
  tiene `notes` jsonb (ver schema). Agregar metadata en una sub-key
  `parcel_backfill` no requiere migration y permite auditar el
  backfill sin join adicional.
- **Idempotente.** Re-correr el script es no-op: las fumigaciones
  que ya tienen `parcel_id` se filtran en el WHERE.
- **Conserva el parcel_id existente.** El script solo toca
  fumigaciones con `parcel_id IS NULL`. Si una fumigación aggregate
  ya tiene parcela (por backfill anterior, manual, o importer legacy),
  no se sobreescribe.

## Impacto downstream

Una vez corrido el backfill:
- `/fumigaciones` muestra todas las fumigaciones con su parcela.
- `/fumigacion/[id]` renderiza el pin en el mapa.
- Reportes por hacienda (nivel 2) cuentan correctamente las
  fumigaciones por hacienda.
- Dashboard de cadencia (sprint C — H1) muestra `last_fumigation_date`
  correcto por parcela.
- El detail del parcel (`/parcelas/[id]`) muestra el timeline
  completo de fumigaciones, no solo las manuales.

## Referencias

- `scripts/spatial-join-flights-parcels.js` — paso previo (asignar
  parcel_id a flights).
- `lib/djiag-fumigations-fetcher.js:130-131` — comentario sobre el
  aggregate y por qué parcel_id queda NULL.
- `docs/audit/DOSE_FIELDS_BACKFILL.md` — la otra mitad de la deuda
  (product_used y dose_l_per_ha en fumigaciones DJI aggregate).
- `db/migrations/20260725000000_g2_flight_trace_and_schedule_history.sql`
  — migration que agregó `flight_ids` (la columna que hace posible
  este backfill).
- `docs/ARCHITECTURE.md` § "Pipeline DJI" — flow completo.
