-- Migration: S7 schema extension (parte 2) — vehicle_plate en dji_fumigations
-- Date: 2026-08-24
-- Sprint: feature/s7-schema-extension / Fase 1 (PR-B)
--
-- Por que esta migration:
--   El operador fumigador registra fumigaciones manuales y necesita
--   capturar la placa del vehículo que usó para llegar a la finca.
--   En el plan original de Fase 1, se especuló con guardar la placa
--   en `dji_fumigations.notes->>vehicle_plate` (jsonb), pero
--   `dji_fumigations.notes` es TEXT, no jsonb (definido en
--   20260618110000_add_dji_fumigations.sql). Persistir un campo
--   estructurado en TEXT es frágil (parseo manual, queries
--   ineficientes, sin CHECK constraints).
--
--   Decisión: agregar `vehicle_plate VARCHAR(12) NULL` como columna
--   propia en `dji_fumigations`. Es:
--     - Indexable (queries/reportes por vehículo).
--     - Validable con CHECK (mismo regex que `dji_vehicles.plate`).
--     - Limpio: no se mezcla con `notes` (texto libre del operador).
--     - NO requiere FK a `dji_vehicles`: la placa es referencial
--       (puede haber fumigaciones con placas que aún no están en
--       el catálogo, o fumigaciones históricas con placas dadas
--       de baja del catálogo). El `VehiclePicker` se encarga de
--       sugerir/crear en `dji_vehicles` desde el form, pero la
--       fumigación solo guarda el string.
--
--   Por que NO en `dji_flights`:
--     El vehicle es per-flight en el modelo de datos (vehicle_id
--     ya existe en dji_flights, migration 20260824000000). Pero el
--     form de fumigación es per-fumigación (no per-vuelo), y
--     forzar al operador a registrar vuelos manuales para poder
--     capturar la placa es scope de otro sprint. Esta columna
--     captura el caso "registré una fumigación manual y usé el
--     vehículo XYZ" sin modelar vuelo.
--
--   Rollback:
--     ALTER TABLE public.dji_fumigations
--       DROP COLUMN IF EXISTS vehicle_plate;

BEGIN;

ALTER TABLE public.dji_fumigations
  ADD COLUMN IF NOT EXISTS vehicle_plate VARCHAR(12) NULL;

-- Mismo regex que dji_vehicles.plate (3-12 chars, A-Z 0-9 guion).
-- Permite clear (set to NULL) sin violar el check.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dji_fumigations_vehicle_plate_format'
  ) THEN
    ALTER TABLE public.dji_fumigations
      ADD CONSTRAINT dji_fumigations_vehicle_plate_format
      CHECK (
        vehicle_plate IS NULL
        OR vehicle_plate ~ '^[A-Z0-9-]{3,12}$'
      );
  END IF;
END$$;

-- Índice para queries/reportes futuros (ej: "todas las fumigaciones
-- de hoy con vehículo XYZ"). B-tree porque es equality/prefix.
CREATE INDEX IF NOT EXISTS dji_fumigations_vehicle_plate_idx
  ON public.dji_fumigations (vehicle_plate)
  WHERE vehicle_plate IS NOT NULL;

COMMIT;
