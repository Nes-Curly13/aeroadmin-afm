-- Migration: Make dji_fumigations.parcel_id nullable
-- Date: 2026-06-19
-- Phase: §11.4 #2 — populate dji_fumigations with aggregate per-day data
--         from the DJI API (`flight_records/aggr_by_day` endpoint).
--
-- Por que parcel_id nullable:
--   - El endpoint `aggr_by_day` devuelve el agregado del DIA para TODA la cuenta,
--     no por parcela individual. No hay forma de mapear "este dia se fumigo en
--     estas fincas" sin el endpoint per-flight detail (que DJI no expone
--     facilmente en Personal edition).
--   - Permitimos parcel_id NULL para los aggregate imports. Las fumigaciones
--     sin parcela son validas — son "se fumigo en algun lado, area total X".
--   - Si en el futuro capturamos per-flight data, podemos UPDATE las filas
--     existentes para asignarles parcel_id.
--
-- Por que el UNIQUE index parcial:
--   - Para que el UPSERT sea idempotente, necesitamos un unique constraint que
--     identifique univocamente cada fumigacion aggregate.
--   - El constraint natural (parcel_id, fumigation_date) no funciona cuando
--     parcel_id es NULL (SQL considera NULLs distintos en unique constraints).
--   - Un partial unique index `WHERE parcel_id IS NULL ON (fumigation_date, source)`
--     resuelve el caso aggregate: solo puede haber una fila aggregate por
--     (fecha, source) — UPSERT funciona.
--   - Para fumigaciones con parcel_id (futuro), el FK a dji_parcels.id +
--     fumigation_date dan la unicidad via aplicacion (no SQL constraint).
--
-- Rollback: ALTER TABLE dji_fumigations ALTER COLUMN parcel_id SET NOT NULL;

ALTER TABLE dji_fumigations ALTER COLUMN parcel_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dji_fumigations_aggregate
  ON dji_fumigations (fumigation_date, source)
  WHERE parcel_id IS NULL;
