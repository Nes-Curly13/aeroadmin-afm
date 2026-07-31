-- 20260731000001_backfill_declared_area.sql
--
-- s8.8+ (2026-07-31): 1213/1213 parcels en docker tienen declared_area_ha
-- NULL. Sin este dato, el N-gon sintetico de lib/data.ts usa el piso
-- (0.5 ha → 39.8m de radio) para TODAS, lo que produce polígonos
-- visualmente desproporcionados para parcelas chicas declaradas (0.1-2 ha)
-- en DJI.
--
-- Backfill a 1.0 ha como default conservador (suficiente para que el
-- N-gon tenga ~56m de radio y se vea proporcionado a la region). El
-- DJI scraper eventualmente traera el area real declarada; hasta
-- entonces este default evita polígonos ridículamente grandes.
--
-- Idempotente: solo actualiza donde declared_area_ha es NULL.
UPDATE dji_parcels
SET declared_area_ha = 1.0
WHERE declared_area_ha IS NULL
  AND deleted_at IS NULL;
