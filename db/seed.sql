-- AFM Flight GIS - Seed Data
-- Ejecutar después de schema.sql

-- =============================================================================
-- CLIENTES
-- =============================================================================
INSERT INTO clients (name, contact)
VALUES
  ('Ingenio Central', 'ops@ingeniocentral.com'),
  ('Cana Norte SAS', 'field@norte.example'),
  ('Agro valleys CIA', 'logistics@agrovalleys.com'),
  ('Hermanos Gutierrez', 'admin@gutierrez.com'),
  ('Cooperativa La Esperanza', 'cooperativa@laesperanza.com')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- PARCELAS - 10 parcelas distribuidas para tener diversi levels de alerts
-- HIGH: planting_date > 150 days (más de 5 meses)
-- MEDIUM: planting_date 90-150 days (3-5 meses)
-- LOW: planting_date < 90 days (menos de 3 meses)
-- =============================================================================
INSERT INTO parcels (client_id, name, crop_type, planting_date, geom)
VALES
  -- Cliente 1: Ingenio Central
  (
    1,
    'Suerte A-12',
    'Caña de azúcar',
    CURRENT_DATE - INTERVAL '172 days',
    ST_GeomFromText(
      'MULTIPOLYGON(((-76.538 3.456,-76.534 3.456,-76.534 3.452,-76.538 3.452,-76.538 3.456)))',
      4326
    )
  ),
  (
    1,
    'Suerte A-15',
    'Caña de azúcar',
    CURRENT_DATE - INTERVAL '165 days',
    ST_GeomFromText(
      'MULTIPOLYGON(((-76.542 3.458,-76.538 3.458,-76.538 3.454,-76.542 3.454,-76.542 3.458)))',
      4326
    )
  ),
  (
    1,
    'Suerte B-07',
    'Caña de azúcar',
    CURRENT_DATE - INTERVAL '124 days',
    ST_GeomFromText(
      'MULTIPOLYGON(((-76.532 3.454,-76.528 3.454,-76.528 3.45,-76.532 3.45,-76.532 3.454)))',
      4326
    )
  ),
  (
    1,
    'Suerte B-09',
    'Caña de azúcar',
    CURRENT_DATE - INTERVAL '98 days',
    ST_GeomFromText(
      'MULTIPOLYGON(((-76.53 3.452,-76.526 3.452,-76.526 3.448,-76.53 3.448,-76.53 3.452)))',
      4326
    )
  ),
  (
    1,
    'Suerte C-01',
    'Caña de azúcar',
    CURRENT_DATE - INTERVAL '45 days',
    ST_GeomFromText(
      'MULTIPOLYGON(((-76.528 3.45,-76.524 3.45,-76.524 3.446,-76.528 3.446,-76.528 3.45)))',
      4326
    )
  ),

  -- Cliente 2: Cana Norte SAS
  (
    2,
    'Lote Norte 01',
    'Caña de azúcar',
    CURRENT_DATE - INTERVAL '158 days',
    ST_GeomFromText(
      'MULTIPOLYGON(((-76.536 3.448,-76.532 3.448,-76.532 3.444,-76.536 3.444,-76.536 3.448)))',
      4326
    )
  ),
  (
    2,
    'Lote Norte 02',
    'Caña de azúcar',
    CURRENT_DATE - INTERVAL '115 days',
    ST_GeomFromText(
      'MULTIPOLYGON(((-76.534 3.446,-76.53 3.446,-76.53 3.442,-76.534 3.442,-76.534 3.446)))',
      4326
    )
  ),
  (
    2,
    'Lote Norte 03',
    'Caña de azúcar',
    CURRENT_DATE - INTERVAL '72 days',
    ST_GeomFromText(
      'MULTIPOLYGON(((-76.538 3.444,-76.534 3.444,-76.534 3.44,-76.538 3.44,-76.538 3.444)))',
      4326
    )
  ),

  -- Cliente 3: Agro valleys CIA
  (
    3,
    'Valle Este 05',
    'Caña de azúcar',
    CURRENT_DATE - INTERVAL '135 days',
    ST_GeomFromText(
      'MULTIPOLYGON(((-76.54 3.442,-76.536 3.442,-76.536 3.438,-76.54 3.438,-76.54 3.442)))',
      4326
    )
  ),
  (
    3,
    'Valle Este 08',
    'Caña de azúcar',
    CURRENT_DATE - INTERVAL '55 days',
    ST_GeomFromText(
      'MULTIPOLYGON(((-76.542 3.44,-76.538 3.44,-76.538 3.436,-76.542 3.436,-76.542 3.44)))',
      4326
    )
  ),

  -- Cliente 4: Hermanos Gutierrez (nueva parcela antigua para HIGH)
  (
    4,
    'Hacienda Sur',
    'Caña de azúcar',
    CURRENT_DATE - INTERVAL '180 days',
    ST_GeomFromText(
      'MULTIPOLYGON(((-76.544 3.438,-76.54 3.438,-76.54 3.434,-76.544 3.434,-76.544 3.438)))',
      4326
    )
  ),

  -- Cliente 5: Cooperativa La Esperanza
  (
    5,
    'Parcela Coop 01',
    'Caña de azúcar',
    CURRENT_DATE - INTERVAL '88 days',
    ST_GeomFromText(
      'MULTIPOLYGON(((-76.546 3.436,-76.542 3.436,-76.542 3.432,-76.546 3.432,-76.546 3.436)))',
      4326
    )
  ),
  (
    5,
    'Parcela Coop 02',
    'Caña de azúcar',
    CURRENT_DATE - INTERVAL '35 days',
    ST_GeomFromText(
      'MULTIPOLYGON(((-76.548 3.434,-76.544 3.434,-76.544 3.43,-76.548 3.43,-76.548 3.434)))',
      4326
    )
  )
ON CONFLICT DO NOTHING;

-- =============================================================================
-- VUELOS - Múltiples vuelos por parcela para histórico
-- =============================================================================
INSERT INTO flights (parcel_id, date, area_covered, image_url, footprint)
VALUES
  -- Suerte A-12 (parcela 1) - varios vuelos
  (
    1,
    CURRENT_DATE - INTERVAL '4 days',
    14.7,
    'https://images.unsplash.com/photo-1508615039623-a25605d2b022?auto=format&fit=crop&w=1200&q=80',
    ST_GeomFromText(
      'POLYGON((-76.5374 3.4554,-76.5344 3.4554,-76.5344 3.4525,-76.5374 3.4525,-76.5374 3.4554))',
      4326
    )
  ),
  (
    1,
    CURRENT_DATE - INTERVAL '18 days',
    13.2,
    'https://images.unsplash.com/photo-1473448912268-2022ce9509d8?auto=format&fit=crop&w=1200&q=80',
    ST_GeomFromText(
      'POLYGON((-76.5372 3.4552,-76.5342 3.4552,-76.5342 3.4523,-76.5372 3.4523,-76.5372 3.4552))',
      4326
    )
  ),

  -- Suerte A-15 (parcela 2)
  (
    2,
    CURRENT_DATE - INTERVAL '6 days',
    16.1,
    'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80',
    ST_GeomFromText(
      'POLYGON((-76.5408 3.4572,-76.5378 3.4572,-76.5378 3.4543,-76.5408 3.4543,-76.5408 3.4572))',
      4326
    )
  ),

  -- Suerte B-07 (parcela 3)
  (
    3,
    CURRENT_DATE - INTERVAL '8 days',
    11.3,
    'https://images.unsplash.com/photo-1473448912268-2022ce9509d8?auto=format&fit=crop&w=1200&q=80',
    ST_GeomFromText(
      'POLYGON((-76.5317 3.4536,-76.5284 3.4536,-76.5284 3.4504,-76.5317 3.4504,-76.5317 3.4536))',
      4326
    )
  ),

  -- Suerte B-09 (parcela 4)
  (
    4,
    CURRENT_DATE - INTERVAL '3 days',
    10.5,
    'https://images.unsplash.com/photo-1508615039623-a25605d2b022?auto=format&fit=crop&w=1200&q=80',
    ST_GeomFromText(
      'POLYGON((-76.5292 3.4515,-76.5262 3.4515,-76.5262 3.4486,-76.5292 3.4486,-76.5292 3.4515))',
      4326
    )
  ),

  -- Suerte C-01 (parcela 5)
  (
    5,
    CURRENT_DATE - INTERVAL '1 day',
    9.8,
    'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80',
    ST_GeomFromText(
      'POLYGON((-76.5272 3.4495,-76.5242 3.4495,-76.5242 3.4466,-76.5272 3.4466,-76.5272 3.4495))',
      4326
    )
  ),

  -- Lote Norte 01 (parcela 6)
  (
    6,
    CURRENT_DATE - INTERVAL '5 days',
    15.3,
    'https://images.unsplash.com/photo-1508615039623-a25605d2b022?auto=format&fit=crop&w=1200&q=80',
    ST_GeomFromText(
      'POLYGON((-76.5354 3.4475,-76.5324 3.4475,-76.5324 3.4446,-76.5354 3.4446,-76.5354 3.4475))',
      4326
    )
  ),

  -- Lote Norte 02 (parcela 7)
  (
    7,
    CURRENT_DATE - INTERVAL '12 days',
    12.9,
    'https://images.unsplash.com/photo-1473448912268-2022ce9509d8?auto=format&fit=crop&w=1200&q=80',
    ST_GeomFromText(
      'POLYGON((-76.5334 3.4455,-76.5304 3.4455,-76.5304 3.4426,-76.5334 3.4426,-76.5334 3.4455))',
      4326
    )
  ),

  -- Lote Norte 03 (parcela 8)
  (
    8,
    CURRENT_DATE - INTERVAL '2 days',
    11.7,
    'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80',
    ST_GeomFromText(
      'POLYGON((-76.5374 3.4435,-76.5344 3.4435,-76.5344 3.4406,-76.5374 3.4406,-76.5374 3.4435))',
      4326
    )
  ),

  -- Valle Este 05 (parcela 9)
  (
    9,
    CURRENT_DATE - INTERVAL '7 days',
    13.4,
    'https://images.unsplash.com/photo-1508615039623-a25605d2b022?auto=format&fit=crop&w=1200&q=80',
    ST_GeomFromText(
      'POLYGON((-76.5394 3.4415,-76.5364 3.4415,-76.5364 3.4386,-76.5394 3.4386,-76.5394 3.4415))',
      4326
    )
  ),

  -- Valle Este 08 (parcela 10)
  (
    10,
    CURRENT_DATE - INTERVAL '1 day',
    8.9,
    NULL,
    ST_GeomFromText(
      'POLYGON((-76.5414 3.4395,-76.5384 3.4395,-76.5384 3.4366,-76.5414 3.4366,-76.5414 3.4395))',
      4326
    )
  ),

  -- Hacienda Sur (parcela 11) - HIGH alert
  (
    11,
    CURRENT_DATE - INTERVAL '10 days',
    18.2,
    'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80',
    ST_GeomFromText(
      'POLYGON((-76.5434 3.4375,-76.5404 3.4375,-76.5404 3.4346,-76.5434 3.4346,-76.5434 3.4375))',
      4326
    )
  ),

  -- Parcela Coop 01 (parcela 12)
  (
    12,
    CURRENT_DATE - INTERVAL '5 days',
    10.1,
    'https://images.unsplash.com/photo-1473448912268-2022ce9509d8?auto=format&fit=crop&w=1200&q=80',
    ST_GeomFromText(
      'POLYGON((-76.5454 3.4355,-76.5424 3.4355,-76.5424 3.4326,-76.5454 3.4326,-76.5454 3.4355))',
      4326
    )
  ),

  -- Parcela Coop 02 (parcela 13)
  (
    13,
    CURRENT_DATE - INTERVAL '1 day',
    9.5,
    NULL,
    ST_GeomFromText(
      'POLYGON((-76.5474 3.4335,-76.5444 3.4335,-76.5444 3.4306,-76.5474 3.4306,-76.5474 3.4335))',
      4326
    )
  )
ON CONFLICT DO NOTHING;