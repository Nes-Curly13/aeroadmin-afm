-- 20260731000000_dji_flights_point_trigger.sql
--
-- Bug fix: la columna dji_flights.point existe con índice GIST
-- (idx_dji_flights_point) pero el UPSERT en
-- lib/djiag-flights-fetcher.js no la incluye en el INSERT. Por eso
-- point está NULL en 7710/7710 flights, lo que rompe
-- getFlightHullsByParcel en api/repositories.ts y hace que TODAS las
-- parcelas caigan al N-gon sintetico en lib/data.ts (capa 4 de la
-- cascada). Resultado visible: el geovisor muestra polígonos N-gon
-- en vez de los reales.
--
-- Fix: trigger BEFORE INSERT OR UPDATE que setea point desde lng/lat.
-- Cubre todos los INSERTs (fetcher, scripts manuales, e2e tests) sin
-- necesidad de cambiar el codigo que escribe.
--
-- Backfill incluido: los 7710 flights existentes se actualizan con
-- point = ST_SetSRID(ST_MakePoint(lng, lat), 4326).

CREATE OR REPLACE FUNCTION dji_flights_set_point()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lng IS NOT NULL AND NEW.lat IS NOT NULL THEN
    NEW.point := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
  ELSE
    NEW.point := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dji_flights_set_point ON dji_flights;
CREATE TRIGGER trg_dji_flights_set_point
BEFORE INSERT OR UPDATE OF lng, lat ON dji_flights
FOR EACH ROW EXECUTE FUNCTION dji_flights_set_point();

-- Backfill de los flights existentes. Idempotente: solo actualiza donde point es NULL.
UPDATE dji_flights
SET point = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
WHERE point IS NULL AND lng IS NOT NULL AND lat IS NOT NULL;
