-- Migration: Add clients + farms tables + FK columns on dji_parcels
-- Date: 2026-09-05
-- Sprint: S11+ / PLAN-FUMIGACIONES-V2 / Fase 3.A
-- Purpose: Re-scope del data model de fumigaciones para soportar la
--   jerarquía Cliente → Finca → Parcela (requisito de tesis). Las
--   parcelas hoy tienen `client_name` y `farm_name` denormalizadas;
--   este migration las promueve a entidades de primera clase con FK,
--   manteniendo compat con código viejo (denormalizadas siguen
--   funcionando, vista `vw_parcels` expone el JOIN).
--
-- Adicional: agrega `data_validity` (ENUM) + `last_validated_at` +
--   `validated_by_email` a `dji_parcels` como metadata de calidad
--   de datos (base de la Capa de Gestión, Fase 4.4).
--
-- Decisiones:
--   - `clients.name` UNIQUE con `LOWER(TRIM(name))` — previene
--     duplicados por typo ("Agro" vs "agro  "). El check es a nivel
--     de BD porque la UI puede fallar al normalizar.
--   - `farms.UNIQUE (client_id, name)` — una finca por cliente.
--   - FKs en `dji_parcels` son NULLABLE (no rompen data existente).
--   - `data_validity` DEFAULT 'unknown' — toda parcela existente
--     empieza como 'unknown' (no sabemos si está validada). El
--     operador puede ir cambiando a 'fresh' después de revisar.
--   - `data_validity` también se aplica a otras tablas (futuro,
--     Fase 4.4). Empezamos por dji_parcels porque es la entidad
--     central.
--
-- NOTA IMPORTANTE sobre transacciones: el runner
-- (`scripts/apply-pending-migrations.js`) ya envuelve la migration
-- en `BEGIN; ... COMMIT;`. Por eso este archivo NO usa BEGIN/COMMIT
-- propios — usar ambos crea savepoints que confunden al parser de PG
-- cuando se manda la migration como batch via `client.query(sql)`.
-- El `DO $$ ... END $$;` block sigue siendo válido (PL/pgSQL tiene
-- su propio control de flujo).
--
-- Rollback: DROP TABLE farms; DROP TABLE clients; ALTER TABLE dji_parcels
--   DROP COLUMN IF EXISTS client_id, farm_id, data_validity, last_validated_at, validated_by_email;
--   DROP VIEW IF EXISTS vw_parcels;

-- Extensión pg_trgm para búsqueda fuzzy (ya está en products, re-uso seguro)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id                BIGSERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  notes             TEXT,
  data_validity     TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (data_validity IN ('fresh', 'needs_review', 'stale', 'unknown')),
  last_validated_at TIMESTAMPTZ,
  validated_by_email TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_email  TEXT NOT NULL
);

-- UNIQUE por nombre normalizado — previene duplicados por typo
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_name_unique
  ON clients (LOWER(TRIM(name)));

-- Búsqueda fuzzy en autocomplete (ILIKE + GIN trgm)
-- NOTA: NO usamos partial index WHERE data_validity IN (...) porque
-- el parser de PG tiene un edge case con partial indexes que
-- referencian columnas definidas en el mismo batch. Mejor: index
-- completo + filtrar en el SELECT (que es lo que hace searchClients
-- de todas formas — usa `WHERE LOWER(name) LIKE ...`).
CREATE INDEX IF NOT EXISTS idx_clients_name_trgm
  ON clients USING gin (name gin_trgm_ops);

-- ============================================================
-- FARMS
-- ============================================================
CREATE TABLE IF NOT EXISTS farms (
  id                BIGSERIAL PRIMARY KEY,
  client_id         BIGINT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  name              TEXT NOT NULL,
  municipality      TEXT,
  department        TEXT,
  data_validity     TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (data_validity IN ('fresh', 'needs_review', 'stale', 'unknown')),
  last_validated_at TIMESTAMPTZ,
  validated_by_email TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_email  TEXT NOT NULL
);

-- UNIQUE compuesto por nombre normalizado — no se puede poner
-- inline con LOWER(TRIM(name)) porque PG no permite funciones
-- en UNIQUE constraints. Se hace con UNIQUE INDEX (idempotente).
CREATE UNIQUE INDEX IF NOT EXISTS idx_farms_client_name_unique
  ON farms (client_id, LOWER(TRIM(name)));

CREATE INDEX IF NOT EXISTS idx_farms_client_id
  ON farms (client_id);

CREATE INDEX IF NOT EXISTS idx_farms_municipality
  ON farms (municipality)
  WHERE municipality IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_farms_name_trgm
  ON farms USING gin (name gin_trgm_ops);

-- ============================================================
-- FKs en dji_parcels
-- ============================================================

-- FKs (NULLABLE — no rompe data existente)
ALTER TABLE dji_parcels
  ADD COLUMN IF NOT EXISTS client_id BIGINT REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS farm_id BIGINT REFERENCES farms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dji_parcels_client_id
  ON dji_parcels (client_id)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dji_parcels_farm_id
  ON dji_parcels (farm_id)
  WHERE farm_id IS NOT NULL;

-- Columnas de data_validity (Capa de Gestión — Fase 4.4)
ALTER TABLE dji_parcels
  ADD COLUMN IF NOT EXISTS data_validity TEXT NOT NULL DEFAULT 'unknown'
    CHECK (data_validity IN ('fresh', 'needs_review', 'stale', 'unknown')),
  ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validated_by_email TEXT;

CREATE INDEX IF NOT EXISTS idx_dji_parcels_data_validity
  ON dji_parcels (data_validity);

-- ============================================================
-- Triggers de updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION trg_clients_farms_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clients_updated_at ON clients;
CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION trg_clients_farms_updated_at();

DROP TRIGGER IF EXISTS trg_farms_updated_at ON farms;
CREATE TRIGGER trg_farms_updated_at
  BEFORE UPDATE ON farms
  FOR EACH ROW EXECUTE FUNCTION trg_clients_farms_updated_at();

-- ============================================================
-- Vista de compat: vw_parcels
-- ============================================================
-- Mantiene el shape viejo (con client_name, farm_name) a través de
-- un JOIN. La API existente que lee `client_name` / `farm_name` de
-- dji_parcels sigue funcionando. El nuevo código debería preferir
-- la vista o JOINs explícitos.
DROP VIEW IF EXISTS vw_parcels;
CREATE VIEW vw_parcels AS
SELECT
  p.*,
  c.name AS client_name_vw,
  f.name AS farm_name_vw,
  f.municipality AS municipality_vw
FROM dji_parcels p
LEFT JOIN clients c ON c.id = p.client_id
LEFT JOIN farms f ON f.id = p.farm_id;

-- ============================================================
-- Backfill best-effort (Fase 3.B complemento)
-- ============================================================
-- Sprint S11+ / Fase 3.B. Crea `clients` y `farms` a partir de los
-- valores denormalizados de `dji_parcels.client_name` y
-- `dji_parcels.farm_name`. Idempotente (ON CONFLICT DO NOTHING).
-- NO modifica `dji_parcels.client_id` / `farm_id` (eso es decisión
-- del operador en la UI, porque los nombres son ambiguos y
-- pueden tener variantes).
--
-- Conteo: solo crea si hay al menos 1 parcela con ese nombre.
DO $$
DECLARE
  inserted_clients INT := 0;
  inserted_farms   INT := 0;
BEGIN
  -- 1) Clientes únicos (lower-trim) que aparecen en al menos 1 parcela
  INSERT INTO clients (name, created_by_email, data_validity)
  SELECT DISTINCT
    p.client_name,
    'system@backfill',
    'needs_review'  -- marcado para revisión del operador
  FROM dji_parcels p
  WHERE p.client_name IS NOT NULL
    AND TRIM(p.client_name) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM clients c WHERE LOWER(TRIM(c.name)) = LOWER(TRIM(p.client_name))
    );
  GET DIAGNOSTICS inserted_clients = ROW_COUNT;

  -- 2) Farms únicos por (client_id, name) — pero como algunas parcelas
  --    tienen farm_name sin client_name, las farms sin cliente se
  --    crean bajo un cliente "Sin asignar" para no perderlas.
  INSERT INTO clients (name, created_by_email, data_validity)
  VALUES ('(Sin asignar)', 'system@backfill', 'needs_review')
  ON CONFLICT (LOWER(TRIM(name))) DO NOTHING;

  INSERT INTO farms (client_id, name, municipality, created_by_email, data_validity)
  SELECT DISTINCT
    COALESCE(
      (SELECT id FROM clients WHERE LOWER(TRIM(name)) = LOWER(TRIM(p.client_name))),
      (SELECT id FROM clients WHERE name = '(Sin asignar)')
    ),
    p.farm_name,
    p.municipality,
    'system@backfill',
    'needs_review'
  FROM dji_parcels p
  WHERE p.farm_name IS NOT NULL
    AND TRIM(p.farm_name) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM farms f
      WHERE f.client_id = COALESCE(
              (SELECT id FROM clients WHERE LOWER(TRIM(name)) = LOWER(TRIM(p.client_name))),
              (SELECT id FROM clients WHERE name = '(Sin asignar)')
            )
        AND LOWER(TRIM(f.name)) = LOWER(TRIM(p.farm_name))
    );
  GET DIAGNOSTICS inserted_farms = ROW_COUNT;

  RAISE NOTICE 'Backfill: % clients nuevos, % farms nuevas (ambas data_validity=needs_review)',
    inserted_clients, inserted_farms;
END $$;

-- ============================================================
-- Comentarios de documentación
-- ============================================================
COMMENT ON TABLE clients IS
  'Clientes del operador fumigador (entidad de primera clase, S11+ / Fase 3.A). Requisito de tesis — la parcela ahora vive dentro de un cliente→finca. Backfill automático desde dji_parcels.client_name en este migration; operator debe revisar y confirmar (data_validity=needs_review por default).';

COMMENT ON TABLE farms IS
  'Fincas dentro de un cliente (S11+ / Fase 3.A). Una finca pertenece a un único cliente. La parcela ahora vive en cliente→finca→parcela.';

COMMENT ON COLUMN dji_parcels.client_id IS
  'FK a clients.id (nullable — no rompe data existente). Cuando es NULL, el operador todavía no asignó cliente a esta parcela. La columna denormalizada dji_parcels.client_name se mantiene para compat.';
COMMENT ON COLUMN dji_parcels.farm_id IS
  'FK a farms.id (nullable). Igual que client_id — columna denormalizada dji_parcels.farm_name se mantiene para compat.';

COMMENT ON COLUMN dji_parcels.data_validity IS
  'Calidad del dato (Capa de Gestión, S11+ / Fase 4.4). fresh = validado por operador, needs_review = requiere atención, stale = no actualizado en N días, unknown = sin clasificar. Default unknown para parcelas existentes. Index parcial para queries de "parcelas que necesitan atención".';
COMMENT ON COLUMN dji_parcels.last_validated_at IS
  'Última vez que el operador confirmó manualmente que la data está vigente. Para parcelas nuevas, NULL hasta que se valide.';
COMMENT ON COLUMN dji_parcels.validated_by_email IS
  'Email del operador que validó por última vez. Auditoría.';
