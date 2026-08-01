-- Migration: 20260707000000_add_data_quality_checks.sql
-- Date: 2026-07-07
-- Purpose: Cerrar los 8 schema gaps encontrados por el db-constraints-stress.
-- Aplicar via: npm run db:migrate
--
-- Cada CHECK constraint cubre un caso que el stress test detectó como aceptado
-- erróneamente. Todas son idempotentes (IF NOT EXISTS cuando posible, o se
-- dropean antes de crear para permitir re-run).

BEGIN;

-- ============================================================
-- 1. dji_fumigations: area y dose no negativos
-- ============================================================
ALTER TABLE public.dji_fumigations
  ADD CONSTRAINT dji_fumigations_area_nonneg CHECK (area_fumigated_m2 IS NULL OR area_fumigated_m2 >= 0),
  ADD CONSTRAINT dji_fumigations_dose_nonneg CHECK (dose_l_per_ha IS NULL OR dose_l_per_ha >= 0);

-- Fumigation_date no en futuro lejano (10 anios de margen por si hay timezone drift)
ALTER TABLE public.dji_fumigations
  ADD CONSTRAINT dji_fumigations_date_sane CHECK (
    fumigation_date >= '2015-01-01'::date
    AND fumigation_date <= (CURRENT_DATE + INTERVAL '1 day')
  );

-- ============================================================
-- 2. dji_flights: geometria + duracion no negativos
-- ============================================================
ALTER TABLE public.dji_flights
  ADD CONSTRAINT dji_flights_area_nonneg CHECK (area_m2 IS NULL OR area_m2 >= 0),
  ADD CONSTRAINT dji_flights_duration_nonneg CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  ADD CONSTRAINT dji_flights_lng_range CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180)),
  ADD CONSTRAINT dji_flights_lat_range CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90));

-- start_at no en pasado lejano (DJI Agras operativo desde 2015)
ALTER TABLE public.dji_flights
  ADD CONSTRAINT dji_flights_start_sane CHECK (
    start_at >= '2015-01-01'::timestamptz
    AND start_at <= (NOW() + INTERVAL '1 day')
  );

-- ============================================================
-- 3. dji_fumigation_schedule: cadence razonable (>= 1 dia, <= 365)
-- ============================================================
ALTER TABLE public.dji_fumigation_schedule
  ADD CONSTRAINT dji_fumigation_schedule_cadence_sane CHECK (
    recommended_cadence_days >= 1
    AND recommended_cadence_days <= 365
  );

COMMIT;

-- ============================================================
-- VERIFICACION post-migration (corre en el commit del apply-pending-migrations)
-- ============================================================
-- Para validar: re-correr scripts/db-constraints-stress.js. Todos los inverse
-- tests deben cambiar de PASS a FAIL.