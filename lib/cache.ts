/**
 * Cache selectiva con `unstable_cache` de Next.js.
 *
 * Sprint 7 (2026-06-28): el dashboard, /map y /history pegabanle 3-5 queries
 * pesadas a Postgres en cada render. Como son páginas server-component
 * `force-dynamic`, cada navegación disparaba todo el pipeline otra vez — sin
 * ganancia entre requests de usuarios distintos (mismo segundo, mismo día,
 * mismos datos).
 *
 * Decisiones:
 *   - Tags por dominio (`afm:metrics`, `afm:parcels`, ...) + un tag global
 *     `afm:all` para pánicos ('siembro el dashboard' invalida todo). Las
 *     mutations llaman `invalidateXxx()` y Next libera la cache en runtime.
 *   - TTL conservador (no agresivo): métricas 5 min, parcelas 1 min, alertas
 *     5 min, upcoming 1 min, flights 30s. Como referencia, los datos reales
 *     cambian en el backfill diario y al crear fumigaciones manuales; unos
 *     minutos de stale son aceptables.
 *   - `unstable_cache` envuelve la lógica del repositorio SIN tocar la
 *     función original. Las páginas server-side siguen importando la misma
 *     función desde `@/api/repositories` (mismo contrato = sin riesgo de
 *     regresión silenciosa en componentes).
 *   - Si no hay DB en runtime, los repositorios ya hacen fallback al JSON
 *     local — el cache los cachea igual, lo cual está bien porque el JSON
 *     local es estático.
 *
 * Por qué `unstable_cache` y no `cache: 'force-cache'` en la página: si la
 * página cambia (ej: nuevo header), Next la recompila; el wrapper sobrevive
 * al hot reload porque es module-level. Además, `unstable_cache` permite
 * invalidar por tag sin tocar la página — clave para mutaciones.
 */

import { revalidateTag, unstable_cache } from "next/cache";
import { getDb } from "@/lib/db";
import {
  aggregateFlightsByDay,
  type FlightRow
} from "@/lib/dji-flights-aggregate";
import { toDateString } from "@/lib/format";
import {
  computeNextDueDate,
  daysUntilNextDue,
  getFumigationStatus
} from "@/lib/fumigation-cadence";
import type {
  DashboardMetrics,
  DjiAlertRecord,
  DjiDailySummaryRecord,
  DjiParcelRecord,
  UpcomingFumigation,
  FlightPointRecord
} from "@/lib/types";

export const CACHE_TAGS = {
  metrics: "afm:metrics",
  alerts: "afm:alerts",
  parcels: "afm:parcels",
  parcelsSummary: "afm:parcels-summary",
  upcoming: "afm:upcoming",
  flights: "afm:flights"
} as const;

export const CACHE_TAGS_ALL = Object.values(CACHE_TAGS);

export const CACHE_TTL = {
  metrics: 300,
  alerts: 300,
  parcels: 60,
  parcelsSummary: 60,
  upcoming: 60,
  flights: 30
} as const;

// ============================================================
// Tipos locales (copiados de api/repositories para no acoplar)
// ============================================================

interface MetricsRow {
  total_flights: string;
  total_area_covered_m2: string | null;
  high_alert_days: string;
  total_parcels: string;
}

const djiParcelsQuery = `
  SELECT
    id,
    external_id,
    land_name,
    field_type,
    declared_area_ha,
    spray_area_m2,
    drone_model_code,
    drone_model_name,
    spray_width_m,
    work_speed_mps,
    optimal_heading_deg,
    radar_height_m,
    edge_offset_m,
    obstacle_offset_m,
    climb_height_m,
    no_spray_zone_m2,
    droplet_size,
    sweep_direction,
    is_orchard,
    uses_side_spray,
    CASE WHEN spray_geom IS NULL THEN NULL ELSE ST_AsGeoJSON(spray_geom)::json END AS spray_geometry,
    CASE WHEN reference_point IS NULL THEN NULL ELSE ST_AsGeoJSON(reference_point)::json END AS reference_point,
    CASE WHEN waypoints IS NULL THEN NULL ELSE ST_AsGeoJSON(waypoints)::json END AS waypoints_geometry,
    waypoint_count,
    source_url_geometry,
    source_url_parameter,
    source_url_waypoint,
    fetched_at
  FROM dji_parcels
`;

// ============================================================
// Wrappers cacheados
// ============================================================

async function fetchParcelsNormalizedRaw(
  page: number,
  limit: number
): Promise<{ data: DjiParcelRecord[]; total: number; page: number; limit: number; totalPages: number }> {
  const db = getDb();
  const offset = (page - 1) * limit;
  const result = await db.query<DjiParcelRecord>(
    `${djiParcelsQuery} ORDER BY land_name ASC NULLS LAST, id ASC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const countResult = await db.query<{ total: string }>(
    "SELECT COUNT(*)::int AS total FROM dji_parcels"
  );
  const total = Number(countResult.rows[0]?.total ?? 0);
  return {
    data: result.rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  };
}

export const fetchParcelsNormalizedCached = unstable_cache(
  async (page: number, limit: number) => fetchParcelsNormalizedRaw(page, limit),
  ["parcels-normalized"],
  { revalidate: CACHE_TTL.parcels, tags: [CACHE_TAGS.parcels] }
);

interface ParcelsSummaryRow {
  total_parcels: string;
  total_orchards: string;
  total_farmlands: string;
  total_spray_area_m2: string | null;
  avg_spray_area_m2: string | null;
  drone_model_code: number | null;
  drone_model_name: string | null;
  count_by_drone: string;
}

async function fetchParcelsSummaryRaw(): Promise<ParcelsSummaryRow[]> {
  const db = getDb();
  const result = await db.query<ParcelsSummaryRow>(`
    SELECT
      COUNT(*)::text AS total_parcels,
      COUNT(*) FILTER (WHERE is_orchard)::text AS total_orchards,
      COUNT(*) FILTER (WHERE NOT is_orchard)::text AS total_farmlands,
      SUM(spray_area_m2)::text AS total_spray_area_m2,
      AVG(spray_area_m2)::text AS avg_spray_area_m2,
      drone_model_code,
      drone_model_name,
      COUNT(*)::text AS count_by_drone
    FROM dji_parcels
    GROUP BY drone_model_code, drone_model_name
    ORDER BY count_by_drone DESC
  `);
  return result.rows;
}

export const fetchParcelsSummaryCached = unstable_cache(
  async () => fetchParcelsSummaryRaw(),
  ["parcels-summary"],
  { revalidate: CACHE_TTL.parcelsSummary, tags: [CACHE_TAGS.parcelsSummary, CACHE_TAGS.parcels] }
);

async function fetchDashboardMetricsRaw(): Promise<DashboardMetrics> {
  const db = getDb();
  const result = await db.query<MetricsRow>(`
    SELECT
      COUNT(*)::text AS total_flights,
      COALESCE(SUM(area_m2), 0)::text AS total_area_covered_m2,
      (
        SELECT COUNT(DISTINCT DATE(start_at AT TIME ZONE 'America/Bogota'))::text
        FROM dji_flights
        WHERE area_m2 >= 40000 OR duration_seconds >= 28800
      ) AS high_alert_days,
      (SELECT COUNT(*)::text FROM dji_parcels) AS total_parcels
    FROM dji_flights
  `);
  const row = result.rows[0];
  const totalAreaCoveredMu = Number(row?.total_area_covered_m2 ?? 0) / (10_000 / 15);
  return {
    totalFlights: Number(row?.total_flights ?? 0),
    totalAreaCovered: totalAreaCoveredMu,
    highAlertParcels: Number(row?.high_alert_days ?? 0),
    totalAssets: Number(row?.total_parcels ?? 0)
  };
}

export const fetchDashboardMetricsCached = unstable_cache(
  async () => fetchDashboardMetricsRaw(),
  ["dashboard-metrics"],
  { revalidate: CACHE_TTL.metrics, tags: [CACHE_TAGS.metrics] }
);

interface FlightDbRow {
  id: number;
  flight_id: number;
  start_at: Date;
  end_at: Date;
  duration_seconds: number;
  area_m2: number;
  spray_usage_ml: number;
  drone_nickname: string | null;
  pilot_name: string | null;
  parcel_id: number | null;
  lng: number | null;
  lat: number | null;
  point: GeoJSON.Geometry | null;
}

async function fetchAlertsRaw(): Promise<DjiAlertRecord[]> {
  const db = getDb();
  const result = await db.query<FlightDbRow>(
    `SELECT id, flight_id, start_at, end_at, duration_seconds, area_m2,
            spray_usage_ml, drone_nickname, pilot_name, parcel_id
       FROM dji_flights ORDER BY start_at DESC`
  );
  const aggregated = aggregateFlightsByDay(
    result.rows.map(
      (r): FlightRow => ({
        id: r.id,
        flight_id: r.flight_id,
        start_at: r.start_at,
        duration_seconds: r.duration_seconds,
        area_m2: r.area_m2,
        spray_usage_ml: r.spray_usage_ml
      })
    )
  );
  return aggregated.map((row): DjiAlertRecord => {
    const areaMu = Number(row.area_mu);
    const usageLiters = Number(row.usage_liters);
    const timesCount = Number(row.times_count);
    const ageDays = Math.max(0, Math.round(areaMu / 2));
    const level: DjiAlertRecord["level"] =
      areaMu >= 60 || timesCount >= 80
        ? "HIGH"
        : areaMu >= 30
          ? "MEDIUM"
          : "LOW";
    return {
      parcel_id: row.id,
      parcel_name: `${row.record_date} ${row.category}`,
      level,
      age_days: ageDays,
      message: `${row.category} en ${row.record_date}: ${timesCount} salidas, ${areaMu.toFixed(2)} mu, ${usageLiters.toFixed(1)} L.`,
      geometry: null
    };
  });
}

export const fetchAlertsCached = unstable_cache(
  async () => fetchAlertsRaw(),
  ["alerts"],
  { revalidate: CACHE_TTL.alerts, tags: [CACHE_TAGS.alerts] }
);

async function fetchUpcomingFumigationsRaw(limit: number): Promise<UpcomingFumigation[]> {
  const db = getDb();
  const result = await db.query<{
    parcel_id: number;
    land_name: string | null;
    external_id: string;
    field_type: string;
    is_orchard: boolean;
    drone_model_name: string | null;
    crop_type: string;
    recommended_cadence_days: number;
    last_fumigation_date: string | null;
  }>(`
    SELECT
      p.id            AS parcel_id,
      p.land_name,
      p.external_id,
      p.field_type,
      p.is_orchard,
      p.drone_model_name,
      s.crop_type,
      s.recommended_cadence_days,
      s.last_fumigation_date
    FROM dji_fumigation_schedule s
    JOIN dji_parcels p ON p.id = s.parcel_id
    WHERE s.is_active = true
  `);
  const now = new Date();
  const enriched: UpcomingFumigation[] = result.rows.map((row) => {
    const lastDate = toDateString(row.last_fumigation_date);
    const status = getFumigationStatus(lastDate, row.recommended_cadence_days, now);
    const days = daysUntilNextDue(lastDate, row.recommended_cadence_days, now);
    return {
      ...row,
      last_fumigation_date: lastDate,
      next_due_date:
        computeNextDueDate(lastDate, row.recommended_cadence_days)?.toISOString().slice(0, 10) ?? null,
      days_until_next_due: days,
      status
    };
  });
  enriched.sort((a, b) => {
    const order = { overdue: 0, due_soon: 1, ok: 2, no_history: 3 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    const aDays = a.days_until_next_due ?? 0;
    const bDays = b.days_until_next_due ?? 0;
    return aDays - bDays;
  });
  return enriched.slice(0, limit);
}

export const fetchUpcomingFumigationsCached = unstable_cache(
  async (limit: number) => fetchUpcomingFumigationsRaw(limit),
  ["upcoming-fumigations"],
  { revalidate: CACHE_TTL.upcoming, tags: [CACHE_TAGS.upcoming] }
);

// ============================================================
// M6 — flight points (footprint minimo por sortie)
// ============================================================

/**
 * Devuelve los N vuelos mas recientes con su (lng, lat) centroide.
 * Cacheada con tag `afm:flights` + TTL 60s. Solo se invalida cuando se
 * re-importan vuelos (ver `invalidateAfterFlightMutation`).
 *
 * Decisiones:
 *   - LIMIT default 300 (suficiente para ver actividad reciente sin saturar
 *     el mapa). El caller puede pedir mas si quiere densidad historica,
 *     pero recomiendo paginar de a 500 max para evitar listas enormes.
 *   - No pedimos el `point` geometry en el SELECT — solo lng/lat numeric
 *     porque queremos coordenadas planas para react-leaflet. ST_X/ST_Y
 *     agrega overhead innecesario para este caso.
 *   - Filtramos `lng IS NOT NULL AND lat IS NOT NULL` — ~10% de los 7050
 *     flights no tienen coord (vuelos de prueba / fuera de zona). No las
 *     mostramos para no tener nulls en el mapa.
 */
async function fetchFlightPointsRaw(limit: number): Promise<FlightPointRecord[]> {
  const db = getDb();
  const result = await db.query<{
    flight_id: number;
    start_at: Date;
    lng: number;
    lat: number;
    drone_nickname: string | null;
    pilot_name: string | null;
    parcel_id: number | null;
    area_m2: number | null;
    spray_usage_ml: number | null;
  }>(
    `SELECT flight_id, start_at, lng, lat, drone_nickname, pilot_name,
            parcel_id, area_m2, spray_usage_ml
       FROM dji_flights
      WHERE lng IS NOT NULL
        AND lat IS NOT NULL
        AND lng BETWEEN -180 AND 180
        AND lat BETWEEN -90 AND 90
      ORDER BY start_at DESC
      LIMIT $1`,
    [limit]
  );
  return result.rows.map((r) => ({
    flight_id: r.flight_id,
    start_at: r.start_at.toISOString(),
    lng: Number(r.lng),
    lat: Number(r.lat),
    drone_nickname: r.drone_nickname,
    pilot_name: r.pilot_name,
    parcel_id: r.parcel_id,
    area_m2: r.area_m2 === null ? null : Number(r.area_m2),
    spray_usage_ml: r.spray_usage_ml
  }));
}

export const fetchFlightPointsCached = unstable_cache(
  async (limit: number) => fetchFlightPointsRaw(limit),
  ["flight-points"],
  { revalidate: CACHE_TTL.flights, tags: [CACHE_TAGS.flights] }
);

// ============================================================
// Invalidation helpers — para usar desde mutations
// ============================================================

/**
 * Llamar después de crear/actualizar/eliminar fumigaciones o cadencias.
 * Invalida lo que el usuario espera ver fresco en el dashboard.
 */
export function invalidateAfterFumigationMutation(): void {
  // Next 16 requiere `profile` como segundo arg. Pasamos `{ expire: 0 }`
  // para que la invalidación sea efectiva inmediatamente (no esperar al stale).
  invalidateTagImmediate(CACHE_TAGS.upcoming);
  invalidateTagImmediate(CACHE_TAGS.metrics);
  invalidateTagImmediate(CACHE_TAGS.alerts);
}

/**
 * Llamar después de cualquier cambio a dji_parcels (import, importer,
 * fetch-lands, update). Invalida el universo de parcelas + dashboard.
 */
export function invalidateAfterParcelMutation(): void {
  invalidateTagImmediate(CACHE_TAGS.parcels);
  invalidateTagImmediate(CACHE_TAGS.parcelsSummary);
  invalidateTagImmediate(CACHE_TAGS.upcoming);
}

/**
 * Llamar después de un reimport de dji_flights (backfill, per-flight scrape).
 * Resetea KPIs, alertas e upcoming (los upcoming derivan de fumigaciones,
 * pero las fumigaciones derivan de flights — los dos mundos están acoplados).
 */
export function invalidateAfterFlightMutation(): void {
  invalidateTagImmediate(CACHE_TAGS.flights);
  invalidateTagImmediate(CACHE_TAGS.metrics);
  invalidateTagImmediate(CACHE_TAGS.alerts);
}

/**
 * Botón de pánico: invalida todo. Reservado para casos como "se rompió la BD,
 * sembrar de nuevo".
 */
export function invalidateAll(): void {
  for (const tag of CACHE_TAGS_ALL) invalidateTagImmediate(tag);
}

/**
 * Helper interno. Next 16 requiere `profile` (string u objeto) como segundo
 * argumento de `revalidateTag`. Pasamos `{ expire: 0 }` para que la cache
 * se considere expirada inmediatamente — equivalente a "invalidate now".
 */
function invalidateTagImmediate(tag: string): void {
  revalidateTag(tag, { expire: 0 });
}
