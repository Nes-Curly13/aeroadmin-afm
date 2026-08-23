-- Migration: S7 schema extension — captura de 9 campos manuales del operador
-- Date: 2026-08-24
-- Sprint: feature/s7-schema-extension / Fase 0
--
-- Por que esta migration:
--   El operador fumigador vuela drones y al final del dia llena un Excel
--   con 9-10 campos que DJI SmartFarm no expone (volumen, transporte, zona,
--   horas_planta, area_ot, tipo de aplicacion, factura). Para que pueda
--   capturar esos campos en la UI web en lugar del Excel, necesitamos:
--
--   1. dji_vehicles        (catalogo de placas de vehiculos de transporte)
--   2. application_types    (catalogo de fase/uso: pre/post emergencia, etc.)
--   3. dji_flights.*       (4 cols: vehicle_id, zona, horas_planta, area_ot_m2)
--   4. dji_fumigations.*   (1 col: application_type_id)
--   5. fumigation_invoices  (tabla 1:N con fumigaciones, 5 cols financieras)
--
-- Decisiones de diseno:
--   - Las 4 cols operativas van en dji_flights (NO en dji_fumigations)
--     porque son por-vuelo, no por-fumigacion-aggregate. Asi un vuelo
--     puede tener su propia zona y vehiculo sin contaminar el aggregate.
--   - application_types es ORTOGONAL a fumigation_categories: una
--     fumigacion puede tener AMBOS (category_id = tipo de producto,
--     application_type_id = fase/uso). NO infla fumigation_categories
--     porque pre/post emergencia son timing, no tipo de producto.
--   - fumigation_invoices es una tabla 1:N (no jsonb en notes) porque:
--     (a) una fumigacion puede tener multiples facturas (cuotas)
--     (b) los datos financieros se consultan / filtran / reportan
--     (c) requieren CHECK constraints mas estrictos (amount >= 0)
--   - volumen NO requiere columna: ya se calcula como
--     dji_flights.spray_usage_ml / 1000 (lib/dji-flights-aggregate.ts).
--   - NO hay backfill de data historica (el sistema arranca limpio).
--   - Todas las cols nuevas son NULLABLE para no romper fumigaciones
--     existentes.
--
-- Rollback (NO ejecutar a menos que sea necesario):
--   DROP TABLE IF EXISTS public.fumigation_invoices CASCADE;
--   DROP TABLE IF EXISTS public.application_types CASCADE;
--   DROP TABLE IF EXISTS public.dji_vehicles CASCADE;
--   ALTER TABLE public.dji_flights
--     DROP COLUMN IF EXISTS vehicle_id,
--     DROP COLUMN IF EXISTS zona,
--     DROP COLUMN IF EXISTS horas_planta,
--     DROP COLUMN IF EXISTS area_ot_m2;
--   ALTER TABLE public.dji_fumigations
--     DROP COLUMN IF EXISTS application_type_id;

BEGIN;

-- ============================================================
-- 1. Catalogo dji_vehicles
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dji_vehicles (
  id           BIGSERIAL PRIMARY KEY,
  plate        TEXT NOT NULL UNIQUE
               CHECK (plate ~ '^[A-Z0-9-]{3,12}$'),
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.dji_vehicles IS
  'Catalogo curado de vehiculos de transporte entre fincas (placas). El operador fumigador carga la placa del vehiculo que uso para llegar a cada vuelo.';

-- Seed minimo: vacio. El operador fumigador agrega las placas a medida que
-- las usa. El form tiene un autocomplete con busqueda.

-- ============================================================
-- 2. Catalogo application_types
-- ============================================================
CREATE TABLE IF NOT EXISTS public.application_types (
  id          SERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'slate',
  sort_order  INT  NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.application_types IS
  'Catalogo curado de tipo de aplicacion (fase/uso). Ortogonal a fumigation_categories (tipo de producto). Una fumigacion puede tener AMBOS: category_id=tipo de producto, application_type_id=fase/uso.';

INSERT INTO public.application_types (slug, label, color, sort_order) VALUES
  ('pre_emergente',   'Pre emergente',   'amber',  10),
  ('post_emergente',  'Post emergente',  'orange', 20),
  ('bioestimulante',   'Bioestimulante',   'green',  30),
  ('otro',             'Otro',             'slate',  99)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- 3. Columnas en dji_flights (4 cols por-vuelo)
-- ============================================================
ALTER TABLE public.dji_flights
  ADD COLUMN IF NOT EXISTS vehicle_id    BIGINT
    REFERENCES public.dji_vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS zona          TEXT,
  ADD COLUMN IF NOT EXISTS horas_planta  NUMERIC(8,2)
    CHECK (horas_planta IS NULL OR horas_planta >= 0),
  ADD COLUMN IF NOT EXISTS area_ot_m2    NUMERIC(12,2)
    CHECK (area_ot_m2 IS NULL OR area_ot_m2 >= 0);

CREATE INDEX IF NOT EXISTS idx_dji_flights_vehicle
  ON public.dji_flights(vehicle_id)
  WHERE vehicle_id IS NOT NULL;

COMMENT ON COLUMN public.dji_flights.vehicle_id IS
  'Vehiculo de transporte (FK a dji_vehicles). NULL = sin registrar. El operador lo llena al final del dia.';
COMMENT ON COLUMN public.dji_flights.zona IS
  'Zona o localizacion operativa dentro de la hacienda (texto libre). NULL = sin registrar.';
COMMENT ON COLUMN public.dji_flights.horas_planta IS
  'Horas planta de procesamiento de cana. NULL = sin registrar. Rara vez usado.';
COMMENT ON COLUMN public.dji_flights.area_ot_m2 IS
  'Area OT (m2): area adicional o fuera de tarea, registrada por el operador. NULL = sin registrar. Solo historico 2025.';

-- ============================================================
-- 4. Columna en dji_fumigations (1 col por-fumigacion aggregate)
-- ============================================================
ALTER TABLE public.dji_fumigations
  ADD COLUMN IF NOT EXISTS application_type_id INT
    REFERENCES public.application_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dji_fumigations_application_type
  ON public.dji_fumigations(application_type_id)
  WHERE application_type_id IS NOT NULL;

COMMENT ON COLUMN public.dji_fumigations.application_type_id IS
  'Tipo de aplicacion (FK a application_types). NULL = fumigacion sin clasificar operacionalmente. Ortogonal a category_id.';

-- ============================================================
-- 5. Tabla fumigation_invoices (1:N con fumigaciones)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.fumigation_invoices (
  id              BIGSERIAL PRIMARY KEY,
  fumigation_id   BIGINT NOT NULL
                  REFERENCES public.dji_fumigations(id) ON DELETE CASCADE,
  invoice_number  TEXT NOT NULL
                  CHECK (length(invoice_number) BETWEEN 1 AND 50),
  invoiced_at     DATE NOT NULL,
  amount_cop      NUMERIC(14,2) NOT NULL CHECK (amount_cop >= 0),
  cancelled       BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled_at    TIMESTAMPTZ,
  cancelled_by    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (fumigation_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_fumigation_invoices_fumigation
  ON public.fumigation_invoices(fumigation_id);
CREATE INDEX IF NOT EXISTS idx_fumigation_invoices_invoiced_at
  ON public.fumigation_invoices(invoiced_at DESC);

COMMENT ON TABLE public.fumigation_invoices IS
  'Facturas de fumigaciones (1:N). El operador fumigador llena los datos cuando admin contable le manda la factura. Una fumigacion puede tener multiples facturas (cuotas).';
COMMENT ON COLUMN public.fumigation_invoices.invoice_number IS
  'Numero de factura (string libre, ej "FVE 2051"). UNIQUE por fumigacion.';
COMMENT ON COLUMN public.fumigation_invoices.amount_cop IS
  'Valor en pesos colombianos. CHECK >= 0. El cliente factura en pesos, no en USD.';
COMMENT ON COLUMN public.fumigation_invoices.cancelled IS
  'TRUE = factura cancelada (anulada, no cobrada). NO confundir con dji_fumigations.deleted_at (que es soft-delete de la fumigacion).';

COMMIT;
