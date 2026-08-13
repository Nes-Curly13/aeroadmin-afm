-- Migration: Add fumigation_categories catalog + dji_fumigations.category_id FK
-- Date: 2026-08-13
-- Sprint: feature/fumigacion-detail-v2 / sub-2
--
-- Cierra el pedido del operador fumigador de poder clasificar las
-- fumigaciones por tipo (herbicida, insecticida, fertilizante, etc.)
-- para reportes operativos y filtrado en /fumigaciones.
--
-- Diseño:
--   - Catálogo separado (no ENUM in-line) para poder agregar/renombrar
--     categorías sin migraciones adicionales. El operador fumigador
--     puede pedir más categorías con el tiempo.
--   - Columna FK nullable en dji_fumigations para no romper
--     fumigaciones existentes (vienen sin categoría). Los reportes
--     tratan NULL como "Sin clasificar".
--   - ON DELETE SET NULL en la FK: si se elimina una categoría del
--     catálogo, las fumigaciones que la usaban no se rompen — solo
--     vuelven a "Sin clasificar". Es lo correcto para un catálogo
--     curado donde no queremos perder data histórica.
--   - Índice parcial (WHERE category_id IS NOT NULL) porque la mayoría
--     de fumigaciones históricas van a tener NULL, y el index solo
--     ayuda cuando se filtra por categoría.

BEGIN;

-- ============================================================
-- Catálogo curado de categorías
-- ============================================================
CREATE TABLE IF NOT EXISTS public.fumigation_categories (
  id          SERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'slate',
  sort_order  INT  NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.fumigation_categories IS
  'Catálogo curado de categorías de fumigación. FK opcional desde dji_fumigations.category_id.';

-- Seed del catálogo inicial. El operador fumigador pidió empezar
-- con estas 7 categorías (las más comunes en cañicultura del Valle
-- del Cauca). Si necesita más, se insertan en una migration aparte.
INSERT INTO public.fumigation_categories (slug, label, color, sort_order) VALUES
  ('herbicida',    'Herbicida',    'amber',  10),
  ('insecticida',  'Insecticida',  'red',    20),
  ('fungicida',    'Fungicida',    'purple', 30),
  ('fertilizante', 'Fertilizante', 'green',  40),
  ('acaricida',    'Acaricida',    'orange', 50),
  ('nematicida',   'Nematicida',   'yellow', 60),
  ('otro',         'Otro',         'slate',  99)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- FK en dji_fumigations (nullable, no rompe fumigaciones viejas)
-- ============================================================
ALTER TABLE public.dji_fumigations
  ADD COLUMN IF NOT EXISTS category_id INT
    REFERENCES public.fumigation_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dji_fumigations_category
  ON public.dji_fumigations(category_id)
  WHERE category_id IS NOT NULL;

COMMENT ON COLUMN public.dji_fumigations.category_id IS
  'Categoría curada de la fumigación (FK a fumigation_categories). NULL = fumigación histórica sin clasificar.';

COMMIT;
