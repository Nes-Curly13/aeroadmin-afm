-- Migration: Backfill clients + farms from dji_parcels denormalized data
-- Date: 2026-09-05
-- Sprint: S11+ / PLAN-FUMIGACIONES-V2 / Fase 3.A
-- Purpose: Separated from 20260905000000_add_clients_farms_tables.sql
--   porque el DO $$ block del backfill tenia un edge case en
--   multi-statement batch: la funcion PL/pgSQL se compilaba
--   upfront (al parsear la cadena SQL) y al ejecutarse NO veia
--   las columnas creadas en una transaction anterior (problema
--   conocido de PL/pgSQL + prepared statements en pg).
--
-- Idempotente (ON CONFLICT DO NOTHING). Solo crea si hay al
-- menos 1 parcela con ese nombre.
--
-- Rollback: DELETE FROM clients WHERE created_by_email = 'system@backfill';
--           DELETE FROM farms WHERE created_by_email = 'system@backfill';

-- ============================================================
-- 1) Clientes unicos (lower-trim) que aparecen en al menos 1 parcela
-- ============================================================
INSERT INTO clients (name, created_by_email, data_validity)
SELECT DISTINCT
  p.client_name,
  'system@backfill',
  'needs_review'  -- marcado para revision del operador
FROM dji_parcels p
WHERE p.client_name IS NOT NULL
  AND TRIM(p.client_name) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM clients c WHERE LOWER(TRIM(c.name)) = LOWER(TRIM(p.client_name))
  );

-- ============================================================
-- 2) Cliente "Sin asignar" para fincas sin client_name
-- ============================================================
INSERT INTO clients (name, created_by_email, data_validity)
VALUES ('(Sin asignar)', 'system@backfill', 'needs_review')
ON CONFLICT (LOWER(TRIM(name))) DO NOTHING;

-- ============================================================
-- 3) Farms unicos por (client_id, name) - farms sin client_name
--    caen bajo "(Sin asignar)" para no perderlas.
-- ============================================================
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
