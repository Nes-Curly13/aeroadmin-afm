-- Migration: Create the 'extensions' schema (where PostGIS lives)
-- Date: 2026-07-15
-- Purpose: Asegurar que el schema `extensions` existe ANTES de la primera
--   migration (20260428153000), que hace
--     `create extension if not exists postgis with schema extensions`
--   y luego crea columnas con tipo `extensions.geometry(...)`.
--
-- En el image Docker postgis/postgis:16-3.4 (el que usa CI), el schema
-- `extensions` NO se crea por default — la línea `create extension ...
-- with schema extensions` falla con "schema 'extensions' does not exist".
--
-- En local, db/schema.sql creaba las tablas con `geometry(...)` en public
-- (sin prefijo), por lo que las migrations con `extensions.geometry(...)`
-- eran no-ops (`create table if not exists` + tabla ya existente con
-- definición distinta) y nunca se ejecutaban las referencias a `extensions.*`.
-- Por eso el gap quedó invisible localmente.
--
-- Esta migration se numera con timestamp ANTERIOR al primer migration
-- (20260428152500 < 20260428153000) para que el orden lexicográfico la
-- coloque primera en el runner.
--
-- Idempotente: `CREATE SCHEMA IF NOT EXISTS` es no-op si ya existe.
--
-- Rollback: DROP SCHEMA extensions; (no se recomienda — puede romper
--   otras dependencies si la extensión postgis está ahí instalada).

CREATE SCHEMA IF NOT EXISTS extensions;

COMMENT ON SCHEMA extensions IS
  'Schema dedicado a extensiones de Postgres (PostGIS, etc.). '
  'Creado en 2026-07-15 porque las migrations de dji_* referencian '
  '`extensions.geometry(...)` y el primer migration asume el schema '
  'existe (válido en el image de Supabase, no en el image genérico '
  'postgis/postgis que usa CI). Ver CI run 29427837506 y el gap del audit.';
