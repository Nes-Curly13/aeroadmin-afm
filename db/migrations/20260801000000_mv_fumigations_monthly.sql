-- 20260801000000_mv_fumigations_monthly.sql
--
-- Sprint H1/H2 follow-up (audit 2026-07-30 §3.4-bis):
-- Materialized view que agrega las fumigaciones por mes calendario.
--
-- Motivación:
--   - El dashboard `app/page.tsx` construye una serie de 12 meses
--     iterando sobre `dji_fumigations` (17k filas hoy, proyectado a
--     >100k cuando se cargue el histórico completo de 2023-2025).
--     Con 100k filas el render del dashboard pasa de O(12) a O(n) en
--     la sección "Hectáreas tratadas por mes".
--   - El cálculo es determinístico por mes: GROUP BY date_trunc('month', ...).
--     No necesita ser un query "vivo" — refrescar después del pipeline
--     es suficiente.
--   - La audit §3.4-bis dejó en evidencia que un import puede romper
--     silenciosamente los metadatos (288 parcelas orchards mal clasificadas,
--     spray_geom NULL en Supabase prod, etc.). Centralizar el cómputo
--     mensual en el DB reduce la superficie de impacto de esos bugs.
--
-- Decisiones de diseño:
--   - Se filtra `deleted_at IS NULL` y `fumigation_date IS NOT NULL` para
--     que el dashboard no muestre fumigaciones borradas (soft delete) ni
--     filas con fecha inválida.
--   - `area_fumigated_m2` se suma en m²; el caller lo convierte a ha
--     dividiendo por 10_000 (mantenemos unidades SI en el MV, conversión
--     al render).
--   - `ORDER BY month DESC` para que el primer row sea el mes más
--     reciente — matchea la convención de los demás queries de la app
--     (dji_daily_summaries, alertas, etc.).
--   - UNIQUE INDEX sobre `month` para que `REFRESH MATERIALIZED VIEW
--     CONCURRENTLY` funcione sin lockear lecturas. CONCURRENTLY es
--     REQUERIDO por el step 11 del pipeline — un REFRESH plain toma
--     un ACCESS EXCLUSIVE lock que bloquearía al dashboard durante el
--     refresco.

CREATE MATERIALIZED VIEW mv_fumigations_monthly AS
SELECT
    date_trunc('month', f.fumigation_date)::date AS month,
    SUM(f.area_fumigated_m2)                       AS total_area_m2,
    COUNT(*)                                       AS total_fumigations
FROM dji_fumigations f
WHERE f.deleted_at IS NULL
  AND f.fumigation_date IS NOT NULL
GROUP BY date_trunc('month', f.fumigation_date)
ORDER BY month DESC;

-- UNIQUE INDEX requerido por REFRESH MATERIALIZED VIEW CONCURRENTLY.
-- Sin él, Postgres rechaza el CONCURRENTLY con
-- "ERROR: cannot refresh materialized view ... concurrently
--         HINT: Create a unique index with no WHERE clause on one or
--               more columns of the materialized view."
CREATE UNIQUE INDEX mv_fumigations_monthly_month_idx
  ON mv_fumigations_monthly (month);

COMMENT ON MATERIALIZED VIEW mv_fumigations_monthly IS
  'Fumigaciones agregadas por mes calendario. Refrescar con REFRESH '
  'MATERIALIZED VIEW CONCURRENTLY mv_fumigations_monthly al final del '
  'pipeline (scripts/run-pipeline.js step 11).';
