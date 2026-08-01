-- Migration: S2 — Cleanup final de tablas legacy (2026-07-01)
-- Phase: Cierre del modelo de parcelas + fumigaciones. Companion de S1.7
-- (migración del dashboard a getParcelsNormalized).
--
-- Contexto:
--   - 2026-06-28 (Sprint 2 / migration 20260628120000): primer drop de
--     dji_land_assets + dji_daily_summaries con snapshot reversible a
--     dji_legacy_snapshot.
--   - 2026-07-01 (S1.7 / Sprint 2 final): el último caller del shape legacy
--     (app/page.tsx) migró a getParcelsNormalized. Las tablas legacy
--     ya no son leídas.
--   - 2026-07-01 (S2 / esta migration): cleanup defensivo. La migration
--     20260628120000 ya dropeó las tablas en Supabase, pero:
--     (a) dev environments (PostgreSQL local) pueden haberlas recreado
--         accidentalmente al re-correr el importer antes de este fix.
--     (b) queremos que `npm run db:init` sea idempotente: si alguien
--         corre la pipeline contra una BD con las tablas existentes,
--         no debería tirar "relation does not exist" ni dejar las
--         tablas huérfanas.
--
-- Idempotencia:
--   - DROP TABLE IF EXISTS permite correr la migration N veces.
--   - DROP INDEX IF EXISTS protege de índices huérfanos.
--   - El snapshot a dji_legacy_snapshot está protegido por un IF NOT EXISTS
--     en la tabla snapshot (creada en una migration previa, ver 20260428).
--
-- Rollback:
--   CREATE TABLE dji_daily_summaries AS SELECT
--     (payload->>'id')::int, (payload->>'batch_id')::int, ...
--   FROM dji_legacy_snapshot WHERE legacy_table = 'dji_daily_summaries';
--   CREATE TABLE dji_land_assets AS SELECT ... FROM dji_legacy_snapshot
--   WHERE legacy_table = 'dji_land_assets';
--   (El snapshot original está en 20260628120000_drop_dji_land_assets_and_daily_summaries.sql
--    y contiene TODA la data anterior al drop inicial.)

-- ============================================================
-- 1) Defensive: si las tablas existen (re-corrida accidental en dev),
--    snapshot adicional antes de dropear. No-op si ya están dropeadas.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'dji_daily_summaries'
  ) THEN
    INSERT INTO public.dji_legacy_snapshot (legacy_table, payload)
    SELECT 'dji_daily_summaries', to_jsonb(ds)
    FROM public.dji_daily_summaries ds
    ON CONFLICT DO NOTHING;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'dji_land_assets'
  ) THEN
    INSERT INTO public.dji_legacy_snapshot (legacy_table, payload)
    SELECT 'dji_land_assets', to_jsonb(la)
    FROM public.dji_land_assets la
    ON CONFLICT DO NOTHING;
  END IF;
END
$$;

-- ============================================================
-- 2) Drop indices (no-op si no existen)
-- ============================================================

DROP INDEX IF EXISTS public.idx_dji_daily_summaries_batch_id;
DROP INDEX IF EXISTS public.idx_dji_daily_summaries_date;
DROP INDEX IF EXISTS public.idx_dji_daily_summaries_weekday;
DROP INDEX IF EXISTS public.idx_dji_land_assets_batch_id;
DROP INDEX IF EXISTS public.idx_dji_land_assets_geom;

-- ============================================================
-- 3) Drop tablas (no-op si no existen)
-- ============================================================

DROP TABLE IF EXISTS public.dji_daily_summaries CASCADE;
DROP TABLE IF EXISTS public.dji_land_assets CASCADE;
