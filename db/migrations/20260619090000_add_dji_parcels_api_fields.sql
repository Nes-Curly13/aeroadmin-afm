-- Migration: Add DJI API fields to dji_parcels
-- Date: 2026-06-19
-- Phase: §2.1 lands — populate dji_parcels with metadata from the DJI
--         GraphQL `?name=lands` endpoint (complementa el importer legacy
--         que solo tenía data de parameter.json).
--
-- Por qué columnas separadas y no override de las existentes:
--   - Las columnas de parameter.json (spray_width_m, drone_model_code, etc.)
--     vienen de la descarga de archivos del scraper. Las nuevas columnas
--     vienen de la API. Son datos complementarios, no conflictivos.
--   - El UPSERT en scripts/upsert-lands-from-djiag.js solo escribe las
--     columnas API; las de parameter.json se preservan (ON CONFLICT no
--     las toca).
--   - Si DJI cambia la API y un campo ya no viene, se queda en NULL sin
--     afectar el resto del row.
--
-- Decisiones de tipo:
--   - position: Point — centroide de la finca (lat/lng)
--   - bbox: Polygon (no Box) — PostGIS no tiene Box nativo en geometries,
--     así que guardamos como Polygon rectangular en WGS84. Útil para
--     queries geográficos (ST_Intersects, ST_Contains).
--   - tags: text[] — DJI devuelve un array de strings
--   - precision_m: numeric(6,2) — metros. Suficiente para 0-9999.99 m
--   - *_area_mu: numeric(12,2) — DJI usa MU (1 MU = 1/15 ha ≈ 666.67 m²)
--   - land_type_raw: text — valor crudo de DJI (Farmland, Orchards, etc.)
--     antes de normalizar a is_orchard boolean
--   - source_url_*: reutilizamos las columnas existentes del schema
--     original (que ya tenían los URLs del scraper). Si el scraper dejó
--     URLs y la API trae otras, conservamos las del scraper (COALESCE
--     en el UPSERT).
--
-- Rollback: ALTER TABLE dji_parcels DROP COLUMN ...;

-- ============================================================
-- Nuevas columnas API
-- ============================================================
ALTER TABLE dji_parcels
  ADD COLUMN IF NOT EXISTS dji_land_uuid      text,
  ADD COLUMN IF NOT EXISTS position           geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS bbox               geometry(Polygon, 4326),
  ADD COLUMN IF NOT EXISTS tags               text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS precision_m        numeric(6, 2),
  ADD COLUMN IF NOT EXISTS precision_type     text,
  ADD COLUMN IF NOT EXISTS serial_number      text,
  ADD COLUMN IF NOT EXISTS total_area_mu      numeric(12, 2),
  ADD COLUMN IF NOT EXISTS work_area_mu       numeric(12, 2),
  ADD COLUMN IF NOT EXISTS obstacle_area_mu   numeric(12, 2),
  ADD COLUMN IF NOT EXISTS land_type_raw      text,
  ADD COLUMN IF NOT EXISTS api_fetched_at     timestamptz;

-- ============================================================
-- Índices geográficos
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_dji_parcels_position ON dji_parcels USING GIST (position);
CREATE INDEX IF NOT EXISTS idx_dji_parcels_bbox     ON dji_parcels USING GIST (bbox);

-- ============================================================
-- Índice de búsqueda por uuid DJI (para JOINs/debug)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_dji_parcels_dji_land_uuid ON dji_parcels (dji_land_uuid)
  WHERE dji_land_uuid IS NOT NULL;
