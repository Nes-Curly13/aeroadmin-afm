-- Migration: Add `parcels text[]` to `dji_fumigations` for multi-parcela plans
--
-- Sprint: S9 — feature/multi-parcela-fumigation
-- Date: 2026-08-30
--
-- Por qué existe:
--   Hoy el modelo asume "1 fumigación = 1 parcela + N flights del drone".
--   La realidad operativa es distinta: 1 plan de fumigación = 1 sesión
--   de trabajo (1 día, 1 piloto, 1 drone) que cubre N suertes con M
--   pasadas por suerte. Ver `docs/reviews/flights-csv-export-review.md`
--   sección §4 (gaps) para el análisis.
--
--   Evidencia empírica (snapshot 2026-08-30):
--     - 642 fumigaciones tienen 1-66 flights cada una
--     - Fumigaciones con 50+ flights tienen dispersión geográfica
--       >1 km → multi-parcela confirmado
--     - 1 fumigación = 1 "work session", no 1 parcela
--
-- Decisión de diseño:
--   - `parcel_id` se mantiene como la "parcela primaria" (la que la
--     fumigación referencia en queries existentes — backward compat).
--   - `parcels text[]` (NO usar bigint[] para mantener nombres externos
--     y evitar el JOIN obligatorio al leer — más simple para el CSV
--     export y para mostrar en UI).
--   - `parcels` contiene SOLO las suertes SECUNDARIAS (excluye la
--     primaria que ya está en `parcel_id`). Default = array vacío.
--   - Si en el futuro se necesita, se puede agregar FK vía tabla
--     junction (Opción B del review).
--
-- Backfill:
--   El script `scripts/backfill-fumigation-parcels.js` popula esta
--   columna a partir de los `flight_ids[]` de cada fumigación. Para
--   cada fumigación:
--     1. JOIN flight_ids[] con dji_flights por flight_id (DJI external)
--     2. JOIN dji_flights.parcel_id con dji_parcels
--     3. GROUP BY parcel, excluir el parcel_id primario, COUNT
--     4. UPDATE parcels = array de parcel external_ids secundarios
--
-- Decisión sobre bug pre-existente (no resuelto en esta migration):
--   El array `flight_ids[]` contiene `dji_flights.flight_id` (bigint,
--   DJI external ID), NO `dji_flights.id` (bigint, internal PK).
--   El comment del G2 (Sprint 2026-07-25) dice "array de dji_flights.id"
--   pero está mal — el backfill original usó el external ID. El JOIN
--   correcto es `fl.flight_id = u.dji_fid`. NO se corrige acá porque
--   tocar el contenido del array es un cambio destructivo (habría que
--   traducir external → internal, pero los internal IDs cambiaron entre
--   imports). Mejor documentar el bug y trabajar con external IDs.
--   El query correcto se usa en el script de backfill.
--
-- Índices:
--   GIN sobre `parcels` para queries tipo "qué fumigaciones tocaron
--   la suerte X" (parcel_id OR parcels @> ARRAY[X]).

BEGIN;

-- 1. Agregar la columna
ALTER TABLE dji_fumigations
  ADD COLUMN IF NOT EXISTS parcels text[];

COMMENT ON COLUMN dji_fumigations.parcels IS
  'Sprint S9 — lista de external_id de suertes SECUNDARIAS cubiertas por esta fumigación, excluyendo la primaria (parcel_id). Se popula vía backfill desde flight_ids[] usando spatial-join de los flights.';

-- 2. Default explícito para fumigaciones existentes (sin backfill aún)
UPDATE dji_fumigations
SET parcels = '{}'
WHERE parcels IS NULL;

-- 3. Constraint: parcels nunca contiene el parcel_id primario
-- (helper para evitar data corrupta en updates manuales)
-- No lo hacemos CHECK constraint porque parcel_id puede ser NULL
-- (fumigaciones manuales sin parcela asignada).

-- 4. Índice GIN para queries por "qué fumigaciones tocaron la suerte X"
CREATE INDEX IF NOT EXISTS idx_dji_fumigations_parcels_gin
  ON dji_fumigations USING GIN (parcels)
  WHERE parcels IS NOT NULL AND array_length(parcels, 1) > 0;

-- 5. Helper function: agregar una suerte secundaria (idempotente)
CREATE OR REPLACE FUNCTION add_fumigation_secondary_parcel(
  p_fumigation_id bigint,
  p_parcel_external_id text
) RETURNS void AS $$
BEGIN
  UPDATE dji_fumigations
  SET parcels = ARRAY(
    SELECT DISTINCT unnest(parcels || ARRAY[p_parcel_external_id])
  )
  WHERE id = p_fumigation_id
    AND p_parcel_external_id IS NOT NULL
    AND p_parcel_external_id != COALESCE(
      (SELECT external_id FROM dji_parcels WHERE id = dji_fumigations.parcel_id),
      ''
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION add_fumigation_secondary_parcel IS
  'Sprint S9 — agrega una suerte secundaria al array parcels de una fumigación. Skip si ya está o si es la suerte primaria. Para uso del import y scripts de backfill.';

COMMIT;
