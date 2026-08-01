-- Migration: refactor del enum role en app_users (admin | supervisor)
-- Date: 2026-07-21
-- Sprint: v1.4 Track A — RBAC admin/supervisor
--
-- Contexto (decision PO 2026-07-21):
--   El sistema es single-tenant (operador canero del Valle del Cauca).
--   Antes: role era 'admin' | 'viewer' con default 'viewer'.
--   Ahora: role es 'admin' | 'supervisor' con default 'admin'.
--
--   "viewer" deja de existir y se renombra a "supervisor" porque el PO
--   decidio que el rol no-admin (supervisor de operaciones) puede
--   registrar fumigaciones propias, no solo mirar dashboards. El
--   cambio es semantico: mas permisos que el viewer anterior.
--
-- Por que default 'admin' y no 'supervisor':
--   Backwards-compat. Los usuarios actuales (seed via
--   `npm run auth:seed`) son admins por decision del PO ("hoy todos
--   los usuarios son admin por default"). Si el default fuera
--   'supervisor', un INSERT sin role explicito dejaria al nuevo
--   usuario sin acceso a endpoints admin (/admin/*) y a la UI
--   de gestion. Como TODOS los usuarios seedeados hoy son admin
--   explicitos (el seed-admin-user.js fuerza 'admin'), el default
--   'admin' es coherente con el estado actual y protege contra
--   olvidos en futuros seeds.
--
-- Por que backfill 'viewer' -> 'supervisor' (no 'admin'):
--   El PO no especifico que hacer con los viewers existentes. Pero
--   el rename semantico (viewer con menos permisos -> supervisor
--   con mas permisos) implica que cualquier viewer que existiera
--   hereda los permisos del nuevo rol, no se le otorgan los del
--   admin. Ademas, si en el futuro se quiere promover un supervisor
--   a admin, es una sola query UPDATE; lo contrario (degradar un
--   admin auto-promovido) no es trivial.
--
-- Por que un indice parcial solo para 'supervisor':
--   Hoy todos son admin. Si en el futuro la mayoria migra a
--   supervisor, el indice ayuda a queries tipo "listar todos los
--   supervisores activos". El indice NO es util para 'admin' porque
--   ya habria 1 sola fila o muy pocas. El WHERE role = 'supervisor'
--   mantiene el indice chico (~bytes) hasta que crezca la poblacion.
--
-- Idempotencia:
--   - DROP CONSTRAINT IF EXISTS: la migration es segura de re-correr.
--   - UPDATE ... WHERE role = 'viewer': no-op si ya no hay viewers.
--   - ALTER COLUMN ... SET DEFAULT: idempotente.
--   - ADD CONSTRAINT ... CHECK: falla si la tabla ya tiene rows con
--     role invalido, por eso el UPDATE va ANTES del ADD CONSTRAINT.
--   - CREATE INDEX IF NOT EXISTS: idempotente.
--
-- Rollback (NO automatico):
--   ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
--   UPDATE app_users SET role = 'viewer' WHERE role = 'supervisor';
--   ALTER TABLE app_users ADD CONSTRAINT app_users_role_check
--     CHECK (role IN ('admin', 'viewer'));
--   ALTER TABLE app_users ALTER COLUMN role SET DEFAULT 'viewer';
--   DROP INDEX IF EXISTS idx_app_users_role;
--   -- Ajustar manualmente el default de cualquier fila que
--   -- hubiera sido 'admin' (los admins actuales quedan como 'admin').

-- ============================================================
-- 1) Backfill: viewer -> supervisor (ANTES de cambiar el CHECK)
-- ============================================================
UPDATE app_users
   SET role = 'supervisor',
       updated_at = now()
 WHERE role = 'viewer';

-- ============================================================
-- 2) Drop old CHECK, add new one
-- ============================================================
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;

ALTER TABLE app_users
  ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('admin', 'supervisor'));

-- ============================================================
-- 3) Default: 'admin' (backwards-compat con usuarios seedeados)
-- ============================================================
ALTER TABLE app_users
  ALTER COLUMN role SET DEFAULT 'admin';

-- ============================================================
-- 4) Indice parcial (solo supervisores, los admins son minoria)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_app_users_role
  ON app_users(role)
  WHERE role = 'supervisor';

-- ============================================================
-- 5) Actualizar comentarios
-- ============================================================
COMMENT ON COLUMN public.app_users.role IS
  'admin = CRUD completo + gestion de usuarios. supervisor = operario con permisos de registrar fumigaciones y leer mapas/history. Default admin por backwards-compat (PO 2026-07-21).';
