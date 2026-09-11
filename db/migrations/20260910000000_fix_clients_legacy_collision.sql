-- Migration: Fix legacy `clients` table collision
-- Date: 2026-09-10
--
-- Contexto (auditoría 2026-09-10):
--   La migration inicial `20260428153000_init_afm_flight_gis.sql` creó
--   `public.clients (id, name, contact)` como tabla legacy del schema GIS.
--
--   La migration Fase 3.A `20260905000000_add_clients_farms_tables.sql`
--   usó `CREATE TABLE IF NOT EXISTS clients (...)` con el schema
--   enriquecido (`notes`, `data_validity`, `last_validated_at`,
--   `validated_by_email`, `created_at`, `updated_at`, `created_by_email`).
--   Como la tabla legacy YA existía, ese CREATE fue un NO-OP silencioso:
--   las columnas nuevas NUNCA se crearon.
--
--   Consecuencia: `searchClients` / `createClient` / `getClientById`
--   (api/repositories.ts) y `scripts/backfill-clients-farms.js`
--   referencian columnas que no existen → "column ... does not exist".
--   El autor de la Fase 3.A lo detectó ("column created_by_email of
--   relation clients does not exist") pero lo diagnosticó mal como un
--   bug de catalog-snapshot de pg 8 + node-postgres, y movió el backfill
--   a un script aparte — el root cause real era este NO-OP.
--
-- Este fix trae `clients` al schema enriquecido de forma idempotente.
-- `farms` NO necesita fix (no había tabla `farms` legacy, así que se
-- creó bien).
--
-- Rollback: ALTER TABLE clients DROP COLUMN IF EXISTS notes,
--   data_validity, last_validated_at, validated_by_email, created_at,
--   updated_at, created_by_email;

-- `data_validity` con CHECK + DEFAULT 'unknown' (idempotente y seguro
-- para filas legacy ya existentes: reciben 'unknown').
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS data_validity TEXT NOT NULL DEFAULT 'unknown'
    CHECK (data_validity IN ('fresh', 'needs_review', 'stale', 'unknown'));

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMPTZ;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS validated_by_email TEXT;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- NOT NULL con DEFAULT sentinel: las filas legacy (si las hubiera)
-- no rompen el ALTER, y `createClient` siempre provee el email real.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS created_by_email TEXT NOT NULL DEFAULT 'unknown@backfill';

-- El trigger `trg_clients_updated_at` creado en 20260905000000 ya existe
-- y referencia NEW.updated_at; al agregar la columna queda operativo.
