-- Migration: Add fumigation_audit_log table
-- Date: 2026-08-15
-- Sprint: feature/fumigation-audit-log / sub-1
--
-- Cierra el pedido del operador fumigador (y del contador ICA) de
-- tener trazabilidad de QUIÉN hizo QUÉ sobre una fumigación: cuándo
-- se creó, qué campos se editaron, cuándo se soft-deleted, cuándo
-- se restauró. Antes de este sprint, la BD solo guardaba los datos
-- finales — un edit borraba la historia.
--
-- Tabla append-only (no se UPDATE ni DELETE en operación normal):
--   - id: PK serial
--   - fumigation_id: FK a dji_fumigations(id) ON DELETE CASCADE
--     Razon: si en el futuro alguien hace un hard-delete (ej.
--     limpieza de fumigaciones de prueba), el audit log no debe
--     sobrevivir como fantasma sin contexto. CASCADE es correcto.
--   - action: enum-like TEXT. Valores: 'created' | 'edited' |
--     'deleted' | 'restored'. Validamos en código (no ENUM de BD
--     para no requerir migration cada vez que se sume un action).
--   - actor_email: email del session user al momento del evento.
--     Denormalizado (sin FK a app_users) para que un user borrado
--     no rompa la auditoria historica.
--   - changes: JSONB con la diff o snapshot segun el action.
--     Forma esperada:
--       - 'created'  : { fields: { fumigation_date, product_used, ... } }
--       - 'edited'   : { diff: { product_used: { from, to }, ... } }
--       - 'deleted'  : { snapshot: { product_used, dose_l_per_ha, ... } }
--       - 'restored' : { restored_from: { deleted_at, deleted_by } }
--   - created_at: timestamptz NOW()
--
-- Decisiones:
--   - NO usamos tabla append-only con trigger de BD (más complejo
--     y rigido). El insert se hace en código desde la capa de
--     repository, justo después del UPDATE/DELETE/restore. Asi
--     podemos controlar el shape del JSON segun el action.
--   - Indice compuesto (fumigation_id, created_at DESC) porque
--     la query canonica es "traeme la historia de esta fumigacion
--     ordenada de la mas reciente a la mas vieja".
--   - Sin indice por action ni por actor_email — la consulta de
--     "todas las ediciones del usuario X" no se hace en este sprint
--     y seria un full scan eventual. Si se necesita, se agrega
--     despues con datos.

BEGIN;

-- ============================================================
-- Audit log de fumigaciones
-- ============================================================
CREATE TABLE IF NOT EXISTS public.fumigation_audit_log (
  id            SERIAL PRIMARY KEY,
  fumigation_id INT  NOT NULL
                  REFERENCES public.dji_fumigations(id) ON DELETE CASCADE,
  action        TEXT NOT NULL
                  CHECK (action IN ('created', 'edited', 'deleted', 'restored')),
  actor_email   TEXT NOT NULL,
  changes       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.fumigation_audit_log IS
  'Trazabilidad append-only de fumigaciones: quién creó/editó/soft-deleted/restauró cada evento. NO se actualiza ni borra en operación normal.';

COMMENT ON COLUMN public.fumigation_audit_log.action IS
  'Tipo de evento: created | edited | deleted | restored. Validado por CHECK en BD + código.';
COMMENT ON COLUMN public.fumigation_audit_log.actor_email IS
  'Email del session user al momento del evento. Denormalizado: si el user se borra, la auditoría persiste.';
COMMENT ON COLUMN public.fumigation_audit_log.changes IS
  'Diff o snapshot segun el action. Ver doc del sprint feature/fumigation-audit-log para el shape exacto.';

-- Index principal: "historia de esta fumigación, más reciente primero"
CREATE INDEX IF NOT EXISTS idx_fumigation_audit_log_fumigation
  ON public.fumigation_audit_log(fumigation_id, created_at DESC);

COMMIT;
