-- Migration: 20260711000000_unique_external_id.sql
-- Date: 2026-07-11
-- Purpose: Cerrar el bug que permitía duplicados en dji_parcels por re-scrape.
--
-- Contexto (docs/audit/figma-vs-bd.md + migration 20260709100000):
--   - El UPSERT de lib/djiag-lands-to-parcels.js usaba
--     ON CONFLICT (batch_id, external_id), lo que permitía que cada nuevo
--     batch crease filas nuevas para external_ids ya existentes.
--   - El merge del 2026-07-09 (migration 20260709100000) limpió los
--     duplicados existentes (2412 → 1205 filas) pero NO prevenía que se
--     volvieran a crear en el próximo re-scrape.
--   - Este migration reemplaza la constraint compuesta
--     `unique (batch_id, external_id)` por `unique (external_id)` para
--     alinearla con la nueva semántica del UPSERT.
--
-- Decisión de diseño:
--   - Se preserva la columna `batch_id` (el caller del UPSERT la sigue
--     pasando en $1; el import original con parameter.json tiene
--     batch_id=1, los re-scrapes usan batch_id=2+).
--   - batch_id ya NO es parte de la UNIQUE constraint. Re-scrapes con el
--     mismo external_id hacen UPDATE de la fila existente en lugar de
--     crear duplicados.
--   - El DO UPDATE SET del UPSERT (lib/djiag-lands-to-parcels.js) NO toca
--     batch_id, así que la fila existente conserva el batch_id MÁS ANTIGUO
--     (el del import inicial con parameter.json + assets).
--
-- Idempotencia:
--   - DROP CONSTRAINT IF EXISTS para re-runs seguros.
--   - ADD CONSTRAINT con nombre estable (no autogenerado) para que
--     IF NOT EXISTS sea verificable en psql 14+.
--
-- Aplicar via: npm run db:migrate

BEGIN;

-- ============================================================
-- 1. Reemplazar UNIQUE constraint: (batch_id, external_id) → (external_id)
-- ============================================================
-- El nombre por defecto que generó Postgres para la constraint original
-- fue `dji_parcels_batch_id_external_id_key` (formato: tabla_cols_key).
-- Lo dropeamos con IF EXISTS por si ya fue reemplazada en otro entorno.

ALTER TABLE public.dji_parcels
  DROP CONSTRAINT IF EXISTS dji_parcels_batch_id_external_id_key;

-- También dropeamos el nombre que algunas versiones autogeneran
-- (`dji_parcels_batch_id_external_id_unique` o similar). Usamos IF EXISTS
-- para cada variante posible — solo una existirá realmente.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dji_parcels_batch_id_external_id_key'
      AND conrelid = 'public.dji_parcels'::regclass
  ) THEN
    ALTER TABLE public.dji_parcels
      DROP CONSTRAINT dji_parcels_batch_id_external_id_key;
  END IF;
END
$$;

-- ============================================================
-- 2. Agregar nueva UNIQUE constraint solo sobre external_id
-- ============================================================
-- PRECAUCIÓN: si hay duplicados pre-existentes en external_id (que NO
-- debería haber tras la migration 20260709100000_merge_rescrape_duplicates),
-- este ADD fallará. Verificamos primero para dar un mensaje claro.
DO $$
DECLARE
  dup_count bigint;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT external_id
    FROM public.dji_parcels
    WHERE external_id IS NOT NULL
    GROUP BY external_id
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'No se puede agregar UNIQUE(external_id): hay % external_ids duplicados. '
      'Aplicar primero supabase/migrations/20260709100000_merge_rescrape_duplicates.sql',
      dup_count;
  END IF;
END
$$;

-- Crea la nueva UNIQUE constraint. Usamos un nombre estable para
-- que operaciones posteriores (DROP, rename, etc.) sean reproducibles.
ALTER TABLE public.dji_parcels
  ADD CONSTRAINT dji_parcels_external_id_key UNIQUE (external_id);

-- ============================================================
-- 3. Índices auxiliares (idempotentes)
-- ============================================================
-- El índice batch_id sigue siendo útil para queries de auditoria
-- ("¿cuáles parcelas se importaron en este batch?"), pero ya no es
-- UNIQUE. Lo dejamos como plain btree.
-- (idx_dji_parcels_batch_id ya fue creado en 20260617170000.)

-- El índice sobre external_id es ahora implícito en la UNIQUE constraint
-- (Postgres crea automáticamente un btree UNIQUE), así que NO agregamos
-- otro explícito.

COMMIT;

-- ============================================================
-- VERIFICACION post-migration
-- ============================================================
-- Esperado:
--   - 1 fila por external_id
--   - Columna batch_id sigue presente (no se dropeó)
--   - Constraint dji_parcels_external_id_key existe
--   - Constraint dji_parcels_batch_id_external_id_key NO existe
--
-- Query de verificación:
--   SELECT
--     conname,
--     contype,
--     pg_get_constraintdef(oid) AS definition
--   FROM pg_constraint
--   WHERE conrelid = 'public.dji_parcels'::regclass
--     AND contype IN ('u', 'p');
--
--   SELECT external_id, COUNT(*) AS cnt
--   FROM dji_parcels
--   WHERE external_id IS NOT NULL
--   GROUP BY external_id
--   HAVING COUNT(*) > 1;
--   -- Esperado: 0 filas
