-- Migration: mv_fumigation_flights_agg — métricas derivadas de los VUELOS por fumigación
-- Date: 2026-09-17
--
-- Decisión de producto (2026-09-17): una "fumigación" = **todos los vuelos
-- de una parcela en un día** (agrupación parcela+día, derivada por
-- `backfill-fumigations-from-flights.js`). Para darle la MÁXIMA data, se
-- enriquece con lo que traen sus vuelos (`dji_flights` = faenas individuales
-- del scraper):
--   - volumen      Σ spray_usage_ml
--   - area         Σ area_m2
--   - duración     Σ duration_seconds
--   - dron         moda del nickname (AFM T50-1, ...)
--   - piloto       moda de pilot_name/team_name
--
-- Se pre-calcula en una MV (se refresca junto a las otras) para no agregar
-- on-the-fly en cada request. El JOIN es por `flight_id = ANY(flight_ids)`
-- (los flight_ids de DJI, NO el id interno de dji_flights).

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_fumigation_flights_agg AS
SELECT
  f.id AS fumigation_id,
  COUNT(*)::int AS flights_count,
  COALESCE(SUM(fl.area_m2), 0)::numeric AS area_m2,
  COALESCE(SUM(fl.spray_usage_ml), 0)::bigint AS spray_ml,
  COALESCE(SUM(fl.duration_seconds), 0)::int AS duration_seconds,
  mode() WITHIN GROUP (ORDER BY fl.drone_nickname) AS drone_nickname,
  mode() WITHIN GROUP (ORDER BY fl.pilot_name) AS pilot_name
FROM dji_fumigations f
JOIN dji_flights fl ON fl.flight_id = ANY(f.flight_ids)
WHERE f.flight_ids IS NOT NULL
  AND fl.point IS NOT NULL
GROUP BY f.id;

COMMENT ON MATERIALIZED VIEW mv_fumigation_flights_agg IS
  'Metricas derivadas de los vuelos (faenas) por fumigacion: volumen (mL), area (m2), duracion (s), dron y piloto. Enriquecen la fumigacion = parcela+dia.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_fumigation_flights_agg_id
  ON mv_fumigation_flights_agg (fumigation_id);
