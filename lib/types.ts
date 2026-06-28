export type AlertLevel = "LOW" | "MEDIUM" | "HIGH";

export interface DjiAssetRecord {
  id: number;
  external_id: string;
  land_name: string;
  asset_kind: string;
  source_url: string;
  raw_json: unknown;
  geometry: GeoJSON.Geometry | null;
}

/**
 * DjiParcelRecord — modelo normalizado (Opción B).
 * Una fila por campo/parcela, con columnas planas en lugar de JSONB.
 * Pensado para queries tipo "todos los orchards" sin escarbar raw_json.
 */
export interface DjiParcelRecord {
  id: number;
  external_id: string;
  land_name: string | null;
  field_type: "Farmland" | "Orchards" | string;
  declared_area_ha: number | null;
  spray_area_m2: number | null;
  drone_model_code: number | null;
  drone_model_name: string | null;
  spray_width_m: number | null;
  work_speed_mps: number | null;
  optimal_heading_deg: number | null;
  radar_height_m: number | null;
  edge_offset_m: number | null;
  obstacle_offset_m: number | null;
  climb_height_m: number | null;
  no_spray_zone_m2: number | null;
  droplet_size: number | null;
  sweep_direction: number | null;
  is_orchard: boolean;
  uses_side_spray: boolean | null;
  spray_geometry: GeoJSON.Geometry | null;
  reference_point: GeoJSON.Geometry | null;
  waypoints_geometry: GeoJSON.Geometry | null;
  waypoint_count: number | null;
  source_url_geometry: string | null;
  source_url_parameter: string | null;
  source_url_waypoint: string | null;
  fetched_at: string | null;
}

export interface DjiDailySummaryRecord {
  id: number;
  record_date: string;
  weekday: string | null;
  category: string;
  area_mu: number;
  times_count: number;
  usage_liters: number;
  work_time_text: string;
  raw_text: string;
}

export interface DjiFlightRecord {
  id: number;
  parcel_id: number;
  parcel_name: string;
  date: string;
  area_covered: number;
  image_url: string | null;
  footprint: GeoJSON.Geometry | null;
}

/**
 * Footprint minimo de una sortie individual de dji_flights.
 * Es solo el (lng, lat) del centroide en WGS84 — no incluye geometria
 * (el protobuf detallado de DJI sigue opaco hasta nuevo aviso).
 *
 * Sprint M6 (2026-06-28): se plotea como CircleMarker en /map dentro de
 * una capa toggleable "Vuelos (DJI AG)". El GIST index sobre `point` (oid
 * 4326) introducido en migracion `20260628100000_add_dji_flights_point_index.sql`
 * hace que esta query escale a >100k filas sin degradacion.
 */
export interface FlightPointRecord {
  flight_id: number;
  start_at: string;       // ISO 8601 (timestamptz -> string en boundary)
  lng: number;
  lat: number;
  drone_nickname: string | null;
  pilot_name: string | null;
  parcel_id: number | null;
  area_m2: number | null;
  spray_usage_ml: number | null;
}

export interface DjiAlertRecord {
  parcel_id: number;
  parcel_name: string;
  level: AlertLevel;
  age_days: number;
  message: string;
  geometry: GeoJSON.Geometry | null;
}

export interface DashboardMetrics {
  totalFlights: number;
  totalAreaCovered: number;
  highAlertParcels: number;
  totalAssets: number;
}

/**
 * Schedule de fumigación esperada para una parcela.
 * Una fila por parcela (1:1 con dji_parcels).
 */
export interface DjiFumigationSchedule {
  parcel_id: number;
  crop_type: string;
  recommended_cadence_days: number;
  last_fumigation_date: string | null;
  next_due_date: string | null;
  is_active: boolean;
  notes: string | null;
}

/**
 * Evento de fumigación realizado sobre una parcela.
 */
export interface DjiFumigationEvent {
  id: number;
  parcel_id: number;
  fumigation_date: string;
  product_used: string | null;
  dose_l_per_ha: number | null;
  area_fumigated_m2: number | null;
  drone_code_used: number | null;
  duration_minutes: number | null;
  notes: string | null;
  recorded_by: string | null;
  recorded_at: string;
  source: "manual" | "djiscraper" | "import";
}

/**
 * Parcela enriquecida con su schedule de fumigación y el evento más reciente.
 * Lo que devuelve el endpoint /api/fumigations/upcoming.
 */
export interface UpcomingFumigation {
  parcel_id: number;
  land_name: string | null;
  external_id: string;
  field_type: string;
  is_orchard: boolean;
  crop_type: string;
  recommended_cadence_days: number;
  last_fumigation_date: string | null;
  next_due_date: string | null;
  days_until_next_due: number | null;
  status: "ok" | "due_soon" | "overdue" | "no_history";
  drone_model_name: string | null;
}
