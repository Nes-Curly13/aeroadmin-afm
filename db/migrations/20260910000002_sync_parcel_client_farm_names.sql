-- Migration: Sync denormalized client_name/farm_name from FK
-- Date: 2026-09-10
--
-- Contexto (auditoría 2026-09-10, #49):
--   `dji_parcels` tiene el nombre del cliente/finca DUPLICADO:
--     - denormalizado: `client_name` / `farm_name` (TEXT) — lo que la UI
--       muestra y los filtros usan.
--     - normalizado: `client_id` / `farm_id` (FK a `clients` / `farms`,
--       Fase 3.A).
--   La app mantiene ambos en sync al escribir (`updateParcelMetadata`
--   deriva el nombre desde la FK), pero SQL directo / imports viejos
--   pueden haber dejado el texto desalineado con la FK.
--
-- Esta migration es un **one-time consistency fix**: para cada parcela
-- con FK seteado, re-escribe el nombre denormalizado con el nombre
-- canónico de la tabla referenciada, pero SOLO donde difiere (idempotente
-- y sin tocar las parcelas sin FK — esas conservan su texto legacy).
--
-- La decisión de fondo (¿vista calculada, trigger, o eliminar el
-- denormalizado?) queda como deuda de modelo en
-- `docs/DEEPSEEK-COORDINATION.md` §3 (#49) — requiere acuerdo antes de
-- tocar el schema.

-- Sync client_name desde clients.name
UPDATE dji_parcels p
   SET client_name = c.name
  FROM clients c
 WHERE p.client_id = c.id
   AND p.client_name IS DISTINCT FROM c.name;

-- Sync farm_name desde farms.name
UPDATE dji_parcels p
   SET farm_name = f.name
  FROM farms f
 WHERE p.farm_id = f.id
   AND p.farm_name IS DISTINCT FROM f.name;
