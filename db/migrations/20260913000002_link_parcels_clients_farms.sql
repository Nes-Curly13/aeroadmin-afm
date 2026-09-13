-- Migration: Link dji_parcels to clients/farms by name (OE1)
-- Date: 2026-09-13
--
-- Contexto: la jerarquía Cliente→Finca→Parcela existe (FKs desde Fase
-- 3.A) pero `dji_parcels.client_id`/`farm_id` quedaron en 0/1237: el
-- backfill de catálogo (`backfill-clients-farms.js`) crea los clientes/
-- fincas pero NO linkea las parcelas.
--
-- Esta migration:
--   1) Linkea client_id por match de nombre (case/trim-insensitive).
--   2) Linkea farm_id por nombre de finca (respetando el cliente).
--   3) Normaliza el texto denormalizado al nombre canónico del catálogo
--      (deja drift = 0 para el invariant #49).
--
-- Idempotente: solo actúa sobre NULLs / valores que difieren.

-- 1) client_id por nombre
UPDATE dji_parcels p
   SET client_id = c.id
  FROM clients c
 WHERE p.client_id IS NULL
   AND p.client_name IS NOT NULL
   AND TRIM(p.client_name) <> ''
   AND LOWER(TRIM(c.name)) = LOWER(TRIM(p.client_name));

-- 2) farm_id por nombre (si la parcela tiene cliente, la finca debe ser de ese cliente)
UPDATE dji_parcels p
   SET farm_id = f.id
  FROM farms f
 WHERE p.farm_id IS NULL
   AND p.farm_name IS NOT NULL
   AND TRIM(p.farm_name) <> ''
   AND LOWER(TRIM(f.name)) = LOWER(TRIM(p.farm_name))
   AND (p.client_id IS NULL OR f.client_id = p.client_id);

-- 3) Normalizar client_name al nombre canónico (drift #49 = 0)
UPDATE dji_parcels p
   SET client_name = c.name
  FROM clients c
 WHERE p.client_id = c.id
   AND p.client_name IS DISTINCT FROM c.name;

-- 4) Normalizar farm_name al nombre canónico
UPDATE dji_parcels p
   SET farm_name = f.name
  FROM farms f
 WHERE p.farm_id = f.id
   AND p.farm_name IS DISTINCT FROM f.name;
