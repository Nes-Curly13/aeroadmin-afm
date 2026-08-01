-- Migration: Add geographic point index to dji_flights
-- Date: 2026-06-28
-- Phase: Quick Win QW5 — acelerar spatial joins contra dji_parcels
--
-- Por qué una columna geometry(Point) explícita en vez de usar lng/lat directo:
--   - PostGIS GIST index requiere un tipo geometry/geography; no se puede indexar
--     directamente sobre columnas numeric. Sin el índice, ST_DWithin contra
--     dji_flights se vuelve seq scan cuando la tabla crece.
--   - Hoy 7050 filas está OK sin índice. A 100k+ empieza a doler.
--   - El backfill con ST_MakePoint(lng, lat) en SRID 4326 es instantáneo para
--     <1M filas; un cron o el importador puede mantenerlo al día.
--
-- Por qué no usamos geography(Point) sino geometry(Point, 4326):
--   - ST_DWithin con geometry ya respeta el SRS (4326 = grados). El cálculo
--     de tolerancia se hace con ST_DWithin(..., false) — grados, no metros —
--     lo cual es el patrón actual del spatial-join script. Mantenemos consistencia.
--   - geography(4326) sería más correcto para "metros reales sobre el elipsoide"
--     pero rompe el contrato actual del spatial join (que ya asume geometry).
--     Cambio a geography se hace cuando se reescriba el spatial join a ST_DWithin
--     geodésico (issue aparte, fuera del scope QW5).
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_dji_flights_point;
--   ALTER TABLE dji_flights DROP COLUMN IF EXISTS point;

-- ============================================================
-- 1) Agregar columna point
-- ============================================================
ALTER TABLE dji_flights
  ADD COLUMN IF NOT EXISTS point geometry(Point, 4326);

-- ============================================================
-- 2) Backfill desde lng/lat (solo filas con coordenadas válidas)
-- ============================================================
UPDATE dji_flights
  SET point = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
WHERE
  lng IS NOT NULL
  AND lat IS NOT NULL
  AND lng BETWEEN -180 AND 180
  AND lat BETWEEN -90 AND 90
  AND point IS NULL;

-- ============================================================
-- 3) GIST index para acelerar ST_DWithin en spatial joins
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_dji_flights_point
  ON dji_flights USING GIST (point);

-- ============================================================
-- 4) Stats — para que el planner use el índice desde la primera query
-- ============================================================
ANALYZE dji_flights;

COMMENT ON COLUMN dji_flights.point IS
  'Centroide del vuelo en WGS84 (lng/lat). Backfill automático desde lng+lat. Usar con ST_DWithin para spatial joins contra dji_parcels.spray_geom. Mantenido por scripts/spatial-join-flights-parcels.js y upsert-flights-from-djiag.js en futuras versiones.';