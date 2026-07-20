-- Migration: Add soft delete columns (deleted_at) to dji_fumigations and dji_parcels
-- Date: 2026-07-20
-- Sprint: Q4 / track C (seguridad) — mejora 2
--
-- Por que soft delete (vs. el DROP que estamos haciendo hoy en el DELETE):
--   - AUDIT: data de fumigaciones y parcelas es operacional. Un DELETE
--     accidental (ej. un import con un id equivocado que pasa la validacion)
--     destruye historia real del operador. Con `deleted_at` podemos:
--       (1) Recuperar data borrada por error sin restaurar backups.
--       (2) Auditar quien/por que elimino algo (futuro: tabla de audit log
--           que guarde user_id, timestamp, motivo en una migracion posterior).
--       (3) Mantener integridad referencial: dji_flights.parcel_id FK a
--           dji_parcels con ON DELETE CASCADE hoy rompe el historial del
--           vuelo si se borra la parcela. Con soft delete, el flight queda
--           referenciando una parcela "archivada" y la historia no se pierde.
--   - No es un delete logico "completo" (aun no modificamos queries para
--     agregar `WHERE deleted_at IS NULL`). Esa migracion de queries es un
--     refactor aparte y no entra en este commit. Esta columna es el
--     prerequisito.
--
-- Por que TIMESTAMPTZ NULL (no BOOLEAN is_deleted):
--   - Un solo campo guarda: (a) si esta borrado, (b) cuando se borro.
--     Con is_deleted=true/false necesitariamos una segunda columna
--     deleted_at para el timestamp.
--   - El patron `WHERE deleted_at IS NULL` es el estandar de soft delete
--     en SQL (Rails, Django, Prisma). Migrar luego es trivial.
--
-- Por que el indice parcial con `WHERE deleted_at IS NULL`:
--   - Las queries que en el futuro filtren filas activas
--     (`WHERE deleted_at IS NULL`) van a ser mayoria. El indice parcial
--     las atiende con un index-only scan, sin tocar filas ya borradas.
--   - Costo: el indice es casi tan grande como la tabla (la mayoria de
--     filas estan activas). Aceptable a nuestra escala (~1207 parcels,
--     ~400 fumigations). Si crecemos a >100k filas por tabla, evaluar
--     mover el indice a `WHERE deleted_at IS NOT NULL` para indexar
--     solo el subconjunto borrado (mas raro).
--
-- Idempotencia:
--   - `ADD COLUMN IF NOT EXISTS` es nativo de Postgres 9.6+.
--   - `CREATE INDEX IF NOT EXISTS` para re-runs seguros.
--   - Re-correr la migration no debe fallar ni duplicar objetos.
--
-- Aplicar via: npm run db:migrate
--
-- Rollback:
--   DROP INDEX IF EXISTS public.idx_dji_fumigations_deleted_at;
--   DROP INDEX IF EXISTS public.idx_dji_parcels_deleted_at;
--   ALTER TABLE public.dji_fumigations DROP COLUMN IF EXISTS deleted_at;
--   ALTER TABLE public.dji_parcels DROP COLUMN IF EXISTS deleted_at;

BEGIN;

-- ============================================================
-- 1) dji_fumigations: columna deleted_at
-- ============================================================
ALTER TABLE public.dji_fumigations
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_dji_fumigations_deleted_at
  ON public.dji_fumigations(deleted_at)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.dji_fumigations.deleted_at IS
  'Soft delete. NULL = fila activa. Timestamp = fecha de borrado logico. La columna existe desde 2026-07-20 (sprint Q4 / track C). Refactor de queries para usar `WHERE deleted_at IS NULL` queda para un commit posterior.';

-- ============================================================
-- 2) dji_parcels: columna deleted_at
-- ============================================================
ALTER TABLE public.dji_parcels
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_dji_parcels_deleted_at
  ON public.dji_parcels(deleted_at)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.dji_parcels.deleted_at IS
  'Soft delete. NULL = fila activa. Timestamp = fecha de borrado logico. La columna existe desde 2026-07-20 (sprint Q4 / track C). Refactor de queries para usar `WHERE deleted_at IS NULL` queda para un commit posterior.';

COMMIT;

-- ============================================================
-- VERIFICACION post-migration
-- ============================================================
-- Esperado:
--   - 2 columnas nuevas: dji_fumigations.deleted_at, dji_parcels.deleted_at
--   - 2 indices nuevos: idx_dji_fumigations_deleted_at, idx_dji_parcels_deleted_at
--   - Ambas columnas son nullable y de tipo timestamptz
--   - Ambas tablas siguen operativas (el soft delete NO reemplaza al
--     ON DELETE CASCADE existente en dji_flights.parcel_id; eso sigue
--     siendo HARD delete a nivel SQL hasta que se haga el refactor de
--     queries).
--
-- Query de verificacion:
--   SELECT table_name, column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND ((table_name = 'dji_fumigations' AND column_name = 'deleted_at')
--       OR (table_name = 'dji_parcels' AND column_name = 'deleted_at'));
--   -- Esperado: 2 filas, data_type='timestamp with time zone', is_nullable='YES'
--
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname = 'public'
--     AND indexname IN ('idx_dji_fumigations_deleted_at', 'idx_dji_parcels_deleted_at');
--   -- Esperado: 2 filas
