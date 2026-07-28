-- ============================================================
-- Sprint S7.2 (2026-07-28) — agregar campos del V0 a `dji_parcels`.
--
-- El V0 mockup (`docs/fumigation-management-dashboard`) tiene 4 campos
-- por parcela que el proyecto no tenía: `client_name`, `farm_name`,
-- `municipality`, `variety`. El sprint S6.1 los proyectó como NULL
-- literal en la query SQL (`djiParcelsQuery`) para que el código del
-- MapPageClient degradara a no-op sin romper nada. Esta migration los
-- agrega físicamente al schema.
--
-- Decisión: usar columnas planas (no una tabla aparte `farms` con FK).
-- Justificación: el dataset es ~1200 parcelas, los joins no son
-- necesarios, y las queries del V0 (filtros por cliente, agrupación
-- por hacienda) ya están armadas sobre campos planos. Si el dominio
-- crece a muchas farms por cliente, migrar a una tabla relacional.
-- ============================================================

ALTER TABLE dji_parcels
  ADD COLUMN IF NOT EXISTS client_name  TEXT,
  ADD COLUMN IF NOT EXISTS farm_name    TEXT,
  ADD COLUMN IF NOT EXISTS municipality  TEXT,
  ADD COLUMN IF NOT EXISTS variety      TEXT;

-- Índices para los filtros V0 (cliente / hacienda / municipio).
-- El "variety" no necesita índice (búsqueda substring, no equality).
CREATE INDEX IF NOT EXISTS idx_dji_parcels_client_name ON dji_parcels(client_name)
  WHERE client_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dji_parcels_farm_name ON dji_parcels(farm_name)
  WHERE farm_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dji_parcels_municipality ON dji_parcels(municipality)
  WHERE municipality IS NOT NULL;

-- Comentarios de documentación (psql los muestra con \d+).
COMMENT ON COLUMN dji_parcels.client_name IS
  'Nombre del cliente / ingenio azucarero. Requerido por la UI del V0 (filtro en /map). Opcional.';
COMMENT ON COLUMN dji_parcels.farm_name IS
  'Nombre de la hacienda. Requerido por la UI del V0 (filtro en /map). Opcional.';
COMMENT ON COLUMN dji_parcels.municipality IS
  'Municipio donde está ubicada la parcela (Valle del Cauca, Colombia). Requerido por la UI del V0. Opcional.';
COMMENT ON COLUMN dji_parcels.variety IS
  'Variedad de caña sembrada en la parcela (e.g. CC 85-92, SP 81-3250). Requerido por la UI del V0 (filtro fuzzy en /map). Opcional.';

-- ============================================================
-- Backfill opcional (no automatizado en esta migration).
-- ============================================================
-- Si querés popular `municipality` desde los flights existentes
-- (que sí tienen `district` o derivado del `geom`), correr en un job
-- separado:
--
--   UPDATE dji_parcels p
--      SET municipality = (
--          SELECT f.district FROM dji_flights f
--           WHERE f.parcel_id = p.id AND f.district IS NOT NULL
--           ORDER BY f.start_at DESC LIMIT 1
--      )
--    WHERE p.municipality IS NULL;
--
-- Para `client_name` / `farm_name` / `variety`: el operador fumigador los
-- llena manualmente. UI en S7.3 (`/admin/parcels`).
