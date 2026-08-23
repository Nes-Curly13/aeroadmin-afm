-- Migration: S7 / Fase 2 / Q3 (2026-08-23) — materialized view
-- `mv_fumigation_flight_centroids` que pre-calcula el centroide de
-- los flights asociados a cada fumigación.
--
-- Por que esta migration:
--   La query de `getFumigationById` (api/repositories.ts:1131) hace
--   on-the-fly:
--     LEFT JOIN dji_flights fl ON fl.flight_id = ANY(f.flight_ids)
--     + ST_Centroid(ST_Collect(fl.point)) + ST_Y/ST_X
--
--   Con fumigaciones que tienen muchos flights (10-50+) y un dashboard
--   que las lista, el cálculo se repite en cada request. Pre-computar
--   el centroide en una MV lo deja en O(1) lookup por `fumigation_id`.
--
-- Diseño:
--   - La MV es UNIQUE INDEX por `fumigation_id` (requerido para
--     `REFRESH ... CONCURRENTLY`).
--   - La MV NO filtra por `deleted_at` — el `LEFT JOIN` desde
--     `getFumigationById` lo filtra.
--   - El `COUNT(fl.id)` cuenta solo flights que matchean
--     `flight_id = ANY(f.flight_ids)`. Soft-deleted flights se incluyen
--     (el repo principal filtra por `deleted_at` en otros lugares pero
--     acá es acceptable porque la fumigación ya está soft-deleted en
--     el caller y no se renderiza).
--   - El `ST_Centroid(ST_Collect(...))` se hace sobre los flights que
--     tienen `point` no-null. Si un flight tiene `point = NULL`, el
--     ST_Collect lo ignora (PostGIS semantics).
--
-- Refresh policy:
--   - Initial: `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fumigation_flight_centroids;`
--   - En el pipeline DJI (scripts/), agregar el refresh al final
--     (después de INSERT/UPDATE de fumigaciones).
--   - Después de `createFumigationEvent` / `updateFumigationEvent` /
--     `linkFumigationToParcel` / restore: `CONCURRENTLY` refresh
--     (fire-and-forget — la MV queda stale por ~1s, acceptable para
--     una fumigación recién creada).
--
-- Por qué CONCURRENTLY (no non-concurrent):
--   CONCURRENTLY toma un lock de solo lectura (no bloquea queries
--   sobre la MV durante el refresh). non-concurrent toma lock
--   exclusivo que pausa el detail page. El trade-off: requiere
--   UNIQUE INDEX (lo creamos abajo).
--
-- Rollback:
--   DROP MATERIALIZED VIEW IF EXISTS public.mv_fumigation_flight_centroids;

BEGIN;

CREATE MATERIALIZED VIEW public.mv_fumigation_flight_centroids AS
SELECT
    f.id AS fumigation_id,
    -- ST_Centroid sobre ST_Collect de los points. Si no hay flights
    -- (flight_ids NULL o vacío), el JOIN filtra todos y ST_Collect
    -- devuelve NULL → ST_Centroid(NULL) = NULL.
    ST_Y(ST_Centroid(ST_Collect(fl.point)))::numeric AS lat,
    ST_X(ST_Centroid(ST_Collect(fl.point)))::numeric AS lng,
    COUNT(fl.id)::int AS n_matched_flights
  FROM public.dji_fumigations f
  JOIN public.dji_flights fl
    ON fl.flight_id = ANY(f.flight_ids)
 WHERE f.flight_ids IS NOT NULL
   AND array_length(f.flight_ids, 1) > 0
   -- Filtrar fumigaciones soft-deleted: no necesitamos sus centroides
   -- (la UI tampoco las muestra).
   AND f.deleted_at IS NULL
 GROUP BY f.id;

-- UNIQUE INDEX para REFRESH CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS mv_fumigation_flight_centroids_pk
  ON public.mv_fumigation_flight_centroids (fumigation_id);

-- Refresh inicial: llena la MV con los datos actuales. CONCURRENTLY
-- requiere que la MV esté "populated" antes (el primer refresh puede
-- ser non-concurrent, los siguientes CONCURRENTLY).
REFRESH MATERIALIZED VIEW public.mv_fumigation_flight_centroids;

COMMIT;
