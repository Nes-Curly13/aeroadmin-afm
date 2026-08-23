-- Migration: Extend dji_fumigations.source to include 'import_excel'
-- Date: 2026-08-22
-- Sprint: feature/excel-applications-import / Nivel 1
--
-- El operador fumigador lleva un Excel en `C:\Users\agFab\Downloads\Aplicaciones.xlsx`
-- con 2,635 registros de fumigaciones (sub-áreas tratadas) entre 2025 y 2026.
-- Esos registros son la fuente de verdad operacional que DJI no expone:
--   - Dosis (L/ha) — 610/642 fumigaciones DJI tienen dose_l_per_ha = NULL
--   - Volumen total (L) — DJI no persiste el campo
--   - TIPO APLICACION (vocabulario operativo: PRE/POST EMERGENTE, FUNGICIDA, etc.)
--   - Datos financieros: Nº factura, fecha, valor, cancelada
--   - Logistica: TRANSPORTE (placa), ZONA
--   - Horas planta
--
-- El Excel NO reemplaza a DJI; lo complementa. Cada fila del Excel representa
-- 1 sub-area tratada dentro de un vuelo de DJI. El matching es por la tupla
-- (fecha + drone_nickname + pilot_name + parcela_normalizada) contra
-- dji_flights, NO contra dji_fumigations (que es aggregate por dia).
--
-- Diseño:
--   - Nuevos valores del enum `source`: 'import_excel' (este sprint).
--     'manual' | 'djiscraper' | 'import' (ya existentes, se preservan).
--   - Los 9 campos nuevos del Excel se persisten en `notes->excel_source`
--     (jsonb) en el Nivel 1, sin migracion de columnas. Esto evita
--     contaminar dji_fumigations con data que el matching puede dejar
--     inconsistente. En el Nivel 3 migraremos los campos financieros
--     a una tabla propia `fumigation_invoices` y `liters_consumed` a
--     una columna real.
--   - El id del Excel no se preserva — el matching es por campos
--     derivados (fecha, drone, piloto, parcela). Si re-corre el script
--     con el mismo Excel, los UPSERTs deben ser idempotentes via
--     (parcel_id, fumigation_date, source) que es la unique key del
--     aggregate existente.
--   - El flag `_backfill` o `_excel_source` en `notes` permite que
--     la UI distinga fumigaciones importadas del Excel de las que
--     fueron creadas por la API manual o por el scraper DJI.
--
-- Rollback:
--   ALTER TABLE dji_fumigations DROP CONSTRAINT IF EXISTS dji_fumigations_source_check;
--   ALTER TABLE dji_fumigations ADD CONSTRAINT dji_fumigations_source_check
--     CHECK (source IN ('manual', 'djiscraper', 'import'));

BEGIN;

-- 1. Extender el CHECK constraint para incluir 'import_excel'
ALTER TABLE dji_fumigations
  DROP CONSTRAINT IF EXISTS dji_fumigations_source_check;

ALTER TABLE dji_fumigations
  ADD CONSTRAINT dji_fumigations_source_check
  CHECK (source IN ('manual', 'djiscraper', 'import', 'import_excel'));

-- 2. Documentar el shape del jsonb cuando source='import_excel'
COMMENT ON COLUMN dji_fumigations.notes IS
  'jsonb. Si source=''import_excel'', contiene {row:{file_hash, sheet, row_idx},
  invoice:{numero, fecha, valor_cop, cancelada}, transport:{plate, zona},
  application:{type, volume_l, area_ot}, match:{flight_id, score, method, at}}.';

COMMIT;
