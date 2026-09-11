-- Migration: Add UNIQUE constraint on dji_fumigation_schedule.parcel_id
-- Date: 2026-09-10
-- Sprint: PLAN-ISSUES-2026-09-10 / Fase B / Issue #14
--
-- Por que existe:
--   El modelo del producto dice "1 fila activa por parcela" (la cadencia
--   esperada). Las dos migrations que crean la tabla:
--     1) 20260617170000_add_dji_parcels_normalized.sql (line 75)
--        -> CREA la tabla SIN unique(parcel_id) y SIN trigger updated_at
--     2) 20260618110000_add_dji_fumigations.sql (line 9)
--        -> CREA la tabla CON unique(parcel_id) PERO `IF NOT EXISTS`
--           la deja como NO-OP porque la tabla ya existe. El UNIQUE
--           NUNCA se aplico.
--
--   Consecuencia operativa: 2 fumigaciones concurrentes del backfill
--   podrian meter 2 filas para la misma parcela. Ya hay codigo en
--   `updateFumigationSchedule` que hace UPSERT, pero el UPSERT depende
--   del UNIQUE para funcionar — sin el, 2 INSERTs en paralelo rompen
--   el invariante.
--
-- Verificacion previa (auditoria 2026-09-10):
--   SELECT parcel_id, COUNT(*) FROM dji_fumigation_schedule
--    GROUP BY parcel_id HAVING COUNT(*) > 1;
--   -> 0 duplicates en prod. Aplicar el UNIQUE es seguro.
--
-- El indice UNIQUE actua como la garantia de BD que el codigo de
-- aplicacion asume. Tambien acelera el lookup por parcel_id (que ya
-- tiene un index no-unique, lo reemplazamos).
--
-- Rollback:
--   ALTER TABLE dji_fumigation_schedule DROP CONSTRAINT IF EXISTS
--     dji_fumigation_schedule_parcel_id_key;
--   CREATE INDEX IF NOT EXISTS idx_dji_fumigation_schedule_parcel
--     ON public.dji_fumigation_schedule(parcel_id);

-- 1) Borrar el index no-unique existente. Lo recreamos como UNIQUE.
DROP INDEX IF EXISTS public.idx_dji_fumigation_schedule_parcel;

-- 2) UNIQUE constraint. Nombramos la constraint segun convencion PG
--    (<tabla>_<col>_key) para que sea facil de referenciar en
--    migraciones de rollback y en mensajes de error.
ALTER TABLE public.dji_fumigation_schedule
  ADD CONSTRAINT dji_fumigation_schedule_parcel_id_key
  UNIQUE (parcel_id);
