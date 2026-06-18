CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT
);

CREATE TABLE IF NOT EXISTS parcels (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  crop_type TEXT NOT NULL,
  planting_date DATE NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS flights (
  id SERIAL PRIMARY KEY,
  parcel_id INTEGER NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  area_covered NUMERIC(12, 2) NOT NULL CHECK (area_covered >= 0),
  image_url TEXT,
  footprint geometry(Polygon, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS dji_import_batches (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'djiag',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dji_land_assets (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES dji_import_batches(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  land_name TEXT NOT NULL,
  asset_kind TEXT NOT NULL,
  source_url TEXT NOT NULL,
  raw_json JSONB NOT NULL,
  geom geometry(Geometry, 4326)
);

CREATE TABLE IF NOT EXISTS dji_daily_summaries (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES dji_import_batches(id) ON DELETE CASCADE,
  record_date DATE NOT NULL,
  weekday TEXT,
  category TEXT NOT NULL,
  area_mu NUMERIC(12, 2) NOT NULL CHECK (area_mu >= 0),
  times_count INTEGER NOT NULL CHECK (times_count >= 0),
  usage_liters NUMERIC(12, 2) NOT NULL CHECK (usage_liters >= 0),
  work_time_text TEXT NOT NULL,
  raw_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dji_field_catalog (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES dji_import_batches(id) ON DELETE CASCADE,
  field_type TEXT NOT NULL,
  field_name TEXT NOT NULL,
  area_text TEXT NOT NULL,
  location_text TEXT NOT NULL,
  record_date DATE NOT NULL,
  raw_text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_parcels_client_id ON parcels(client_id);
CREATE INDEX IF NOT EXISTS idx_flights_parcel_id ON flights(parcel_id);
CREATE INDEX IF NOT EXISTS idx_parcels_geom ON parcels USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_flights_footprint ON flights USING GIST (footprint);
CREATE INDEX IF NOT EXISTS idx_dji_land_assets_batch_id ON dji_land_assets(batch_id);
CREATE INDEX IF NOT EXISTS idx_dji_daily_summaries_batch_id ON dji_daily_summaries(batch_id);
CREATE INDEX IF NOT EXISTS idx_dji_daily_summaries_date ON dji_daily_summaries(record_date);
CREATE INDEX IF NOT EXISTS idx_dji_land_assets_geom ON dji_land_assets USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_dji_field_catalog_batch_id ON dji_field_catalog(batch_id);
CREATE INDEX IF NOT EXISTS idx_dji_field_catalog_date ON dji_field_catalog(record_date);

-- ============================================================
-- DJI DRONE MODELS (lookup)
-- ============================================================
CREATE TABLE IF NOT EXISTS dji_drone_models (
  code INT PRIMARY KEY,
  name TEXT NOT NULL,
  manufacturer TEXT NOT NULL DEFAULT 'DJI',
  notes TEXT
);

INSERT INTO dji_drone_models (code, name, manufacturer, notes) VALUES
  (0,   'Sin asignar',           'DJI', 'No se detectó modelo de dron en el plan'),
  (72,  'Agras T16 / T20',       'DJI', 'Agras serie 16/20 — verificar con el operador'),
  (201, 'Agras T40 / T50',       'DJI', 'Agras serie 40/50 — verificar con el operador'),
  (210, 'Agras T70 / similar',   'DJI', 'Modelo no documentado — confirmar con el operador')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- DJI PARCELS (Opción B — modelo normalizado, 1 fila por campo)
-- ============================================================
CREATE TABLE IF NOT EXISTS dji_parcels (
  id                    SERIAL PRIMARY KEY,
  batch_id              INTEGER NOT NULL REFERENCES dji_import_batches(id) ON DELETE CASCADE,
  external_id           TEXT NOT NULL,
  land_name             TEXT,
  field_type            TEXT NOT NULL,
  declared_area_ha      NUMERIC(10, 4),
  spray_area_m2         NUMERIC(12, 2),
  drone_model_code      INT REFERENCES dji_drone_models(code) ON DELETE SET NULL,
  drone_model_name      TEXT,
  spray_width_m         NUMERIC(5, 2),
  work_speed_mps        NUMERIC(4, 2),
  optimal_heading_deg   NUMERIC(5, 2),
  radar_height_m        NUMERIC(4, 2),
  edge_offset_m         NUMERIC(4, 2),
  obstacle_offset_m     NUMERIC(4, 2),
  climb_height_m        NUMERIC(4, 2),
  no_spray_zone_m2      NUMERIC(12, 2),
  droplet_size          INT,
  sweep_direction       INT,
  is_orchard            BOOLEAN NOT NULL,
  uses_side_spray       BOOLEAN,
  spray_geom            geometry(MultiPolygon, 4326),
  reference_point       geometry(Point, 4326),
  waypoints             geometry(MultiPoint, 4326),
  waypoint_count        INT,
  source_url_geometry   TEXT,
  source_url_parameter  TEXT,
  source_url_waypoint   TEXT,
  raw_geometry          JSONB,
  raw_parameter         JSONB,
  raw_waypoint          JSONB,
  fetched_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_dji_parcels_batch_id     ON dji_parcels(batch_id);
CREATE INDEX IF NOT EXISTS idx_dji_parcels_drone        ON dji_parcels(drone_model_code);
CREATE INDEX IF NOT EXISTS idx_dji_parcels_field_type   ON dji_parcels(field_type);
CREATE INDEX IF NOT EXISTS idx_dji_parcels_is_orchard   ON dji_parcels(is_orchard);
CREATE INDEX IF NOT EXISTS idx_dji_parcels_spray_geom   ON dji_parcels USING GIST (spray_geom);
CREATE INDEX IF NOT EXISTS idx_dji_parcels_waypoints    ON dji_parcels USING GIST (waypoints);
CREATE INDEX IF NOT EXISTS idx_dji_parcels_ref_point    ON dji_parcels USING GIST (reference_point);
