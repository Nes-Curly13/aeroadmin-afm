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
  /**
   * Origen del registro. Migration 20260804081000 lo agregó a `dji_parcels`.
   * - `dji`: scrapeado de DJI SmartFarm
   * - `manual`: creado desde la UI (`/admin/parcels/new`)
   * - `imported`: import GIS batch (sub-sprint 2, pendiente)
   *
   * Por qué es opcional: queries viejos que no proyectan `source` siguen
   * compilando. El adapter (`adaptParcel` en `lib/data.ts`) lo trata como
   * `"dji"` por default (compat con fixtures de tests pre-existentes).
   */
  source?: "dji" | "manual" | "imported" | string;
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
  // v2.1 (sprint S6.1 — V0 events map) — cadencia esperada por parcela.
  // Viene de la tabla `dji_fumigation_schedule` (LEFT JOIN en
  // `djiParcelsQuery`). Null si la parcela todavía no tiene schedule
  // creado — el caller (`toMapParcelView`) cae al default
  // Farmland=14d / Orchards=10d.
  recommended_cadence_days?: number | null;
  // v2.1 (sprint S6.1 — V0 events map) — campos del V0 que nuestro schema
  // NO tiene. La query los proyecta como `NULL` literal hasta que se
  // agreguen las tablas/columnas correspondientes. Opcionales y siempre
  // null por ahora — el `toMapParcelView` los pasa tal cual a
  // `MapParcelView` y los filtros (`uniqueClients`, `uniqueFarms`) los
  // ignoran. Cuando los datos estén disponibles, el caller (filtros
  // client-side) se "despierta" sin cambios de UI.
  //
  // Mapeo previsto (ver `MapParcelView` para el shape público):
  //   - client_name   →  clients.name        (no existe aún)
  //   - farm_name     →  farms.name          (no existe aún)
  //   - municipality  →  reverse-geocoding   (no existe aún)
  //   - variety       →  crop_type detail    (parcial: `crop_type` ya existe)
  client_name?: string | null;
  farm_name?: string | null;
  municipality?: string | null;
  variety?: string | null;
  // Sprint "Crop time / fase de cultivo" (2026-08-01). Nullable hasta
  // que se popule `planting_date` (1213/1213 parcelas hoy). Si la
  // migration 20260801000000_add_planting_date_and_season.sql no se
  // aplicó, este campo no existe en la BD y el query de cycle data
  // (`getParcelsCycleData` en api/repositories.ts) lo captura con
  // try/catch. NO se agrega a `djiParcelsQuery` (la query cacheada del
  // dataset) para no romper el cache si la migration no corrió.
  cycle_phase?: string | null;
}

/** Fase del cultivo (sprint 2026-08-01). Ver lib/crop-cycle.ts. */
export type CyclePhase = "establecimiento" | "vegetativa" | "madurante" | "cosecha";

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
  /**
   * Sprint S9 (2026-08-29) — feature/s9-product-picker-wireup. FK a
   * `products.id` cuando el operador seleccionó el producto del catálogo
   * via `ProductPicker`. NULL si la fumigación se cargó con texto libre
   * (caso legacy o fumigaciones del backfill de S7). Convive con
   * `product_used` (texto histórico) — el FK es la versión normalizada.
   */
  product_id: number | null;
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
  /**
   * Sprint 2026-08-13 — feature/fumigacion-detail-v2 / sub-2.
   * Categoría curada de la fumigación (FK a `fumigation_categories`).
   * NULL para fumigaciones históricas (pre-migration 20260813160000)
   * — la UI las muestra como "Sin clasificar".
   */
  category_id?: number | null;
  /**
   * Soft-delete (sprint 2026-08-13 — feature/fumigacion-detail-v2 /
   * sub-4). NULL = fumigación activa. NO NULL = soft-deleted. Solo
   * lo hidrata `getFumigationRawById()` (usado por audit log y por
   * el endpoint restore). `getFumigationById` filtra estos rows
   * fuera, así que para fumigaciones activas en lectura normal
   * estos campos son undefined.
   *
   * Sprint 2026-08-15 — feature/fumigation-audit-log. Agregado al
   * type para que el audit log pueda diferenciar "create" vs "no-op
   * create" sin un query extra.
   */
  deleted_at?: string | null;
  deleted_by?: string | null;
  /**
   * Catálogo de la categoría, hidratado vía LEFT JOIN con
   * `fumigation_categories` en los queries de lectura. Undefined si
   * la fumigación no tiene categoría (category_id IS NULL).
   */
  category?: FumigationCategory | null;
  /**
   * Sprint S7 — feature/s7-schema-extension / Fase 0.
   * Tipo de aplicación (FK a `application_types`). Ortogonal a
   * `category_id` (producto vs fase/uso). NULL si la fumigación no
   * fue clasificada operacionalmente. La UI lo renderiza como
   * badge en la card.
   *
   * Lo hidrata `getFumigationById` y `getFumigationEventsByParcel`
   * con LEFT JOIN a `application_types`.
   */
  application_type_id?: number | null;
  /**
   * Catálogo de application_type, hidratado vía LEFT JOIN. Mismo
   * patrón que `category` arriba. Undefined si la fumigación no
   * tiene application_type_id o si la categoría está inactiva.
   */
  application_type?: ApplicationType | null;
  /**
   * Sprint S7 — array de facturas asociadas a esta fumigación.
   * Lo hidrata `getFumigationById` con un subquery que agrega los
   * `fumigation_invoices` (ordenados por `invoiced_at DESC`).
   * Undefined o [] para fumigaciones sin facturas.
   */
  invoices?: FumigationInvoice[] | null;
  /**
   * Sprint G2 — array de dji_flights.id que originaron esta fumigación
   * del import. NULL o undefined para fumigaciones manuales o
   * pre-Sprint-G2. Lo popula `scripts/backfill-fumigations-from-
   * flights.js` (commit `eb7924b`). Usado por la sección de
   * Trazabilidad del UI.
   */
  flight_ids?: number[] | null;
  /**
   * Sprint S7 / Fase 1 (PR-B) — placa del vehículo usado en esta
   * fumigación, persistida en `dji_fumigations.notes->>vehicle_plate`
   * (jsonb). Es un campo DERIVADO (no vive en una columna propia) —
   * la fumigación NO tiene FK directa a `dji_vehicles` porque el
   * vehicle es per-flight en el modelo de datos. Workaround temporal:
   * la placa queda accesible en `notes` para el form de fumigación
   * sin tocar el modelo.
   *
   * El Picker (`VehiclePicker`) sugiere desde `dji_vehicles` y crea
   * on-the-fly si la placa no existe. El PATCH/POST lo guarda con
   * `jsonb_set(notes, '{vehicle_plate}', $1)`.
   */
  vehicle_plate?: string | null;
  /**
   * s8.8 (2026-07-31) — coordenadas geograficas para renderizar el
   * evento en el mapa del geovisor. Calculadas como centroide de los
   * flights asociados en `getRecentFumigations` (LEFT JOIN con
   * dji_flights por flight_ids). NULL si la fumigacion no tiene
   * flights asociados o si el JOIN no encuentra match (el evento
   * NO deberia renderizarse en el mapa en ese caso).
   *
   * IMPORTANTE: este campo NO vive en la BD — es derivado del JOIN
   * en el query. Se calcula una vez por fumigacion por request.
   */
  lng?: number | null;
  lat?: number | null;
  /**
   * s8.8 (2026-07-31) — numero de flights del JOIN que encontraron
   * match. Util para mostrar en el popup del geovisor ("5 de 7 flights
   * asociados" o "sin match — la fumigacion no tiene flights en BD").
   */
  n_matched_flights?: number | null;
}

/**
 * Categoría curada de fumigación. Vive en la tabla `fumigation_categories`
 * (migration 20260813160000). El operador fumigador la elige al registrar
 * una fumigación manual; las fumigaciones históricas (pre-migration)
 * quedan con category_id=NULL.
 *
 * El `color` es una sugerencia semántica (red/green/amber/...) que la UI
 * mapea a tokens de Tailwind para el badge. No es el color definitivo
 * de cada fumigación — la UI puede ignorarlo.
 */
export interface FumigationCategory {
  id: number;
  slug: string;
  label: string;
  color: string;
  sort_order: number;
  is_active: boolean;
}

/**
 * Tipo de aplicación (fase/uso). Vive en la tabla `application_types`
 * (migration 20260824000000). Ortogonal a `fumigation_categories`:
 * - `category` describe el TIPO de producto (herbicida, insecticida, ...)
 * - `application_type` describe la FASE / USO (pre-emergente, post-emergente,
 *   bioestimulante, otro)
 *
 * Una fumigación puede tener AMBOS. Por ejemplo: "Glifosato 48% (herbicida)
 * en pre-emergente". El operador llena ambos campos en el form.
 *
 * `color` es semántica (amber/orange/green/slate) que la UI mapea a
 * tokens de Tailwind para el badge.
 */
export interface ApplicationType {
  id: number;
  slug: string;
  label: string;
  color: string;
  sort_order: number;
  is_active: boolean;
}

/**
 * Vehículo de transporte entre fincas. Vive en la tabla `dji_vehicles`
 * (migration 20260824000000). El operador fumigador carga la placa del
 * vehículo que usó para llegar a cada vuelo. Catálogo curado (no
 * cualquiera puede agregar — se mantiene consistencia de `plate` con
 * CHECK constraint regex en la BD).
 *
 * - `is_active = FALSE` = soft-archived (no se ofrece en dropdowns,
 *   pero fumigaciones históricas siguen referenciando el row).
 * - `description` es texto libre opcional (ej "Toyota Hilux 2020 blanca").
 */
export interface DjiVehicle {
  id: number;
  plate: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

/**
 * Producto comercial fumigado. Vive en la tabla `products` (migration
 * 20260829000000). El operador selecciona del catalogo curado o crea
 * uno nuevo desde la UI (autocomplete con opcion "+ Crear '<texto>'").
 *
 * - `name` UNIQUE por LOWER(TRIM(name)) — previene duplicados por typo
 * - `category` es el tipo de producto (herbicida, insecticida, etc.)
 * - `active_ingredient` es el ingrediente activo (e.g. "Glifosato").
 *   Varios productos pueden compartir el mismo IA (Glifosato 48% LCE
 *   y Roundup 36% SL son ambos Glifosato).
 * - `ica_registration` es el numero de registro ICA (regulatorio)
 * - `display_color` es hex opcional para el chip en la UI
 *
 * Las fumigaciones existentes con `dji_fumigations.product_used` text
 * siguen funcionando. La nueva columna `product_id` (FK opcional) se
 * popula cuando el operator usa el selector del catalogo.
 */
export type ProductCategory =
  | "herbicida"
  | "insecticida"
  | "fertilizante"
  | "fungicida"
  | "bioestimulante"
  | "otro";

export interface DjiProduct {
  id: number;
  name: string;
  category: ProductCategory;
  active_ingredient: string | null;
  ica_registration: string | null;
  display_color: string | null;
  notes: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Factura de una fumigación. Una fumigación puede tener N facturas
 * (cuotas, pagos parciales, anulaciones con re-factura). Vive en
 * la tabla `fumigation_invoices` (migration 20260824000000).
 *
 * - `cancelled = TRUE` = factura anulada (NO cobrada). NO confundir
 *   con `dji_fumigations.deleted_at` (que es soft-delete de la
 *   fumigación completa, no de la factura).
 * - `amount_cop` está en pesos colombianos (el cliente factura en
 *   pesos, no en USD).
 * - `invoiced_at` es DATE (no timestamptz) porque la fecha de
 *   factura es siempre día-completo, no hora.
 */
export interface FumigationInvoice {
  id: number;
  fumigation_id: number;
  invoice_number: string;
  invoiced_at: string;     // YYYY-MM-DD
  amount_cop: number;      // COP, no centavos
  cancelled: boolean;
  cancelled_at: string | null;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Sprint feature/fumigation-audit-log (2026-08-15) — acciones posibles
 * en la tabla `fumigation_audit_log`. Mantenemos como `type` string
 * union para que el caller tenga type-safety en código (en BD es TEXT
 * con CHECK constraint que valida los mismos 4 valores).
 *
 * Decisión de no usar ENUM de Postgres: si en el futuro se agrega un
 * action nuevo (e.g. 'exported' para registrar un download de PDF),
 * NO requiere una migration destructiva (ALTER TYPE ADD VALUE es
 * pesado en tablas grandes). Validamos en código y en el CHECK.
 */
export type FumigationAuditAction =
  | "created"
  | "edited"
  | "deleted"
  | "restored";

/**
 * Un evento de auditoría de fumigación. Append-only: solo INSERT,
 * nunca UPDATE ni DELETE en operación normal. La tabla es
 * `fumigation_audit_log` (migration 20260815000000).
 *
 * El `changes` es JSONB cuyo shape depende del `action`:
 *   - 'created'  : { fields: { fumigation_date, product_used, ... } }
 *                  — snapshot del evento creado.
 *   - 'edited'   : { diff: { product_used: { from, to }, ... } }
 *                  — solo los campos que efectivamente cambiaron.
 *   - 'deleted'  : { snapshot: { product_used, dose_l_per_ha, ... } }
 *                  — qué se borró (contexto para entender el delete).
 *   - 'restored' : { restored_from: { deleted_at, deleted_by } }
 *                  — metadata del estado soft-deleted del que salió.
 *
 * Los `from`/`to` en `edited` son los valores normalizados (mismo
 * shape que el row de `dji_fumigations`), no el raw input del PATCH.
 */
export interface FumigationAuditEvent {
  id: number;
  fumigation_id: number;
  action: FumigationAuditAction;
  actor_email: string;
  changes: Record<string, unknown>;
  created_at: string;
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

// ---------------------------------------------------------------------------
// V0 types — port del mockup docs/fumigation-management-dashboard.
// El adapter en `lib/data.ts` (V0) traduce los rows del proyecto a estos
// shapes para que los componentes del V0 (dashboard, geovisor, parcelas)
// funcionen sin cambios.
// ---------------------------------------------------------------------------

export type DroneModelId = 0 | 72 | 201 | 210;

export type FumigationSource = "manual" | "import" | "djiscraper";

/** dji_parcels — 1 fila por campo, columnas planas + geometría (V0 shape). */
export interface DjiParcel {
  id: string;
  dji_land_id: string;
  name: string;
  farm_name: string;
  client_name: string;
  municipality: string;
  area_ha: number;
  variety: string;
  drone_model_id: DroneModelId;
  centroid_lng: number;
  centroid_lat: number;
  /** geometry(Polygon, 4326) serializada como GeoJSON */
  geom: { type: "Polygon"; coordinates: [number, number][][] };
  created_at: string;
  is_active: boolean;
  // Sprint 2026-08-04 — feature/parcel-onboarding. Migration
  // 20260804081000_add_manual_parcels_support.sql agrega la columna
  // `source` a `dji_parcels` ('dji' default | 'manual' | 'imported').
  // Cableado end-to-end: la proyecta `djiParcelsQuery` (api/queries.ts),
  // la propaga `adaptParcel` (lib/data.ts) con default "dji" para
  // compat con fixtures viejos. El detail page la usa para ocultar
  // `dji_land_id` cuando source='manual' (no tiene sentido mostrar
  // un ID de DJI en una parcela que DJI no conoce).
  source?: "dji" | "manual" | "imported" | string;
  // Sprint "Crop time / fase de cultivo" (2026-08-01). Null hasta que
  // se popule planting_date (lo llena el supervisor). Los chips de UI
  // ("Fase: vegetativa", "Fase: desconocida") leen `cycle_phase`. Si
  // la migration no se aplicó, ambos campos son null y la UI degrada
  // a "Fase: desconocida".
  planting_date?: string | null;     // YYYY-MM-DD
  cycle_phase?: CyclePhase | null;
}

/**
 * dji_parcels extendido con metadata de fase de cultivo.
 * Sprint 2026-08-01. Lo retorna `getParcelsWithCycle()` en lib/data.ts.
 * Backward compat: extender un type con dos campos opcionales no rompe
 * a callers que solo usan `DjiParcel`.
 */
export type DjiParcelWithCycle = DjiParcel & {
  planting_date: string | null;
  cycle_phase: CyclePhase | null;
};

/** dji_fumigation_schedule — cadencia esperada (1:1 con dji_parcels). */
export interface DjiFumigationScheduleV0 {
  parcel_id: string;
  cadence_days: number;
  product: string;
  /**
   * Dosis en L/ha. `null` cuando el scraper DJI no la expone
   * (95% del dataset histórico actual — ver
   * `docs/audit/DOSE_FIELDS_BACKFILL.md`). La UI debe renderizar
   * `null` como "—" o con un callout, **nunca** inventar un valor
   * default porque confunde al operador (el cual cree que el dato
   * es real cuando es ficticio).
   */
  dose_l_ha: number | null;
  window_start_hour: number;
  window_end_hour: number;
  updated_at: string;
}

/** dji_fumigations — eventos realizados por parcela (V0 shape). */
export interface DjiFumigationV0 {
  id: string;
  parcel_id: string;
  executed_at: string;
  source: FumigationSource;
  area_treated_ha: number;
  product: string;
  volume_l: number;
  operator: string;
  flights_count: number;
  notes: string | null;
  /**
   * s8.8 (2026-07-31) — coordenadas para renderizar el evento en el
   * mapa del geovisor. Calculadas por `getRecentFumigations` como
   * centroide de los flights asociados. NULL si no hay match.
   */
  lng?: number | null;
  lat?: number | null;
  /**
   * s8.8 (2026-07-31) — numero de flights del JOIN que encontraron
   * match. Util para el popup ("5 de 7 flights asociados").
   */
  n_matched_flights?: number | null;
}

/** Alias del V0 (los components V0 importan `DjiFumigation`). */
export type DjiFumigation = DjiFumigationV0;

/** dji_flights — sortie individual de dron (V0 shape). */
export interface DjiFlightV0 {
  id: string;
  fumigation_id: string;
  parcel_id: string;
  drone_model_id: DroneModelId;
  drone_sn: string;
  pilot: string;
  started_at: string;
  duration_min: number;
  area_ha: number;
  volume_l: number;
  lng: number;
  lat: number;
  battery_cycles: number;
}

/** Alias del V0 (los components V0 importan `DjiFlight`). */
export type DjiFlight = DjiFlightV0;

/** dji_fumigation_schedule_history — historial de cambios de cadencia. */
export interface DjiScheduleHistory {
  id: string;
  parcel_id: string;
  changed_at: string;
  old_cadence_days: number | null;
  new_cadence_days: number;
  changed_by: string;
  reason: string;
}

/** dji_import_batches — auditoría de scraping. */
export interface DjiImportBatch {
  id: string;
  started_at: string;
  finished_at: string;
  status: "ok" | "partial" | "error";
  parcels_upserted: number;
  flights_upserted: number;
  fumigations_upserted: number;
  message: string | null;
}

/** djiag_health — singleton con health del último pipeline run. */
export interface DjiAgHealth {
  last_run_at: string;
  next_run_at: string;
  status: "ok" | "partial" | "error";
  duration_ms: number;
  parcels_synced: number;
  flights_synced: number;
  api_latency_ms: number;
  token_expires_at: string;
  consecutive_failures: number;
}

/** Estado de cumplimiento derivado de schedule + última fumigación */
export type ComplianceStatus = "al_dia" | "por_vencer" | "vencido" | "critico";

export interface ParcelSummary {
  parcel: DjiParcel;
  schedule: DjiFumigationScheduleV0;
  last_fumigation_at: string | null;
  next_due_at: string | null;
  days_since_last: number | null;
  days_to_due: number | null;
  status: ComplianceStatus;
  fumigations_count: number;
  flights_count: number;
  total_area_treated_ha: number;
  total_volume_l: number;
  avg_interval_days: number | null;
}

/** Payload compacto que `app/geovisor/page.tsx` envía al client component. */
export interface GeovisorPayload {
  parcels: {
    id: string;
    name: string;
    farm_name: string;
    client_name: string;
    municipality: string;
    variety: string;
    area_ha: number;
    drone_model_id: DroneModelId;
    centroid_lng: number;
    centroid_lat: number;
    geom: DjiParcel["geom"];
    status: ComplianceStatus;
    last_fumigation_at: string | null;
    next_due_at: string | null;
    cadence_days: number;
    fumigations_count: number;
  }[];
  /**
   * s8.8 (2026-07-31) — `events` ahora incluye `notes` y `n_matched_flights`
   * para que el popup del mapa pueda leer todos los campos del V0 sin
   * necesidad de un Map<id, event> en memoria. Antes solo tenía
   * {id, parcel_id, executed_at, source, area_treated_ha, volume_l,
   * flights_count, product, operator, lng, lat} — el `notes` y
   * `n_matched_flights` se perdían en el render del mapa.
   */
  events: Array<
    Pick<
      DjiFumigationV0,
      | "id"
      | "parcel_id"
      | "executed_at"
      | "source"
      | "area_treated_ha"
      | "volume_l"
      | "flights_count"
      | "product"
      | "operator"
      | "lng"
      | "lat"
      | "notes"
      | "n_matched_flights"
    >
  >;
  /**
   * Sprint S8 (2026-08-29) — métricas agregadas de `dji_flights` en el
   * rango visible (sin filtro de parcela). El geovisor usa esto para
   * los KPIs de VUELOS y VOLUMEN, que antes derivaba de `events` y
   * daba 0 para fumigaciones importadas de DJI sin `flight_ids`
   * linkeados. Ahora la fuente de verdad es `dji_flights.start_at` +
   * `dji_flights.spray_usage_ml`, independiente de las fumigaciones.
   * Los KPIs de APLICACIONES y HECTÁREAS TRATADAS siguen derivando
   * de `events` (correcto — son métricas de aplicación, no de vuelo).
   */
  flight_aggregates: {
    total_flights: number;
    total_volume_l: number;
    total_area_ha: number;
    range_from: string; // ISO date — cache key del payload
    range_to: string; // ISO date
  };
}
