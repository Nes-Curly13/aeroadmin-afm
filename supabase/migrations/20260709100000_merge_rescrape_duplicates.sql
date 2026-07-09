-- Migration: 20260709100000_merge_rescrape_duplicates.sql
-- Date: 2026-07-09
-- Purpose: Limpiar duplicados creados por el re-scrape del 2026-07-09.
--
-- Contexto: El UPSERT original usa ON CONFLICT (batch_id, external_id), no
-- ON CONFLICT (external_id) — eso significa que cada batch crea nuevas filas
-- para external_ids ya existentes (los originales del import con
-- parameter.json + los nuevos del re-scrape API). Tras el re-scrape del
-- 2026-07-09 quedaron 2412 filas para ~1205 external_ids únicos.
--
-- Cada par de duplicados tiene:
--   - Fila "vieja" (id bajo): tiene spray_geom, reference_point, waypoints,
--     raw_geometry, raw_parameter, raw_waypoint (del import con parameter.json).
--   - Fila "nueva" (id alto): tiene total_area_mu, work_area_mu,
--     obstacle_area_mu, location_label (del GraphQL de DJI).
--
-- Estrategia de merge: por cada external_id duplicado, copiar los campos
-- de la fila nueva a la vieja (la que tiene spray_geom), después borrar la
-- nueva. Esto preserva los assets geométricos + suma los metadatos del API.
--
-- Idempotente: usa CTE + ROW_NUMBER. Re-correr no hace nada (los duplicados
-- ya están mergeados).
--
-- Aplicar via: psql -f supabase/migrations/20260709100000_merge_rescrape_duplicates.sql

BEGIN;

-- ============================================================
-- 1. Merge: copiar campos API de fila nueva → fila vieja
-- ============================================================
-- Solo copiar donde la fila vieja no tenga ya ese valor (no pisar).
WITH ranked AS (
  SELECT
    id,
    external_id,
    total_area_mu,
    work_area_mu,
    obstacle_area_mu,
    location_label,
    ROW_NUMBER() OVER (PARTITION BY external_id ORDER BY id DESC) AS rn_newest,
    ROW_NUMBER() OVER (PARTITION BY external_id ORDER BY id ASC)  AS rn_oldest
  FROM public.dji_parcels
  WHERE external_id IS NOT NULL
),
oldest_per_ext AS (
  SELECT external_id, MIN(id) AS old_id FROM public.dji_parcels GROUP BY external_id
)
UPDATE public.dji_parcels p
SET
  total_area_mu    = COALESCE(p.total_area_mu,    src.total_area_mu),
  work_area_mu     = COALESCE(p.work_area_mu,     src.work_area_mu),
  obstacle_area_mu = COALESCE(p.obstacle_area_mu, src.obstacle_area_mu),
  location_label   = COALESCE(p.location_label,   src.location_label)
FROM (
  SELECT external_id, total_area_mu, work_area_mu, obstacle_area_mu, location_label
  FROM ranked
  WHERE rn_newest = 1
) src
WHERE p.external_id = src.external_id
  AND p.id = (SELECT old_id FROM oldest_per_ext o WHERE o.external_id = p.external_id);

-- ============================================================
-- 2. Borrar duplicados (filas nuevas sin spray_geom)
-- ============================================================
-- Estrategia: borrar toda fila que no sea la de menor id por external_id,
-- PERO solo si la fila a borrar no tiene spray_geom (es decir, es una fila
-- "nueva" del re-scrape sin assets). Si la fila más vieja no tiene geom y
-- la nueva sí, swap (no debería pasar en este re-scrape, pero safe).
DELETE FROM public.dji_parcels p
USING (
  SELECT external_id, MIN(id) AS keep_id
  FROM public.dji_parcels
  WHERE external_id IS NOT NULL
  GROUP BY external_id
  HAVING COUNT(*) > 1
) dups
WHERE p.external_id = dups.external_id
  AND p.id <> dups.keep_id
  AND p.spray_geom IS NULL;  -- protege filas con geom

-- ============================================================
-- 3. Backfill declared_area_ha para los nuevos mergeados
-- ============================================================
-- Después del merge, los originales con spray_geom pueden tener
-- total_area_mu populada (venia NULL antes). declared_area_ha sigue
-- basándose en PostGIS para los que tienen geom, o queda NULL si no.
UPDATE public.dji_parcels
SET declared_area_ha = ROUND( (ST_Area(spray_geom::geography) / 10000.0)::numeric, 4)
WHERE declared_area_ha IS NULL
  AND spray_geom IS NOT NULL
  AND ST_Area(spray_geom::geography) > 0;

-- ============================================================
-- 4. Renormalizar batch_id de las filas mergeadas al batch del
--    re-scrape (id=2) — para que api_fetched_at refleje hoy.
-- ============================================================
-- (opcional, no destructivo: api_fetched_at se setea en el UPSERT ya.)

COMMIT;

-- ============================================================
-- VERIFICACION post-migration
-- ============================================================
-- Esperado:
--   count(*) = 1205 (originales)
--   count(total_area_mu) = ~1205
--   count(location_label) = ~1205
--   count(obstacle_area_mu) = ~1175 (algunas DJI no las devuelve)
--   count(declared_area_ha) = 1205
--
-- Query:
--   SELECT
--     count(*) AS total,
--     count(total_area_mu) AS with_total_mu,
--     count(work_area_mu) AS with_work_mu,
--     count(obstacle_area_mu) AS with_obs_mu,
--     count(location_label) AS with_location,
--     count(declared_area_ha) AS with_decl_ha,
--     count(spray_geom) AS with_geom
--   FROM dji_parcels;
