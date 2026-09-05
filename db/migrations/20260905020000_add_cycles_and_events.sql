-- Migration: Add cycles + cycle_events + phase_rules (Ciclos Productivos)
-- Date: 2026-09-05
-- Sprint: S11+ / PLAN-FUMIGACIONES-V2 / Fase 4
-- Purpose: El "centro" del data model V2. Una fumigacion YA NO
--   pertenece a una parcela — pertenece a un ciclo productivo de
--   esa parcela. Los ciclos son temporales (siembra, aplicaciones,
--   corte) y multiples por parcela a lo largo del tiempo.
--
-- Decisiones de diseño:
--   - `cycles` representa UNA temporada de cultivo en UNA parcela
--     (de siembra a corte). Crop type y variedad son nullable porque
--     el backfill va a inferir la mayoria desde el DJI (sin esa info).
--   - `cycle_events` son puntos discretos en el tiempo: siembra,
--     aplicacion, cosecha, renovacion. Cada fumigacion genera
--     automaticamente un event tipo 'application' via trigger o
--     desde el repo.
--   - `phase_rules` son configurables (no hardcode). El seed inicial
--     son las 5 fases de la cana de azucar en Valle del Cauca.
--   - `current_phase()` es una funcion SQL STABLE (cacheable por PG)
--     que recibe crop + variety + start_date y devuelve la fase.
--   - `vw_current_cycle` es la vista para queries operacionales
--     (cadencia, fase, edad). Es la nueva "source of truth" para
--     mostrar el ciclo activo de cada parcela en la UI.
--   - FK en dji_fumigations.cycle_id — la fumigacion se asocia al
--     ciclo activo. Nullable durante el backfill.
--   - `data_validity` en cycles sigue el patron Fase 3.A: 'fresh' para
--     ciclos confirmados por el operador, 'needs_review' para los
--     inferidos automaticamente.
--
-- NOTA sobre transacciones: el runner ya envuelve este archivo
-- en BEGIN/COMMIT. NO uses BEGIN/COMMIT propios.
--
-- Rollback:
--   DROP VIEW IF EXISTS vw_current_cycle;
--   DROP FUNCTION IF EXISTS current_phase(TEXT, TEXT, DATE);
--   DROP TABLE IF EXISTS cycle_events CASCADE;
--   DROP TABLE IF EXISTS phase_rules CASCADE;
--   DROP TABLE IF EXISTS cycles CASCADE;
--   ALTER TABLE dji_fumigations DROP COLUMN IF EXISTS cycle_id;

-- ============================================================
-- 1. PHASE_RULES — reglas configurables de fases
-- ============================================================
-- Las fases NO son hardcoded — son data. Asi un futuro "lote
-- experimental de cafe" puede tener reglas distintas sin tocar
-- codigo.
CREATE TABLE IF NOT EXISTS phase_rules (
  id          BIGSERIAL PRIMARY KEY,
  crop_type   TEXT NOT NULL,
  variety     TEXT,
  day_from    INT  NOT NULL CHECK (day_from >= 0),
  day_to      INT  NOT NULL CHECK (day_to >= day_from),
  phase_name  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (crop_type, variety, day_from, day_to)
);

-- Seed: caña de azúcar (Valle del Cauca), 5 fases canonicas.
-- `variety=NULL` significa "aplica a todas las variedades de este crop".
INSERT INTO phase_rules (crop_type, variety, day_from, day_to, phase_name) VALUES
  ('cana', NULL, 0,   30,  'Establecimiento'),
  ('cana', NULL, 31,  90,  'Desarrollo inicial'),
  ('cana', NULL, 91,  180, 'Desarrollo'),
  ('cana', NULL, 181, 300, 'Maduración'),
  ('cana', NULL, 301, 999, 'Próximo a cosecha')
ON CONFLICT (crop_type, variety, day_from, day_to) DO NOTHING;

-- ============================================================
-- 2. CYCLES — la entidad central del modelo V2
-- ============================================================
CREATE TABLE IF NOT EXISTS cycles (
  id                 BIGSERIAL PRIMARY KEY,
  parcela_id         BIGINT NOT NULL REFERENCES dji_parcels(id) ON DELETE RESTRICT,
  crop_type          TEXT,
  variety            TEXT,
  start_date         DATE NOT NULL,
  end_date           DATE,
  source             TEXT NOT NULL DEFAULT 'manual'
                       CHECK (source IN ('manual', 'dji_inferred', 'imported', 'system')),
  data_validity      TEXT NOT NULL DEFAULT 'fresh'
                       CHECK (data_validity IN ('fresh', 'needs_review', 'stale', 'unknown')),
  last_validated_at  TIMESTAMPTZ,
  validated_by_email TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_cycles_parcela
  ON cycles (parcela_id);
-- Indice parcial: solo el ciclo activo por parcela (end_date IS NULL).
-- Cualquier query de "el ciclo actual de la parcela X" hace un
-- index-only scan.
CREATE INDEX IF NOT EXISTS idx_cycles_active
  ON cycles (parcela_id)
  WHERE end_date IS NULL;
CREATE INDEX IF NOT EXISTS idx_cycles_start_date
  ON cycles (start_date DESC);
CREATE INDEX IF NOT EXISTS idx_cycles_data_validity
  ON cycles (data_validity);

-- Trigger de updated_at (re-uso la funcion de Fase 3.A).
DROP TRIGGER IF EXISTS trg_cycles_updated_at ON cycles;
CREATE TRIGGER trg_cycles_updated_at
  BEFORE UPDATE ON cycles
  FOR EACH ROW EXECUTE FUNCTION trg_clients_farms_updated_at();

-- ============================================================
-- 3. CYCLE_EVENTS — siembra, aplicaciones, cosecha, renovacion
-- ============================================================
CREATE TABLE IF NOT EXISTS cycle_events (
  id            BIGSERIAL PRIMARY KEY,
  cycle_id      BIGINT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL
                  CHECK (event_type IN ('planting', 'application', 'harvest', 'renovation')),
  event_date    DATE NOT NULL,
  fumigation_id BIGINT REFERENCES dji_fumigations(id) ON DELETE SET NULL,
  source        TEXT NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual', 'dji_inferred', 'imported', 'system')),
  source_ref    TEXT,
  data_validity TEXT NOT NULL DEFAULT 'fresh'
                  CHECK (data_validity IN ('fresh', 'needs_review', 'stale', 'unknown')),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cycle_events_cycle
  ON cycle_events (cycle_id);
CREATE INDEX IF NOT EXISTS idx_cycle_events_date
  ON cycle_events (event_date DESC);
CREATE INDEX IF NOT EXISTS idx_cycle_events_fumigation
  ON cycle_events (fumigation_id)
  WHERE fumigation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cycle_events_type_date
  ON cycle_events (event_type, event_date DESC);

-- ============================================================
-- 4. FK en dji_fumigations
-- ============================================================
ALTER TABLE dji_fumigations
  ADD COLUMN IF NOT EXISTS cycle_id BIGINT REFERENCES cycles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dji_fumigations_cycle
  ON dji_fumigations (cycle_id)
  WHERE cycle_id IS NOT NULL;

-- ============================================================
-- 5. Funcion: current_phase (STABLE, cacheable por PG)
-- ============================================================
-- Dada la crop + variety + start_date, devuelve el nombre de la
-- fase actual. Si no hay rule que matchee, devuelve NULL (el caller
-- debe mostrar "Sin clasificar" en la UI).
--
-- `STABLE` permite a PG cachear el resultado dentro de una query
-- (vital para queries que llaman current_phase por cada fila de
-- vw_current_cycle).
--
-- NOTA: `CURRENT_DATE - p_start` en PG devuelve INTEGER (dias entre
-- fechas), NO un interval. Por eso no usamos EXTRACT(...) — el
-- cast a INT es directo. EXTRACT solo funciona sobre INTERVAL o
-- TIMESTAMP.
CREATE OR REPLACE FUNCTION current_phase(
  p_crop TEXT,
  p_variety TEXT,
  p_start DATE
) RETURNS TEXT AS $$
  SELECT phase_name FROM phase_rules
   WHERE crop_type = p_crop
     AND (variety = p_variety OR variety IS NULL)
     AND (CURRENT_DATE - p_start)::INT BETWEEN day_from AND day_to
   ORDER BY (variety IS NULL) ASC  -- prefiere variedad específica
   LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- ============================================================
-- 6. Vista: vw_current_cycle — source-of-truth para queries
--    operacionales (cadencia, fase, edad del ciclo activo).
-- ============================================================
CREATE OR REPLACE VIEW vw_current_cycle AS
SELECT
  c.id,
  c.parcela_id,
  c.crop_type,
  c.variety,
  c.start_date,
  c.end_date,
  c.source,
  c.data_validity,
  c.last_validated_at,
  c.validated_by_email,
  c.notes,
  c.created_at,
  c.updated_at,
  p.land_name AS parcela_name,
  p.external_id AS parcela_external_id,
  p.client_id,
  p.farm_id,
  p.municipality,
  -- `NOW() - c.start_date` devuelve integer (dias). NO usar EXTRACT
  -- (solo funciona sobre INTERVAL o TIMESTAMP).
  (NOW()::date - c.start_date)::INT AS age_days,
  current_phase(c.crop_type, c.variety, c.start_date) AS current_phase_name,
  CASE
    WHEN c.end_date IS NOT NULL THEN 'closed'
    ELSE 'active'
  END AS cycle_status
FROM cycles c
JOIN dji_parcels p ON p.id = c.parcela_id AND p.deleted_at IS NULL
WHERE c.end_date IS NULL;

-- ============================================================
-- 7. Comentarios de documentacion
-- ============================================================
COMMENT ON TABLE cycles IS
  'Ciclos Productivos — la entidad central del modelo V2 (Sprint S11+ / Fase 4). Cada parcela tiene 1+ ciclos a lo largo del tiempo (uno por temporada de siembra-cosecha). Las fumigaciones se asocian al ciclo activo via dji_fumigations.cycle_id.';

COMMENT ON TABLE cycle_events IS
  'Eventos discretos dentro de un ciclo: siembra (planting), aplicacion (application), cosecha (harvest), renovacion (renovation). Las fumigaciones generan eventos tipo application automaticamente via el repo o trigger.';

COMMENT ON TABLE phase_rules IS
  'Reglas configurables de fases por cultivo y variedad. Permite que distintos cultivos (cana, cafe, etc.) tengan diferentes curvas de fase. Si variety=NULL, aplica a todas las variedades del crop_type.';

COMMENT ON FUNCTION current_phase IS
  'Devuelve la fase actual de un ciclo dado su crop_type, variety y start_date. Usa la tabla phase_rules. STABLE — PG puede cachear el resultado dentro de una query.';

COMMENT ON VIEW vw_current_cycle IS
  'Ciclo activo de cada parcela (end_date IS NULL). Usado por queries operacionales (cadencia, fase, edad). Sustituye al patron "ultima fumigacion de la parcela" como source-of-truth para el operator.';
