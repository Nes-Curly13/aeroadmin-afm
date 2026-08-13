-- Migration: Add dji_fumigations.deleted_by for soft-delete traceability
-- Date: 2026-08-13
-- Sprint: feature/fumigacion-detail-v2 / sub-4
--
-- Cierra la deuda de auditoría: cuando un operador fumigador (admin o
-- supervisor) elimina una fumigación, queremos saber QUIÉN lo hizo,
-- no solo CUÁNDO. La columna `deleted_at` (migration 20260720000000)
-- ya guardaba el timestamp, pero no el operador responsable.
--
-- Diseño:
--   - Columna TEXT nullable (igual que `recorded_by` y `pilot_license`).
--     Guardamos el email del session user, no un FK a users — porque
--     el rol fumigador puede no existir en la tabla users (es un
--     usuario externo de la cooperativa, no necesariamente autenticado
--     en el sistema). Si en el futuro queremos FK, se agrega después.
--   - Sin ON DELETE (no hay FK).
--   - Sin índice dedicado: el catálogo de fumigaciones soft-deleted es
--     chico (1-10 filas/año) y las queries de listado filtran
--     `deleted_at IS NULL` (que ya tiene índice parcial desde 20260720).
--
-- Rollback:
--   ALTER TABLE public.dji_fumigations DROP COLUMN IF EXISTS deleted_by;

BEGIN;

ALTER TABLE public.dji_fumigations
  ADD COLUMN IF NOT EXISTS deleted_by TEXT NULL;

COMMENT ON COLUMN public.dji_fumigations.deleted_by IS
  'Email del session user que hizo soft-delete. NULL = fumigación activa o eliminada antes de este feature. Seteado por softDeleteFumigationEvent() y el endpoint DELETE /api/admin/fumigations/[id]. Sprint 2026-08-13 — feature/fumigacion-detail-v2 / sub-4.';

COMMIT;
