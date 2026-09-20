-- Migration: flags de asignacion de parcela para fumigaciones huerfanas
-- Date: 2026-09-20
--
-- Contexto (handoff 2026-09-20, §3):
--   El import de fumigaciones agrupa vuelos (`dji_flights`) por
--   parcela + dia + sesion (gap > 1 h). Los vuelos cuyo punto NO cae en
--   ninguna parcela (ni dentro de los 50 m) son "huerfanos": se crean
--   igual como fumigacion, pero marcados para que el operador les asigne
--   una parcela existente o cree una nueva (usando el hull como base).
--
-- Por que `session_key` (ademas de los flags pedidos):
--   El modelo viejo identificaba una fumigacion aggregate por
--   `(fumigation_date, source) WHERE parcel_id IS NULL` (partial unique
--   `uq_dji_fumigations_aggregate`). Con agrupacion por sesion puede
--   haber VARIAS fumigaciones la misma fecha (manana/tarde), lo que
--   rompe ese indice. `session_key` es una clave determinista y estable
--   (`<parcel_id|orphan>|<YYYY-MM-DD>|<start_epoch_ms>`) que permite
--   UPSERT idempotente y no colisiona con los aggregate viejos.
--
-- Cambios:
--   1) dji_fumigations.needs_parcel_assignment boolean NOT NULL DEFAULT false
--   2) dji_fumigations.assignment_note text
--   3) dji_fumigations.session_key text
--   4) unique parcial por session_key (para ON CONFLICT del import)
--   5) se reescribe `uq_dji_fumigations_aggregate` para excluir las filas
--      del import con session_key (las aggregate viejas quedan intactas).
--
-- Rollback:
--   DROP INDEX IF EXISTS public.uq_dji_fumigations_session_key;
--   DROP INDEX IF EXISTS public.idx_dji_fumigations_needs_assignment;
--   DROP INDEX IF EXISTS public.uq_dji_fumigations_aggregate;
--   CREATE UNIQUE INDEX uq_dji_fumigations_aggregate
--     ON public.dji_fumigations (fumigation_date, source) WHERE parcel_id IS NULL;
--   ALTER TABLE public.dji_fumigations
--     DROP COLUMN IF EXISTS needs_parcel_assignment,
--     DROP COLUMN IF EXISTS assignment_note,
--     DROP COLUMN IF EXISTS session_key;

BEGIN;

-- ============================================================
-- 1) Columnas nuevas
-- ============================================================
ALTER TABLE public.dji_fumigations
  ADD COLUMN IF NOT EXISTS needs_parcel_assignment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS assignment_note text,
  ADD COLUMN IF NOT EXISTS session_key text;

COMMENT ON COLUMN public.dji_fumigations.needs_parcel_assignment IS
  'TRUE = fumigacion creada desde el import de vuelos sin parcela asignada (huerfana). El operador debe asignarle una parcela existente o crear una nueva. Default false (fumigaciones manuales/aggregate).';

COMMENT ON COLUMN public.dji_fumigations.assignment_note IS
  'Nota explicativa para fumigaciones huerfanas (ej. "3 vuelos sin parcela: hull ~2.1 ha, district El Cerrito"). Se limpia/completa cuando el operador asigna la parcela.';

COMMENT ON COLUMN public.dji_fumigations.session_key IS
  'Clave determinista del import por-sesion: <parcel_id|orphan>|<YYYY-MM-DD>|<start_epoch_ms>. NULL en fumigaciones manuales/aggregate. Habilita UPSERT idempotente del import.';

-- ============================================================
-- 2) Indices
-- ============================================================
-- Bandeja de entrada del operador: huerfanas mas recientes primero.
CREATE INDEX IF NOT EXISTS idx_dji_fumigations_needs_assignment
  ON public.dji_fumigations (fumigation_date DESC)
  WHERE needs_parcel_assignment = true;

-- UPSERT del import (ON CONFLICT (session_key) WHERE session_key IS NOT NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_dji_fumigations_session_key
  ON public.dji_fumigations (session_key)
  WHERE session_key IS NOT NULL;

-- ============================================================
-- 3) Preservar el unique aggregate viejo, excluyendo las filas del import
-- ============================================================
-- Las fumigaciones aggregate de DJI (source='djiscraper'/'import' sin
-- session_key) siguen siendo unicas por (fecha, source). Las del nuevo
-- import por-sesion (session_key NOT NULL) se deduplican por session_key.
DROP INDEX IF EXISTS public.uq_dji_fumigations_aggregate;
CREATE UNIQUE INDEX IF NOT EXISTS uq_dji_fumigations_aggregate
  ON public.dji_fumigations (fumigation_date, source)
  WHERE parcel_id IS NULL AND session_key IS NULL;

COMMIT;

-- ============================================================
-- VERIFICACION post-migration
-- ============================================================
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'dji_fumigations'
--    AND column_name IN ('needs_parcel_assignment', 'assignment_note', 'session_key');
-- Esperado: 3 filas. needs_parcel_assignment boolean NOT NULL default false.
--
-- SELECT indexname, indexdef FROM pg_indexes
--  WHERE tablename = 'dji_fumigations'
--    AND indexname IN ('uq_dji_fumigations_session_key',
--                      'idx_dji_fumigations_needs_assignment',
--                      'uq_dji_fumigations_aggregate');
-- Esperado: 3 filas. uq_..._aggregate con predicado
--   (parcel_id IS NULL AND session_key IS NULL).
