-- Migration: Sprint G2 — Hoja de vida completa
--
-- Agrega:
--   1. Columna `flight_ids integer[]` en `dji_fumigations` para trazabilidad
--      flight → fumigación. Solo se popula para fumigaciones del import
--      (source='import'); las manuales tienen NULL.
--   2. Tabla `dji_fumigation_schedule_history` para auditar cambios de
--      cadencia/cultivo a lo largo del tiempo.
--   3. Función + trigger sobre `dji_fumigation_schedule` (AFTER INSERT OR
--      UPDATE) que registra cada cambio automáticamente.
--
-- Decisiones:
--   - flight_ids es `integer[]` (no JSONB) para usar los operadores de
--     array nativos de Postgres (ANY, @>, &&) y para evitar el costo de
--     parseo JSON en queries frecuentes. GIN index en la columna
--     para queries tipo "qué fumigaciones usó el flight X".
--   - El trigger de history solo registra cambios de `cadence_days` o
--     `crop_type` (los otros campos del schedule se actualizan seguido
--     por el recalc automático de last/next_due_date y NO son
--     "decisiones" del operador).
--   - El history NO se popula retroactivamente en esta migration. Eso
--     lo hace `scripts/backfill-schedule-history.ts` después de correr
--     la migration. El script parsea git log para reconstruir el
--     estado histórico desde el primer commit.
--
-- No toca fumigaciones existentes (no UPDATE en la migration). El
-- backfill del flight_ids se hace re-corriendo `backfill-fumigations-
-- from-flights` después de la migration (commit 2 del sprint).

BEGIN;

-- ============================================================
-- 1. flight_ids en dji_fumigations
-- ============================================================

ALTER TABLE dji_fumigations
  ADD COLUMN IF NOT EXISTS flight_ids integer[];

COMMENT ON COLUMN dji_fumigations.flight_ids IS
  'Sprint G2 — array de dji_flights.id que originaron esta fumigación '
  'agregada del import (source=''import''). NULL para fumigaciones manuales '
  '(source=''manual'') o fumigaciones del import pre-G2 (backfill las '
  're-procesa con este campo populado).';

-- GIN index para queries tipo "qué fumigaciones usó el flight X" o
-- "esta fumigación incluye los flights A, B, C". Tamaño aceptable
-- porque la tabla tiene 639 rows en local y va a crecer a ~10k.
CREATE INDEX IF NOT EXISTS idx_dji_fumigations_flight_ids_gin
  ON dji_fumigations USING GIN (flight_ids)
  WHERE flight_ids IS NOT NULL;

-- ============================================================
-- 2. dji_fumigation_schedule_history
-- ============================================================

CREATE TABLE IF NOT EXISTS dji_fumigation_schedule_history (
  id bigserial PRIMARY KEY,
  parcel_id integer NOT NULL
    REFERENCES dji_parcels(id) ON DELETE CASCADE,
  -- OLD.* y NEW.* de los campos auditados. NULL cuando es el row
  -- inicial del backfill (no había un "antes" real).
  old_cadence_days integer,
  new_cadence_days integer,
  old_crop_type text,
  new_crop_type text,
  -- Metadata del cambio
  changed_by text,            -- email del usuario, 'djiag-import', 'backfill', etc.
  reason text,                -- motivo libre del cambio (futuro)
  -- Provenance retrospectiva. Para rows del trigger es NULL (NOW() default).
  -- Para rows del backfill es el commit_sha del último commit que afectó
  -- el schedule de esta parcela.
  commit_sha text,
  changed_at timestamp with time zone NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE dji_fumigation_schedule_history IS
  'Sprint G2 — auditoría de cambios de cadencia/cultivo. Una fila por '
  'cambio del schedule (cadence_days o crop_type). Permite reconstruir '
  '"esta parcela tenía cadencia 14 hasta el 2026-06-15, después 21".';

-- Index principal: por parcela, más reciente primero (UI timeline)
CREATE INDEX IF NOT EXISTS idx_dji_fumigation_schedule_history_parcel_changed
  ON dji_fumigation_schedule_history (parcel_id, changed_at DESC);

-- ============================================================
-- 3. Función + trigger sobre dji_fumigation_schedule
-- ============================================================

CREATE OR REPLACE FUNCTION log_dji_fumigation_schedule_change()
RETURNS TRIGGER AS $$
DECLARE
  v_cadence_changed boolean := false;
  v_crop_changed boolean := false;
BEGIN
  -- Solo registramos cambios de cadencia o cultivo. last_fumigation_date
  -- y next_due_date se actualizan seguido (cada vez que se inserta una
  -- fumigación) y NO son "decisiones" del operador.
  v_cadence_changed := (NEW.recommended_cadence_days IS DISTINCT FROM OLD.recommended_cadence_days);
  v_crop_changed := (NEW.crop_type IS DISTINCT FROM OLD.crop_type);

  IF NOT v_cadence_changed AND NOT v_crop_changed THEN
    RETURN NEW;
  END IF;

  INSERT INTO dji_fumigation_schedule_history (
    parcel_id,
    old_cadence_days, new_cadence_days,
    old_crop_type, new_crop_type,
    changed_by, reason,
    commit_sha,
    changed_at
  ) VALUES (
    NEW.parcel_id,
    CASE WHEN v_cadence_changed THEN OLD.recommended_cadence_days ELSE NULL END,
    CASE WHEN v_cadence_changed THEN NEW.recommended_cadence_days ELSE NULL END,
    CASE WHEN v_crop_changed THEN OLD.crop_type ELSE NULL END,
    CASE WHEN v_crop_changed THEN NEW.crop_type ELSE NULL END,
    current_setting('app.current_user_email', true), -- NULL si no seteada
    NULL,                                            -- razón libre (futuro)
    NULL,                                            -- commit_sha solo para backfill
    NOW()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION log_dji_fumigation_schedule_change() IS
  'Sprint G2 — trigger que registra cambios de cadencia/cultivo del '
  'schedule. Lee `app.current_user_email` (seteada por la app cuando '
  'hay sesión) para registrar QUIÉN hizo el cambio. No registra '
  'cambios automáticos de last/next_due_date (ruido).';

DROP TRIGGER IF EXISTS trg_dji_fumigation_schedule_change ON dji_fumigation_schedule;
CREATE TRIGGER trg_dji_fumigation_schedule_change
  AFTER INSERT OR UPDATE ON dji_fumigation_schedule
  FOR EACH ROW
  EXECUTE FUNCTION log_dji_fumigation_schedule_change();

-- Cuando se inserta un row inicial (caso seed o backfill), el trigger
-- registra el "primer" estado. Para el seed eso es desired (auditamos
-- que el schedule arrancó con X cadencia). Para el backfill manual
-- del history el script puede desactivar el trigger temporalmente.

COMMIT;
