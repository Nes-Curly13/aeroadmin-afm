-- Migration: Planificación fitosanitaria por fase (MVP)
-- Date: 2026-09-13
-- Propuesta: docs/DEEPSEEK-PROPOSAL-CICLOS-FENOLOGIA.md
--
-- Decisiones del usuario (MVP):
--   - Approach simple: 4 fases (sin distinguir plantilla/soca).
--   - Reemplaza las alertas por cadencia fija por fase+aplicación.
--   - Reglas data-driven (esta tabla) + UI futura.
--   - Categoría (qué) + tipo de uso (para qué), extensible.
--   - Solo por calendario (sin umbrales de monitoreo rígidos:
--     las de "según monitoreo" van con is_required=false).
--   - Misma variedad para todo (variety=NULL).
--
-- Contenido:
--   1. application_types: slug 'madurante'.
--   2. phase_rules (cana): curva canónica de 4 fases.
--   3. phase_application_rules: reglas fase → aplicación.

-- ============================================================
-- 1. application_types: agregar 'madurante'
-- ============================================================
INSERT INTO application_types (slug, label, color, sort_order) VALUES
  ('madurante', 'Madurante', 'yellow', 40)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- 2. phase_rules (cana): curva canónica 4 fases
--    Reemplaza las 5 fases viejas (Establecimiento/Desarrollo
--    inicial/Desarrollo/Maduración/Próximo a cosecha).
-- ============================================================
DELETE FROM phase_rules WHERE crop_type = 'cana';
INSERT INTO phase_rules (crop_type, variety, day_from, day_to, phase_name) VALUES
  ('cana', NULL, 0,   120, 'establecimiento'),
  ('cana', NULL, 121, 270, 'vegetativa'),
  ('cana', NULL, 271, 360, 'madurante'),
  ('cana', NULL, 361, 9999, 'cosecha');

-- ============================================================
-- 3. phase_application_rules — reglas de aplicación por fase
-- ============================================================
CREATE TABLE IF NOT EXISTS phase_application_rules (
  id                    BIGSERIAL PRIMARY KEY,
  crop_type             TEXT NOT NULL,
  variety               TEXT,                     -- NULL = aplica a todas
  phase                 TEXT NOT NULL,            -- slug de phase_rules.phase_name
  category_slug         TEXT NOT NULL,            -- FK lógica a fumigation_categories.slug
  application_type_slug TEXT,                     -- FK lógica a application_types.slug (opcional)
  cadence_days          INT CHECK (cadence_days IS NULL OR cadence_days > 0),
  window_from_day       INT NOT NULL,             -- días desde cycles.start_date
  window_to_day         INT NOT NULL,
  is_required           BOOLEAN NOT NULL DEFAULT TRUE,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (window_to_day >= window_from_day)
);

CREATE INDEX IF NOT EXISTS idx_phase_app_rules_crop_phase
  ON phase_application_rules (crop_type, phase);

COMMENT ON TABLE phase_application_rules IS
  'Reglas data-driven de aplicación fitosanitaria por fase del ciclo (MVP fenológico). phase → (categoría × tipo de uso) con ventana en días desde cycles.start_date y cadencia opcional. is_required=false = "según monitoreo".';
COMMENT ON COLUMN phase_application_rules.cadence_days IS
  'Si la aplicación se repite (ej. MIPE Diatraea cada 7-10 d). NULL = una vez en la ventana.';
COMMENT ON COLUMN phase_application_rules.is_required IS
  'true = obligatoria en la fase; false = según monitoreo (no genera alerta dura).';

-- Seed (cana, Valle del Cauca — valores ASUMIDOS, ver propuesta §5)
INSERT INTO phase_application_rules
  (crop_type, variety, phase, category_slug, application_type_slug, cadence_days, window_from_day, window_to_day, is_required, notes)
VALUES
  ('cana', NULL, 'establecimiento', 'herbicida',   'pre_emergente', NULL, 0,   20,  TRUE,  'Control de malezas pre-emergente'),
  ('cana', NULL, 'establecimiento', 'fertilizante', NULL,           NULL, 0,   15,  TRUE,  'Fertilización de fondo (P/K)'),
  ('cana', NULL, 'establecimiento', 'insecticida',  NULL,           10,   46,  120, TRUE,  'Control de Diatraea (MIPE) cada 7-10 días'),
  ('cana', NULL, 'vegetativa',      'fertilizante', NULL,           NULL, 121, 180, TRUE,  'Fertilización de cobertera (N)'),
  ('cana', NULL, 'vegetativa',      'insecticida',  NULL,           NULL, 121, 270, FALSE, 'Salivazo (Mahanarva) según monitoreo'),
  ('cana', NULL, 'vegetativa',      'fungicida',    NULL,           NULL, 121, 270, FALSE, 'Roya / carbón según monitoreo'),
  ('cana', NULL, 'madurante',       'otro',         'madurante',    NULL, 300, 360, TRUE,  'Madurante (glifosato) 30-50 días pre-corte');
