-- Migration: fumigation_plans (planificación MANUAL de fumigaciones)
--
-- Decisión de producto (2026-09-15): la planificación de fumigaciones
-- deja de derivarse automáticamente de `phase_application_rules` (eso
-- llenaba el dashboard de "vencidas" para todas las parcelas con ciclo
-- viejo). Ahora el operador/admin agenda planes a mano y el sistema
-- SOLO marca "vencido" lo que fue agendado explícitamente y pasó de
-- fecha. Por defecto la tabla arranca VACÍA.
--
-- Un "plan" es una intención de aplicación: parcela + fecha objetivo +
-- (opcional) categoría / tipo de uso / producto + notas. Cuando la
-- aplicación se registra, el plan se marca `hecha` y se puede linkear
-- a la fumigación que lo cumplió (`completed_fumigation_id`).
--
-- FK types (consistencia con el resto del schema):
--   - dji_parcels.id            BIGINT
--   - fumigation_categories.id  INT
--   - application_types.id      INT
--   - dji_fumigations.id        BIGINT

CREATE TABLE IF NOT EXISTS fumigation_plans (
  id                      BIGSERIAL PRIMARY KEY,
  parcel_id               BIGINT NOT NULL REFERENCES dji_parcels(id) ON DELETE CASCADE,
  planned_date            DATE NOT NULL,
  category_id             INT REFERENCES fumigation_categories(id) ON DELETE SET NULL,
  application_type_id     INT REFERENCES application_types(id) ON DELETE SET NULL,
  product_name            TEXT,
  notes                   TEXT,
  status                  TEXT NOT NULL DEFAULT 'planificada'
                            CHECK (status IN ('planificada', 'hecha', 'cancelada')),
  completed_fumigation_id BIGINT REFERENCES dji_fumigations(id) ON DELETE SET NULL,
  created_by_email        TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE fumigation_plans IS
  'Planificación MANUAL de fumigaciones. No se auto-genera: el operador agenda los planes y el sistema solo marca vencido lo agendado.';

-- Overview del dashboard: planes abiertos por fecha (los vencidos son
-- status='planificada' AND planned_date < CURRENT_DATE).
CREATE INDEX IF NOT EXISTS idx_fumigation_plans_status_date
  ON fumigation_plans (status, planned_date);

CREATE INDEX IF NOT EXISTS idx_fumigation_plans_parcel
  ON fumigation_plans (parcel_id, planned_date DESC);
