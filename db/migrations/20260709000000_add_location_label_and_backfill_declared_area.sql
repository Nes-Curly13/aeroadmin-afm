-- Migration: 20260709000000_add_location_label_and_backfill_declared_area.sql
-- Date: 2026-07-09
-- Purpose: Cerrar gaps del audit Figma-vs-BD (docs/audit/figma-vs-bd.md).
--   1. Agregar `location_label text` a `dji_parcels` para guardar `address`
--      que el UI de DJI muestra ("Amaime, Palmira, Sur, Valle del Cauca, Colombia").
--   2. Backfill `declared_area_ha` desde PostGIS para los 1205/1205 rows
--      donde está NULL. La API de DJI trae `totalArea(unit:MU)` en su query
--      de lands, pero el UPSERT inicial no lo guardó (ver lib/djiag-lands-to-parcels.js).
--      Como alternativa pragmática, calculamos desde `spray_geom` con
--      `ST_Area(geography)`. Esto difiere del valor DJI en ~5-15%
--      (DJI hace sus propios cálculos con sus propias geometrías).
--      Cuando se haga re-scrape y obtengamos `totalArea`, podemos preferir
--      ese valor con un UPDATE.
--
-- Aplicar via: npm run db:migrate
-- Idempotente: usa IF NOT EXISTS y UPDATE ... WHERE null para re-runs.

BEGIN;

-- ============================================================
-- 1. dji_parcels.location_label
-- ============================================================
-- Texto libre que devuelve el subcampo `address` del query `lands` de
-- DJI AG. Ejemplo: "Amaime, Palmira, Sur, Valle del Cauca, Colombia".
-- Queda NULL hasta que se haga un re-scrape que popule este campo
-- (ver lib/djiag-lands-to-parcels.js y el comentario del gap #2 en
-- docs/audit/figma-vs-bd.md).
ALTER TABLE public.dji_parcels
  ADD COLUMN IF NOT EXISTS location_label text;

COMMENT ON COLUMN public.dji_parcels.location_label IS
  'Texto de ubicación devuelto por DJI AG lands.address (ej: "Amaime, Palmira, Sur, Valle del Cauca, Colombia"). NULL hasta re-scrape.';

-- ============================================================
-- 2. Backfill declared_area_ha desde spray_geom
-- ============================================================
-- PostGIS calcula el área del polígono proyectado en WGS84 (geography)
-- y lo devuelve en m². Dividimos por 10000 para ha.
-- Solo actualizamos donde declared_area_ha IS NULL (idempotente).
UPDATE public.dji_parcels
SET declared_area_ha = ROUND( (ST_Area(spray_geom::geography) / 10000.0)::numeric, 4)
WHERE declared_area_ha IS NULL
  AND spray_geom IS NOT NULL
  AND ST_Area(spray_geom::geography) > 0;

COMMIT;

-- ============================================================
-- VERIFICACION post-migration
-- ============================================================
-- Esperado:
--   count(*) WHERE declared_area_ha IS NOT NULL → 1205
--   count(*) WHERE location_label IS NOT NULL → 0 (pendiente re-scrape)
--   count(*) WHERE spray_geom IS NOT NULL → 1205
--
-- Query de verificación:
--   SELECT
--     count(*) AS total,
--     count(declared_area_ha) AS with_decl_ha,
--     count(location_label) AS with_location,
--     round(avg(declared_area_ha)::numeric, 4) AS avg_decl_ha,
--     round(min(declared_area_ha)::numeric, 4) AS min_decl_ha,
--     round(max(declared_area_ha)::numeric, 4) AS max_decl_ha
--   FROM dji_parcels;
