-- Migration: S10.5 — rename + unify partial index on dji_fumigaciones.product_id
-- Date: 2026-09-02
-- Sprint: S10.5 / Issue #32 (/reportes slow query with product filter)
--
-- Por qué esta migration:
--   La FK `dji_fumigations.product_id` se agregó en S8 (Bloque E — catálogo
--   curado de productos) en `20260829000000_add_products_catalog.sql`.
--   Esa migration YA creó un índice parcial:
--
--     CREATE INDEX IF NOT EXISTS idx_fumigations_product_id
--       ON dji_fumigations (product_id) WHERE product_id IS NOT NULL;
--
--   El nombre `idx_fumigations_product_id` no sigue la convención del
--   proyecto (otros índices de `dji_fumigations` usan el prefijo
--   `idx_dji_fumigaciones_`: `idx_dji_fumigations_parcel_date`,
--   `idx_dji_fumigations_date`, `idx_dji_fumigations_parcels_gin`).
--   Esta migration lo renombra y unifica la convención. La definición
--   (columna + predicado parcial) es idéntica, así que el query plan
--   del planificador de Postgres no cambia — solo el OID del índice.
--
-- Por qué no usamos `CREATE INDEX CONCURRENTLY`:
--   El runner `scripts/apply-pending-migrations.js` envuelve cada
--   migration en un BEGIN/COMMIT (ver `applyMigration`, líneas 61-66).
--   `CREATE INDEX CONCURRENTLY` rechaza correr dentro de un bloque de
--   transacción ("ERROR: CREATE INDEX CONCURRENTLY cannot run inside
--   a transaction block"). En S8 se tomó la misma decisión: tabla de
--   ~17k filas → lock de <1s en el CREATE INDEX plano es aceptable,
--   y el runner del proyecto se mantiene simple. Si en el futuro la
--   tabla crece al punto de necesitar CONCURRENTLY, este índice ya
--   estará marcado como "valid" en `pg_index` y se puede recrear
--   manualmente con CONCURRENTLY fuera del runner.
--
-- Por qué predicado parcial (`WHERE product_id IS NOT NULL`):
--   La mayoría de las fumigaciones históricas (~17k filas) no tienen
--   producto del catálogo asignado (la columna es NULLABLE; la columna
--   libre `product_used` TEXT sigue siendo el legacy). El predicado
--   `product_id IS NOT NULL` reduce el tamaño del índice a las filas
--   que efectivamente pueden matchear un `WHERE product_id = $1` en
--   /reportes. Sin el predicado, el índice indexaría también las
--   ~17k filas NULL sin beneficio.

BEGIN;

-- 1. Renombrar el índice viejo al nombre convencional del proyecto.
--    Si por alguna razón la migration de S8 no se aplicó y el índice
--    no existe, el RENAME falla con "ERROR: index ... does not exist"
--    — eso es deseable: queremos detectar el drift, no silenciarlo.
ALTER INDEX IF EXISTS idx_fumigations_product_id
  RENAME TO idx_dji_fumigaciones_product_id;

COMMIT;

COMMENT ON INDEX idx_dji_fumigaciones_product_id IS
  'Sprint S10.5 — partial index en dji_fumigaciones.product_id para queries de /reportes con filtro por producto. Renombrado desde idx_fumigations_product_id (creado originalmente en S8 / Bloque E, 2026-08-29) para unificar la convención de nombres del proyecto. Predicado parcial WHERE product_id IS NOT NULL porque la mayoría de fumigaciones históricas no tienen producto del catálogo asignado.';
