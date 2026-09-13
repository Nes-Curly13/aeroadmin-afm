-- Migration: Sync product_used desde products.name (FK product_id)
-- Date: 2026-09-13
--
-- Contexto (auditoría #50, mismo patrón que #49):
--   `dji_fumigations` tiene el nombre del producto DUPLICADO:
--     - `product_used` (TEXT) — lo que la UI muestra.
--     - `product_id` (FK a `products`, catálogo curado).
--   El form (`ProductPicker`) sincroniza ambos al escribir, pero un
--   caller de API / import viejo pudo dejar `product_id` seteado con
--   `product_used` vacío.
--
-- One-time consistency fix: rellena `product_used` con el nombre
-- canónico del catálogo SOLO donde está vacío (no pisa texto libre
-- existente). Idempotente.

UPDATE dji_fumigations f
   SET product_used = p.name
  FROM products p
 WHERE f.product_id = p.id
   AND (f.product_used IS NULL OR f.product_used = '');
