-- Migration: mv_fumigation_hulls — polígono (convex hull) de los vuelos por fumigación
-- Date: 2026-09-16
--
-- Decisión de producto (2026-09-16): el geovisor mostraba las fumigaciones
-- como PUNTOS (`events-circle`). El operador pidió verlas como POLÍGONO
-- (el área realmente volada) junto con las parcelas, y quitar los puntos
-- (la metadata sigue disponible en el popup).
--
-- El polígono sale de los flight points (`dji_flights.point`) agrupados por
-- fumigación (`dji_fumigations.flight_ids` contiene los `flight_id` de DJI,
-- NO el `id` interno):
--   - >=3 vuelos  → ST_ConvexHull (polígono real del área volada).
--   - 1-2 vuelos  → ST_Buffer del centroide (~80 m) para no degenerar.
--
-- Se pre-calcula en una MV (no on-the-fly) por performance. Se refresca
-- junto con las otras MVs en `scripts/refresh-fumigations.js`.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_fumigation_hulls AS
SELECT
  f.id AS fumigation_id,
  CASE
    WHEN COUNT(*) >= 3
      THEN ST_ConvexHull(ST_Collect(fl.point))
    ELSE ST_Buffer(ST_Centroid(ST_Collect(fl.point)), 0.0008)
  END AS geom,
  COUNT(*)::int AS flight_count
FROM dji_fumigations f
JOIN dji_flights fl ON fl.flight_id = ANY(f.flight_ids)
WHERE f.flight_ids IS NOT NULL
  AND fl.point IS NOT NULL
GROUP BY f.id;

COMMENT ON MATERIALIZED VIEW mv_fumigation_hulls IS
  'Poligono (convex hull de los flight points) por fumigacion. Fallback: buffer ~80m para 1-2 vuelos. Alimenta la capa de fumigaciones del geovisor.';

-- Indice unico: requerido por REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_fumigation_hulls_id
  ON mv_fumigation_hulls (fumigation_id);

-- Indice espacial: para filtros por rango/bbox si hiciera falta.
CREATE INDEX IF NOT EXISTS idx_mv_fumigation_hulls_geom
  ON mv_fumigation_hulls USING gist (geom);
