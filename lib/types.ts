export type AlertLevel = "LOW" | "MEDIUM" | "HIGH";

/**
 * DjiParcelRecord — modelo normalizado (Opción B).
 * Una fila por campo/parcela, con columnas planas en lugar de JSONB.
 * Pensado para queries tipo "todos los orchards" sin escarbar raw_json.
 *
 * (S2 / 2026-07-01) El shape legacy `DjiAssetRecord` (3-rows-per-field) se eliminó.
 * El único caller del shape legacy era `getParcels()` que también se eliminó.
 * Si necesitas data de parcelas, usá `getParcelsNormalized()` que devuelve este type.
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
  // Direccion humana (viene de DJI, no la llena el supervisor).
  // Existe desde la migration 20260709000000.
  // Opcional en el type por la misma razon que crop_type et al.
  location_label?: string | null;
  // Metadata editable por el supervisor (migration 20260722000000).
  // DJI no expone estos datos — los llena el operador manualmente una vez
  // por parcela y se mantienen persistentes.
  // Opcionales en el type porque los fixtures de tests previos no los
  // incluyen; en runtime la query `djiParcelsQuery` siempre los trae
  // (con null si estan vacios).
  crop_type?: string | null;
  planting_date?: string | null;     // YYYY-MM-DD
  owner_name?: string | null;
  owner_contact?: string | null;
  supervisor_notes?: string | null;
  // Sprint A — F1.1: dot de cadencia por color. `last_fumigation_date`
  // viene de la fumigación real más reciente (no soft-deleted) vía
  // `LEFT JOIN LATERAL` con `dji_fumigations` en `djiParcelsQuery`.
  // `days_since_last_fumigation` se calcula en SQL (CURRENT_DATE - fecha)
  // para que el UI solo renderice, no compute.
  // null = "sin historial" (rojo). El UI distingue "vencida" (>30d) de
  // "nunca fumigada" (null) — son dos alertas distintas para el operador.
  last_fumigation_date?: string | null;
  days_since_last_fumigation?: number | null;
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
  /**
   * Nota libre del operador fumigador ("lluvia matinal", "producto nuevo",
   * "equipo reportó problema X"). Separada de `notes` (que es provenance
   * del backfill, JSON técnico, no visible al usuario).
   *
   * Track C v1.4 — audit ui-ux-2026-07 #11.
   */
  human_notes: string | null;
  recorded_by: string | null;
  /**
   * Compliance metadata (Sprint C — H2, 2026-07-23).
   *   - product_registered_ica: número de registro ICA del producto
   *     agroquímico aplicado (formato "ICA-1234-PN"). Lo llena el
   *     operador fumigador; validado por CHECK constraint.
   *   - pilot_license: licencia del piloto que operó el dron en
   *     esta fumigación (formato Aerocivil "PCA-12345" o "PC-1234567").
   *     Lo llena el operador fumigador; validado por CHECK regex.
   *
   * La matrícula del dron (HK-1234-UAV) vive en `dji_drone_models.registration_number`,
   * no en cada evento de fumigación — es 1 por dron, no 1 por vuelo.
   */
  product_registered_ica: string | null;
  pilot_license: string | null;
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

/**
 * Input row para la función pura de timeline (lib/fumigation-timeline.ts).
 * No depende de `pg` — el repository normaliza el row crudo a este shape.
 *
 * Por qué NO usar directamente `DjiFumigationEvent`:
 *   - `DjiFumigationEvent` representa 1 fila de `dji_fumigations`. La
 *     timeline necesita además el `drone_nickname` y `pilot_name`
 *     dominantes del día (que viven en `dji_flights` y se resuelven con
 *     un JOIN en el repository).
 *   - `duration_minutes` (columna) se convierte a `duration_seconds`
 *     para mantener consistencia con el resto de la app (Task History).
 */
export interface FumigationTimelineInput {
  id: number;
  /** YYYY-MM-DD (Bogota-local, ya normalizado en el boundary del repository). */
  fumigation_date: string;
  product_used: string | null;
  dose_l_per_ha: number | null;
  area_fumigated_m2: number | null;
  /** Convertido por el repository: `duration_minutes * 60`. */
  duration_seconds: number | null;
  drone_code_used: number | null;
  /** Drone nickname dominante del día (resuelto via JOIN con dji_flights). */
  drone_nickname: string | null;
  /** Piloto dominante del día (resuelto via JOIN con dji_flights). */
  pilot_name: string | null;
  recorded_by: string | null;
  notes: string | null;
  source: "manual" | "djiscraper" | "import";
}

/**
 * Evento de fumigación enriquecido para la vista de timeline.
 * Es el shape que consume el componente `ParcelTimeline` (UI).
 */
export interface FumigationEvent {
  id: number;
  date: string;             // YYYY-MM-DD
  month: string;            // YYYY-MM (para agrupación visual)
  productUsed: string | null;
  doseLPerHa: number | null;
  areaHa: number | null;    // m² → ha via lib/format.ts (consistente con Task History)
  durationSeconds: number | null;
  durationDjiFormat: string;
  droneCode: number | null;
  droneNickname: string | null;
  pilotName: string | null;
  recordedBy: string | null;
  notes: string | null;
  source: "manual" | "djiscraper" | "import";
}

/**
 * Output completo de la función pura de timeline.
 * Es lo que devuelve `lib/fumigation-timeline.ts` y consume el UI.
 */
export interface FumigationTimelineResult {
  events: FumigationEvent[];
  summary: {
    count: number;
    totalAreaHa: number;
    totalDurationSeconds: number;
    byMonth: Array<{
      yyyymm: string;
      count: number;
      areaHa: number;
      durationSeconds: number;
    }>;
    /** null si count < 2 (cadencia no es computable con < 2 puntos). */
    observedCadenceDays: number | null;
    /** null si no hay cadencia definida en el schedule del input. */
    expectedCadenceDays: number | null;
    /** Gaps > 60 días entre fumigaciones consecutivas (rango pedido). */
    gaps: Array<{
      from: string;     // YYYY-MM-DD
      to: string;       // YYYY-MM-DD
      days: number;
    }>;
  };
}

/** Constante compartida (también exportada desde lib/format.ts si la querés usar). */
export const FUMIGATION_GAP_THRESHOLD_DAYS = 60;

/**
 * Parcela con su schedule de fumigación y métricas de cadencia,
 * enriquecida con el flag `severity` (overdue | due_soon | ok | no_history)
 * para ordenamiento en la vista "Faltan por fumigar".
 *
 * Similar a `UpcomingFumigation` pero extendido con:
 *   - `severity` (semántica de overdue/due_soon/ok/no_history)
 *   - `area_fumigable_m2` y `waypoint_count` (de `dji_parcels`, para UI)
 *   - `area_fumigable_ha` derivado (m2 / 10000, helper precomputado)
 *
 * Lo que devuelve `getOverdueParcels()` en `api/repositories.ts`.
 */
export interface OverdueParcel {
  parcel_id: number;
  land_name: string | null;
  external_id: string;
  field_type: string;
  is_orchard: boolean;
  drone_model_name: string | null;
  crop_type: string;
  recommended_cadence_days: number;
  last_fumigation_date: string | null;
  next_due_date: string | null;
  /** Negativo = vencida. null = sin historial de fumigación. */
  days_until_next_due: number | null;
  severity: "overdue" | "due_soon" | "ok" | "no_history";
  /** null si la parcela no tiene spray_geometry calculada. */
  area_fumigable_m2: number | null;
  /** null si la parcela no tiene waypoints cargados. */
  waypoint_count: number | null;
  /** Precomputado: area_fumigable_m2 / 10000. null si m2 es null. */
  area_fumigable_ha: number | null;
}
