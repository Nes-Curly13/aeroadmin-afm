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
