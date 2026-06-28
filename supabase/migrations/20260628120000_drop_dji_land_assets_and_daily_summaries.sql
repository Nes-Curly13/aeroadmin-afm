-- Migration: Drop dji_land_assets + dji_daily_summaries (Sprint 2/S2 del roadmap)
-- Date: 2026-06-28
-- Phase: Cierre del doble modelo de parcelas y fumigaciones
--
-- Por qué drop ambas:
--   - dji_land_assets era la versión legacy 3-rows-per-field. Reemplazada por
--     dji_parcels (1 row per field, columnas planas) desde la migración del
--     17/06 (Opción B). La única razón por la que seguía viva: getParcels()
--     legacy en api/repositories.ts. Con la migración del dashboard a
--     dji_flights (Sprint 2), getParcels ya no es llamada por el flujo
--     principal — solo por `/api/parcels` legacy y `app/page.tsx` (dashboard
--     que la pasa a OperationsPanel sin usarla realmente).
--   - dji_daily_summaries era el rollup por día de DJI. Reemplazada por
--     `dji_flights` (sorties individuales, 7050 filas, 127 días únicos en BD
--     actual). El agregador `lib/dji-flights-aggregate.ts` produce el mismo
--     shape `DjiDailySummaryRecord` que la UI consume.
--
-- Por qué snapshot antes del drop:
--   - Reversibilidad total. Si en 6 meses alguien pregunta "¿cuál era el
--     rollup diario del 2026-05-28?", está en dji_legacy_snapshot.
--   - Si necesitamos re-importar histórico de DJI y re-construir los rollups,
--     partimos de dji_flights (la fuente granular).
--
-- Rollback:
--   CREATE TABLE dji_daily_summaries AS SELECT
--     (payload->>'id')::int, (payload->>'batch_id')::int, ...
--   FROM dji_legacy_snapshot WHERE legacy_table = 'dji_daily_summaries';
--   CREATE TABLE dji_land_assets AS SELECT ... FROM dji_legacy_snapshot
--   WHERE legacy_table = 'dji_land_assets';

-- ============================================================
-- 1) Snapshot de dji_daily_summaries
-- ============================================================
INSERT INTO public.dji_legacy_snapshot (legacy_table, payload)
SELECT 'dji_daily_summaries', to_jsonb(ds)
FROM public.dji_daily_summaries ds;

-- ============================================================
-- 2) Snapshot de dji_land_assets
-- ============================================================
INSERT INTO public.dji_legacy_snapshot (legacy_table, payload)
SELECT 'dji_land_assets', to_jsonb(la)
FROM public.dji_land_assets la;

-- ============================================================
-- 3) Drop indices + tablas
-- ============================================================
DROP INDEX IF EXISTS public.idx_dji_daily_summaries_batch_id;
DROP INDEX IF EXISTS public.idx_dji_daily_summaries_date;
DROP INDEX IF EXISTS public.idx_dji_land_assets_batch_id;
DROP INDEX IF EXISTS public.idx_dji_land_assets_geom;

DROP TABLE IF EXISTS public.dji_daily_summaries CASCADE;
DROP TABLE IF EXISTS public.dji_land_assets CASCADE;