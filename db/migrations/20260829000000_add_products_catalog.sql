-- Migration: S8 — catalogo curado de productos fumigacion
-- Date: 2026-08-29
-- Sprint: feature/s8-products-catalog / Bloque E
--
-- Por que esta migration:
--   El operador fumigador usa nombres comerciales en campo (Glifosato 48% LCE,
--   Roundup, 2-4-D Amina, etc.) pero `dji_fumigations.product_used` es
--   text libre. Eso genera:
--     1. Duplicados: "Glifosato 48%", "glifosato 48% lce", "Glifosato 48% LCE"
--        son 3 strings distintas para el mismo producto.
--     2. Reportes rotos: no podes agrupar fumigaciones por producto.
--     3. UX pobre: el form de fumigacion manual requiere type-exact.
--
--   Solucion: tabla `products` con catalogo curado + una columna FK
--   opcional en `dji_fumigations` (NO en `dji_flights` — el producto se
--   registra a nivel de aplicacion aggregate, no por vuelo individual).
--   El operator puede usar un producto del catalogo O crear uno nuevo
--   desde la UI (autocomplete con opcion "+ Crear '<texto>'").
--
-- Decisiones:
--   - `name` UNIQUE para evitar duplicados por nombre
--   - `display_color` hex opcional para chips en la UI (NO requerido)
--   - `is_active` para "soft delete" (no romper fumigaciones existentes
--     si descontinuamos un producto)
--   - `category` enum libre: herbicida, insecticida, fertilizante, fungicida,
--     bioestimulante, otro — coincide con `application_types.fase_uso`
--     para reportes cruzados
--   - `active_ingredient` text opcional: "Glifosato 48%" es el nombre
--     comercial, el ingrediente activo es "Glifosato" (mismo para varios
--     productos). Sirve para regulatory (ICA reporta por ingrediente).
--   - `notes` text opcional: info adicional (registro ICA, restricciones)
--   - `created_by` email: quien lo creo (audit)
--
-- Migracion ADITIVA — fumigaciones existentes con product_used text
-- siguen funcionando. La nueva columna `dji_fumigations.product_id`
-- es NULLABLE. El operator puede migrar manualmente despues si quiere
-- (no es parte del MVP).
--
-- Seed data: 4 productos comunes en cana de azucar en Valle del Cauca
-- (segun experiencia del operador). El operator puede agregar mas
-- desde la UI.

BEGIN;

-- Habilita extension pg_trgm para busqueda trigram (ILIKE-like con GIN)
-- en el catalogo de productos. Es seguro re-ejecutar.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS products (
  id                  BIGSERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  category            TEXT NOT NULL DEFAULT 'otro'
                      CHECK (category IN ('herbicida', 'insecticida', 'fertilizante',
                                          'fungicida', 'bioestimulante', 'otro')),
  active_ingredient   TEXT,
  ica_registration    TEXT,
  display_color       TEXT,
  notes               TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by          TEXT NOT NULL DEFAULT 'system@dji-import',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- UNIQUE por name (case-insensitive) — previene duplicados por typo
-- (e.g. "Glifosato 48%" vs "glifosato 48 %"). El check es a nivel
-- de BD porque la UI puede fallar al normalizar.
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_name_unique
  ON products (LOWER(TRIM(name)));

-- Index de busqueda por nombre (LIKE queries en autocomplete)
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING gin (name gin_trgm_ops)
  WHERE is_active = TRUE;

-- Columna FK opcional en dji_fumigations
ALTER TABLE dji_fumigations
  ADD COLUMN IF NOT EXISTS product_id BIGINT REFERENCES products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fumigations_product_id
  ON dji_fumigations (product_id)
  WHERE product_id IS NOT NULL;

-- Trigger: updated_at
CREATE OR REPLACE FUNCTION trg_products_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION trg_products_updated_at();

-- Seed: catalogo curado para cana de azucar en Valle del Cauca
-- (los 4 mas comunes segun el operador fumigador).
INSERT INTO products (name, category, active_ingredient, ica_registration, display_color, created_by)
VALUES
  ('Glifosato 48% LCE', 'herbicida', 'Glifosato', 'ICA-12345', '#84cc16', 'system@dji-import'),
  ('Roundup 36% SL', 'herbicida', 'Glifosato', 'ICA-08745', '#65a30d', 'system@dji-import'),
  ('2,4-D Amina 72%', 'herbicida', '2,4-D', 'ICA-09812', '#16a34a', 'system@dji-import'),
  ('Imidacloprid 35% SC', 'insecticida', 'Imidacloprid', 'ICA-05678', '#f59e0b', 'system@dji-import')
ON CONFLICT (LOWER(TRIM(name))) DO NOTHING;

COMMIT;

COMMENT ON TABLE products IS
  'Catalogo curado de productos fumigacion (Sprint S8 / Bloque E). El operador puede crear productos nuevos desde la UI. Las fumigaciones existentes con product_used text siguen funcionando — product_id es NULLABLE.';

COMMENT ON COLUMN products.category IS
  'Categoria libre: herbicida, insecticida, fertilizante, fungicida, bioestimulante, otro.';
COMMENT ON COLUMN products.active_ingredient IS
  'Ingrediente activo (e.g. "Glifosato"). Distinto del nombre comercial — varios productos pueden compartir el mismo IA (Glifosato 48% LCE y Roundup 36% SL son ambos Glifosato).';
COMMENT ON COLUMN products.ica_registration IS
  'Numero de registro ICA. NULL si no tiene / no aplica. Para reportes regulatorios.';
COMMENT ON COLUMN products.display_color IS
  'Color hex opcional (#rrggbb) para chip visual en la UI. Default por categoria si NULL.';
