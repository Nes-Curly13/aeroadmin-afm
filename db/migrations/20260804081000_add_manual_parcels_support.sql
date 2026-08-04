-- ============================================================
-- Sprint 2026-08-04 — feature/parcel-onboarding (sub-sprint 1)
-- Soporte para alta manual de parcelas + campo "suerte".
--
-- Contexto:
--   El operador fumigador necesita poder crear parcelas sin
--   esperar a que DJI las reporte. Tres cambios:
--
--   1. `source` distingue parcelas DJI / manuales / importadas.
--      Sigue la convención ya usada en `dji_fumigations.source`
--      ('dji' | 'manual' | 'manual-api' | 'djicloud' | etc).
--
--   2. `batch_id` se vuelve nullable para que las parcelas manuales
--      (que no vienen de un import batch) puedan existir. La
--      constraint `unique (batch_id, external_id)` sigue
--      funcionando: con batch_id NULL no choca entre filas
--      (Postgres trata NULL != NULL en unique).
--
--   3. `luck_name` es la división interna de una hacienda
--      cañera en Valle del Cauca. Lo llena el supervisor al
--      crear o revisar la parcela. Es solo un atributo (no
--      una entidad separada) — si el dominio crece y una
--      suerte empieza a compartirse entre parcelas, se migra
--      a una tabla `dji_lucks` con FK.
--
-- Diseño geom editable (decisión QA 2026-08-04): la geometría
-- se puede re-dibujar con warning (PATCH endpoint separado,
-- ver `app/api/admin/parcels/[id]/geometry`). El check de
-- validez es laxo: solo `NOT ST_IsEmpty` (decisión QA).
-- ============================================================

ALTER TABLE dji_parcels
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'dji'
    CHECK (source IN ('dji', 'manual', 'imported'));

ALTER TABLE dji_parcels
  ALTER COLUMN batch_id DROP NOT NULL;

ALTER TABLE dji_parcels
  ADD COLUMN IF NOT EXISTS luck_name text
    CHECK (luck_name IS NULL OR length(luck_name) <= 100);

-- Backfill defensivo: por las dudas, dejamos source='dji' explícito
-- en los rows existentes (en realidad ya quedó con el DEFAULT).
UPDATE dji_parcels SET source = 'dji' WHERE source IS NULL;

-- Índices para los nuevos campos de filtro.
-- `source` se va a usar en el geovisor y en admin/parcels para
-- distinguir parcelas manuales vs DJI.
CREATE INDEX IF NOT EXISTS idx_dji_parcels_source
  ON dji_parcels(source)
  WHERE source <> 'dji';

-- `luck_name` se filtra por equality dentro de una finca.
CREATE INDEX IF NOT EXISTS idx_dji_parcels_luck_name
  ON dji_parcels(luck_name)
  WHERE luck_name IS NOT NULL;

-- Comentarios de documentación (psql los muestra con \d+).
COMMENT ON COLUMN dji_parcels.source IS
  'Origen del registro: dji (sync desde DJI SmartFarm), manual (UI alta manual), imported (import GIS batch). Default dji para compat con rows existentes.';

COMMENT ON COLUMN dji_parcels.luck_name IS
  'Suerte (división interna de una hacienda cañera, ej "Suerte 3"). Lo llena el supervisor. Si una suerte se reutiliza entre múltiples parcelas, migrar a una tabla `dji_lucks` con FK.';

COMMENT ON COLUMN dji_parcels.batch_id IS
  'FK al batch de import DJI. NULL para parcelas manuales e importadas (no vienen de un import batch).';
