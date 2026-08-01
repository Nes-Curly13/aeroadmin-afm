-- Migration: Fase de cultivo y cadencia efectiva por estación
-- Date: 2026-08-01
-- Sprint: "Crop time / fase de cultivo" (audit 2026-07-30 §3.1)
--
-- Por qué existe:
--   El sistema modela la cadencia de fumigación como un solo número
--   (`dji_fumigation_schedule.recommended_cadence_days`, default 14d para
--   caña, 10d para orchards). Pero la cadencia REAL depende de:
--     1. La FASE del cultivo (establecimiento, vegetativa, madurante,
--        cosecha). El madurante (ripener) es una sola aplicación por
--        ciclo, 35d pre-cosecha, no 14d. El establecimiento es menos
--        urgente. El cosecha se omite.
--     2. La ESTACIÓN (secas jun-sep vs lluvias oct-may). En secas hay
--        menos presión fúngica, se puede espaciar más. En lluvias más.
--
--   DJI no expone ninguno de los dos. Cenicaña/ICA documentan las reglas
--   (ver docs/FUMIGATION_CADENCE.md). Las usamos como "phase modifiers"
--   sobre la cadencia base del schedule.
--
-- Decisiones de diseño:
--   - `planting_date` ya existe (migration 20260722000000) — la volvemos
--     a declarar con `IF NOT EXISTS` para que esta migration sea
--     idempotente en caso de re-aplicar contra una BD limpia.
--   - `cycle_phase` es NUEVO. Lo dejamos nullable (no backfill) porque
--     `planting_date` es null en 1213/1213 parcelas hoy. Un sprint
--     futuro puede computar la fase desde `planting_date + current_date`
--     en un cron o al render.
--   - CHECK constraint con los 4 valores de fase del dominio. Cualquier
--     otro valor falla el INSERT/UPDATE.
--   - No agregamos índice sobre `cycle_phase` porque:
--       a) Es null en casi todas las parcelas hoy
--       b) Los queries de UI no filtran por fase (es metadata)
--   - Los defaults que `lib/crop-cycle.ts#phaseFor` aplica cuando
--     `planting_date` es null: 'vegetativa' para orchards (simplificación
--     documentada), `null` para caña (lo opuesto: si no sabemos la fecha
--     de siembra, no asumimos fase).
--
-- Rollback:
--   ALTER TABLE public.dji_parcels DROP COLUMN IF EXISTS cycle_phase;
--   -- planting_date no la tocamos (existe desde 2026-07-22).

ALTER TABLE public.dji_parcels
  ADD COLUMN IF NOT EXISTS planting_date DATE;

-- Si planting_date ya existía (caso BD con la migration 20260722000000
-- aplicada), este ADD no hace nada. El IF NOT EXISTS arriba lo cubre.
-- Dejamos el ALTER separado para que la doc del 2026-07-22 no se duplique.

ALTER TABLE public.dji_parcels
  ADD COLUMN IF NOT EXISTS cycle_phase TEXT
  CHECK (cycle_phase IS NULL OR cycle_phase IN ('establecimiento', 'vegetativa', 'madurante', 'cosecha'));

COMMENT ON COLUMN public.dji_parcels.planting_date IS
  'Fecha de siembra / plantación. Lo llena el supervisor — DJI no expone. Existe desde la migration 20260722000000; redeclarada acá con IF NOT EXISTS para idempotencia.';

COMMENT ON COLUMN public.dji_parcels.cycle_phase IS
  'Fase actual del cultivo (establecimiento, vegetativa, madurante, cosecha). Calculable desde planting_date + current_date; nullable hasta que se popule planting_date. La cadencia efectiva de fumigación (lib/crop-cycle.ts + lib/fumigation-cadence.ts) usa este campo como modificador sobre recommended_cadence_days. Docs: docs/FUMIGATION_CADENCE.md §"Fase de cultivo y cadencia efectiva".';
