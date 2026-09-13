-- Migration: indices para el scan del dashboard
-- Date: 2026-09-13
-- Sprint: PLAN-ISSUES-2026-09-10 / MT-04
--
-- Contexto: `fetchDashboardMetricsRaw` (lib/cache.ts) filtra
--   WHERE area_m2 >= 40000 OR duration_seconds >= 28800
-- sin indice → seq scan sobre 10k+ filas. El cuello NO es la fecha
-- sino el OR (bitmap OR de los 2 indices resuelve).
--
-- Indices parciales (WHERE NOT NULL) ahorran espacio y mejoran
-- selectivity: las filas con area_m2/duration_seconds NULL no entran
-- al index.

CREATE INDEX IF NOT EXISTS idx_dji_flights_area_m2
  ON dji_flights (area_m2) WHERE area_m2 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dji_flights_duration_seconds
  ON dji_flights (duration_seconds) WHERE duration_seconds IS NOT NULL;

-- Rollback:
--   DROP INDEX IF EXISTS idx_dji_flights_area_m2;
--   DROP INDEX IF EXISTS idx_dji_flights_duration_seconds;
