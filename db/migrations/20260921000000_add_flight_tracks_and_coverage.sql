-- Migration: restaurar esquema de TRACKS KML + COBERTURA de fumigaciones
-- Date: 2026-09-21
--
-- Contexto (2026-09-21): el pipeline viejo del scraper DJI bajaba el KML
-- de cada vuelo (`export_kml`) y calculaba la cobertura real de una
-- fumigacion como la UNION DE BUFFERS DE 2 m de sus tracks (LineStrings),
-- no un convex hull de puntos. Esos objetos existian en prod pero se
-- truncaron y este repo no tenia la migration (vivian en otro proyecto).
--
-- La migration es IDEMPOTENTE: en prod los objetos ya existen (no-op); en
-- local/CI los crea. Tipos segun `geometry_columns` de prod:
--   dji_flight_tracks.geom  geometry(LineString,4326)  PK flight_id
--   dji_flights.track       geometry(LineString,4326)
--   dji_fumigations.coverage geometry(MultiPolygon,4326)
--
-- Rollback:
--   DROP TABLE IF EXISTS public.dji_flight_tracks;
--   DROP INDEX IF EXISTS public.dji_flights_track_gix;
--   DROP INDEX IF EXISTS public.dji_fumigations_coverage_gix;
--   ALTER TABLE public.dji_flights DROP COLUMN IF EXISTS track;
--   ALTER TABLE public.dji_fumigations
--     DROP COLUMN IF EXISTS coverage,
--     DROP COLUMN IF EXISTS flight_count,
--     DROP COLUMN IF EXISTS area_m2_total,
--     DROP COLUMN IF EXISTS spray_usage_total;

BEGIN;

-- ============================================================
-- 1) Tracks por vuelo
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dji_flight_tracks (
  flight_id   bigint PRIMARY KEY,
  geom        geometry(LineString, 4326),
  updated_at  timestamptz DEFAULT now()
);

COMMENT ON TABLE public.dji_flight_tracks IS
  'LineString (track KML del vuelo) por flight_id de DJI. Fuente de la cobertura real de cada fumigacion (buffer 2 m + union).';

CREATE INDEX IF NOT EXISTS dji_flight_tracks_geom_gix
  ON public.dji_flight_tracks USING gist (geom);

-- ============================================================
-- 2) Track denormalizado en dji_flights (para joins rapidos)
-- ============================================================
ALTER TABLE public.dji_flights
  ADD COLUMN IF NOT EXISTS track geometry(LineString, 4326);

CREATE INDEX IF NOT EXISTS dji_flights_track_gix
  ON public.dji_flights USING gist (track);

-- ============================================================
-- 3) Cobertura + agregados en dji_fumigations
-- ============================================================
ALTER TABLE public.dji_fumigations
  ADD COLUMN IF NOT EXISTS coverage geometry(MultiPolygon, 4326),
  ADD COLUMN IF NOT EXISTS flight_count integer,
  ADD COLUMN IF NOT EXISTS area_m2_total numeric,
  ADD COLUMN IF NOT EXISTS spray_usage_total numeric;

CREATE INDEX IF NOT EXISTS dji_fumigations_coverage_gix
  ON public.dji_fumigations USING gist (coverage);

COMMENT ON COLUMN public.dji_fumigations.coverage IS
  'Area REAL volada = ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_UnaryUnion(ST_Collect(ST_Buffer(track::geography, 2.0)::geometry))), 3)) de los tracks de sus vuelos. Reemplaza al convex hull de puntos.';

COMMIT;
