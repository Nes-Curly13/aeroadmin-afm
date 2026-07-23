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
import {
  buildAlertsFromFumigations,
  type FumigationRow
} from "@/lib/dji-fumigations-aggregate";
import { toDateString } from "@/lib/format";
import {
  computeNextDueDate,
  daysUntilNextDue,
  getFumigationStatus
} from "@/lib/fumigation-cadence";
import {
  computeSeverity,
  sortOverdueByPriority
} from "@/lib/overdue-parcels";
import { djiParcelsQuery } from "@/api/queries";
import type {
  DashboardMetrics,
  DjiAlertRecord,
  DjiDailySummaryRecord,
  DjiParcelRecord,
  OverdueParcel,
  UpcomingFumigation,
  FlightPointRecord
} from "@/lib/types";

export const CACHE_TAGS = {
  metrics: "afm:metrics",
  alerts: "afm:alerts",
  parcels: "afm:parcels",
  parcelsSummary: "afm:parcels-summary",
  upcoming: "afm:upcoming",
  flights: "afm:flights",
  // M3-M5 Q2: lista de parcelas "Faltan por fumigar" (overdue + due_soon).
  // Invalida junto con `upcoming` cuando se registra una fumigación.
  overdue: "afm:overdue",
  // Sprint A — F4.0: actividad comparativa "ayer vs hoy" del dashboard.
  // Cacheada con TTL corto (5min) porque cambia intra-día; se invalida
  // junto con `flights` cuando se re-importan vuelos.
  activityComparison: "afm:activity-comparison"
} as const;

export const CACHE_TAGS_ALL = Object.values(CACHE_TAGS);

export const CACHE_TTL = {
  metrics: 300,
  alerts: 300,
  parcels: 60,
  parcelsSummary: 60,
  upcoming: 60,
  flights: 30,
  // Q2: misma TTL que upcoming porque la cadencia cambia con cada
  // fumigación registrada. Invalidación por tag al mutar.
  overdue: 60,
  // F4.0: 5min. "Hoy" cambia intra-día; "ayer" es estable, pero el cache
  // key incluye la fecha, así que no hay hit cross-day.
  activityComparison: 300
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

// ============================================================
// Wrappers cacheados
// ============================================================

async function fetchParcelsNormalizedRaw(
  page: number,
  limit: number
): Promise<{ data: DjiParcelRecord[]; total: number; page: number; limit: number; totalPages: number }> {
  const db = getDb();
  const offset = (page - 1) * limit;
  // Sprint B — H1: soft delete. Filtra parcelas borradas de la lista
  // cacheada. Sin este WHERE, las soft-deleted seguirían apareciendo
  // en /parcels y /map (la cache de 60s no las escondería).
  const result = await db.query<DjiParcelRecord>(
    `${djiParcelsQuery} WHERE p.deleted_at IS NULL ORDER BY land_name ASC NULLS LAST, id ASC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const countResult = await db.query<{ total: string }>(
    "SELECT COUNT(*)::int AS total FROM dji_parcels WHERE deleted_at IS NULL"
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
  // Sprint B — H1: soft delete. Excluimos parcelas borradas del summary
  // por tipo de dron — sino los contadores del dashboard ejecutivo
  // mostrarían counts inflados.
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
    WHERE deleted_at IS NULL
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
      -- Sprint B — H1: soft delete. El contador de parcelas del dashboard
      -- debe excluir las borradas, sino el campo totalAssets queda inflado.
      (SELECT COUNT(*)::text FROM dji_parcels WHERE deleted_at IS NULL) AS total_parcels
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

/**
 * v1.6 (auditoria #2 doble modelo fumigaciones):
 *   ANTES: las alertas se derivaban de dji_flights agregado por DIA total.
 *   El `parcel_id` resultante era el id sintetico del row de dji_daily_summaries
 *   (1, 2, 3...) y `parcel_name` era la fecha. La UI mostraba "alertas" que
 *   no correspondian a ninguna parcela real — eran buckets por dia.
 *
 *   AHORA: las alertas se derivan de dji_fumigations (la verdad per-parcela),
 *   agrupadas por (parcel_id, fumigation_date). `parcel_id` y `parcel_name`
 *   son reales. Si una fumigacion cubre varias parcelas en un dia, cada
 *   parcela tiene su propia alerta (no se mezclan).
 *
 *   Thresholds (60 mu / 30 mu / 80 sorties / 40 sorties) son los MISMOS
 *   que el agregador viejo. NO se re-calibran en v1.6 — eso es scope
 *   separado (audit #2.2 — "¿que nivel de riesgo significa realmente
 *   60 mu en UNA parcela vs 60 mu en TODA la cuenta?".
 *
 *   Soft delete (v1.1): las fumigaciones con deleted_at IS NOT NULL
 *   quedan excluidas. Mismo para dji_parcels.
 *
 *   Aggregate imports (parcel_id IS NULL): excluidos — representan "se
 *   fumigo en algun lado del total de la cuenta", no sabemos donde.
 *   Ver migration `20260619140000_make_dji_fumigations_parcel_nullable.sql`.
 */
async function fetchAlertsFromFumigationsRaw(): Promise<DjiAlertRecord[]> {
  const db = getDb();
  // Traemos TODAS las fumigaciones per-parcela (no agregamos en SQL
  // porque queremos reutilizar el aggregator puro `buildAlertsFromFumigations`,
  // testeable sin BD). Dataset actual: ~400 rows, chiquito.
  // Si crece a >50k, mover el GROUP BY a SQL (la función pura sigue
  // siendo util para tests).
  const result = await db.query<{
    id: number;
    parcel_id: number;
    // node-postgres devuelve columnas DATE como string (YYYY-MM-DD).
    // Mantenemos string en el boundary.
    fumigation_date: string;
    area_fumigated_m2: string | number | null;
    duration_minutes: number | null;
    dose_l_per_ha: string | number | null;
    land_name: string | null;
  }>(
    `SELECT f.id, f.parcel_id, f.fumigation_date,
            f.area_fumigated_m2, f.duration_minutes, f.dose_l_per_ha,
            p.land_name
       FROM dji_fumigations f
       JOIN dji_parcels p ON p.id = f.parcel_id
      WHERE f.parcel_id IS NOT NULL
        AND f.deleted_at IS NULL
        AND p.deleted_at IS NULL
      ORDER BY f.fumigation_date DESC, f.parcel_id ASC`
  );
  const rows: FumigationRow[] = result.rows.map((r) => ({
    id: r.id,
    parcel_id: r.parcel_id,
    fumigation_date: r.fumigation_date,
    area_fumigated_m2:
      r.area_fumigated_m2 === null ? null : Number(r.area_fumigated_m2),
    duration_minutes: r.duration_minutes,
    dose_l_per_ha:
      r.dose_l_per_ha === null ? null : Number(r.dose_l_per_ha),
    parcel_name: r.land_name
  }));
  return buildAlertsFromFumigations(rows);
}

/**
 * v1.6: fetchAlertsRaw ahora delega al nuevo fetchAlertsFromFumigationsRaw.
 * El cache + tag (`afm:alerts`) se mantienen — la UI no nota el cambio.
 *
 * El codigo viejo (basado en dji_flights) se conserva en este archivo
 * como `fetchAlertsLegacyFromFlightsRaw` por si necesitamos rollback
 * rapido. Si en 30 dias no se usa, borrar (TODO: ticket de cleanup).
 */
async function fetchAlertsRaw(): Promise<DjiAlertRecord[]> {
  return fetchAlertsFromFumigationsRaw();
}

export const fetchAlertsCached = unstable_cache(
  async () => fetchAlertsRaw(),
  ["alerts"],
  { revalidate: CACHE_TTL.alerts, tags: [CACHE_TAGS.alerts] }
);

/**
 * LEGACY v1.5: derivaba alertas de dji_flights agregado por dia.
 * Conservado como `fetchAlertsLegacyFromFlightsRaw` SOLO para
 * rollback rapido. No se invoca desde el codigo de produccion.
 *
 * Para usar en caso de emergencia:
 *   1. Cambiar `fetchAlertsRaw` para que retorne esta version.
 *   2. Commit con revert explicito en el mensaje.
 *
 * Removal: v2.0 (cuando se decida el destino final de dji_flights).
 */
async function fetchAlertsLegacyFromFlightsRaw(): Promise<DjiAlertRecord[]> {
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
      AND p.deleted_at IS NULL
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
// M3-M5 Q2 — Overdue parcels (lista "Faltan por fumigar")
// ============================================================

/**
 * Args para `fetchOverdueParcelsCached`.
 * - `maxDaysAhead` (default 14): incluye parcelas que vencen en los
 *   próximos N días, además de las ya vencidas. Default 14 = "esta
 *   semana + la siguiente". El caller (UI) puede ajustar.
 * - `limit` (default 200): cap defensivo. La lista puede ser larga
 *   en operadores grandes; el caller pagina si necesita más.
 * - `cropType` (opcional): filtra por tipo de cultivo (sugar cane,
 *   etc.). Útil para que el operador vea solo lo que aplica a su
 *   operación del día.
 * - `isOrchard` (opcional): filtra por tipo de parcela.
 */
export interface FetchOverdueArgs {
  maxDaysAhead?: number;
  limit?: number;
  cropType?: string;
  isOrchard?: boolean;
}

async function fetchOverdueParcelsRaw(args: FetchOverdueArgs): Promise<OverdueParcel[]> {
  const db = getDb();
  const { maxDaysAhead = 14, limit = 200, cropType, isOrchard } = args;
  // Sprint B — H1: soft delete. La lista de "Faltan por fumigar" debe
  // excluir parcelas borradas — sino el operador ve parcelas que ya
  // no existen en su lista de pendientes.
  const conditions: string[] = ["s.is_active = true", "p.spray_geom IS NOT NULL", "p.deleted_at IS NULL"];
  const params: unknown[] = [];
  // Filtro de fecha: next_due_date <= today + maxDaysAhead.
  // El cálculo de "today" lo hace el caller (computed today) para que
  // el raw query sea testable con fechas fijas en integration.
  if (maxDaysAhead > 0) {
    params.push(maxDaysAhead);
    conditions.push(`s.next_due_date <= (CURRENT_DATE + $${params.length} * INTERVAL '1 day')`);
  }
  if (cropType) {
    params.push(cropType);
    conditions.push(`s.crop_type = $${params.length}`);
  }
  if (isOrchard !== undefined) {
    params.push(isOrchard);
    conditions.push(`p.is_orchard = $${params.length}`);
  }
  params.push(limit);
  const limitParam = `$${params.length}`;

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
    next_due_date: string | null;
    days_until_next_due: number | null;
    area_fumigable_m2: number | null;
    waypoint_count: number | null;
  }>(`
    SELECT
      p.id              AS parcel_id,
      p.land_name,
      p.external_id,
      p.field_type,
      p.is_orchard,
      p.drone_model_name,
      p.spray_area_m2   AS area_fumigable_m2,
      p.waypoint_count,
      s.crop_type,
      s.recommended_cadence_days,
      s.last_fumigation_date,
      s.next_due_date
    FROM dji_fumigation_schedule s
    JOIN dji_parcels p ON p.id = s.parcel_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY s.next_due_date ASC NULLS LAST
    LIMIT ${limitParam}
  `, params);

  const now = new Date();
  const enriched: OverdueParcel[] = result.rows.map((row) => {
    const lastDate = toDateString(row.last_fumigation_date);
    const nextDue = toDateString(row.next_due_date);
    const days = daysUntilNextDue(lastDate, row.recommended_cadence_days, now);
    const severity = computeSeverity(days);
    const areaM2 = row.area_fumigable_m2;
    return {
      parcel_id: row.parcel_id,
      land_name: row.land_name,
      external_id: row.external_id,
      field_type: row.field_type,
      is_orchard: row.is_orchard,
      drone_model_name: row.drone_model_name,
      crop_type: row.crop_type,
      recommended_cadence_days: row.recommended_cadence_days,
      last_fumigation_date: lastDate,
      next_due_date: nextDue,
      days_until_next_due: days,
      severity,
      area_fumigable_m2: areaM2,
      waypoint_count: row.waypoint_count,
      area_fumigable_ha: areaM2 !== null ? Math.round((areaM2 / 10000) * 100) / 100 : null
    };
  });

  // Sort por prioridad de fumigación (overdue > due_soon > ok > no_history,
  // luego días más negativos primero, luego parcel_id estable).
  // Q2: filtramos solo overdue y due_soon en el WHERE implícito del
  // caller (maxDaysAhead). Aquí ordenamos todos los que volvieron.
  return enriched.sort(sortOverdueByPriority);
}

export const fetchOverdueParcelsCached = unstable_cache(
  async (args: FetchOverdueArgs) => fetchOverdueParcelsRaw(args),
  ["overdue-parcels"],
  { revalidate: CACHE_TTL.overdue, tags: [CACHE_TAGS.overdue, CACHE_TAGS.parcels] }
);

// Re-export del args interface para callers que no quieran importar
// internals de este archivo.
export type { FetchOverdueArgs as OverdueParcelsArgs };

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
// Sprint A — F4.0: actividad comparativa "ayer vs hoy"
// ============================================================

/**
 * Una "tarjeta" de actividad para un día. Las métricas derivan de
 * `dji_flights` (la verdad operativa — no del manual `dji_fumigations`).
 *
 * - `flights_count`: cantidad de sorties del día.
 * - `area_fumigated_m2`: suma de `area_m2` de los vuelos del día.
 * - `parcels_touched`: cuántas parcelas únicas tuvieron al menos un vuelo.
 * - `duration_minutes`: suma de `duration_seconds` / 60.
 */
export interface ActivityDayMetrics {
  flights_count: number;
  area_fumigated_m2: number;
  parcels_touched: number;
  duration_minutes: number;
}

/**
 * Comparativa de actividad entre "hoy" y "ayer" en TZ America/Bogota.
 * Lo que consume `<TodayYesterdayCard>` en el dashboard.
 */
export interface ActivityComparison {
  today: ActivityDayMetrics;
  yesterday: ActivityDayMetrics;
  /** Las fechas en formato `YYYY-MM-DD` (Bogota local) que se usaron. */
  dates: { today: string; yesterday: string };
}

interface ActivityComparisonDbRow {
  which: "today" | "yesterday";
  flights_count: string;
  area_fumigated_m2: string;
  parcels_touched: string;
  duration_minutes: string;
}

/**
 * Query batch que devuelve las métricas de hoy y ayer en UNA sola
 * round-trip. Las fechas llegan como parámetros (YYYY-MM-DD Bogota
 * local) para que el caller controle el "hoy" y para que los tests
 * sean deterministas sin mockear NOW() del server.
 *
 * Filtramos `parcel_id IS NOT NULL` para excluir agregados del importer
 * que quedaron sin asignar (mismo criterio que `getFumigatedParcelIdsSince`).
 *
 * Conversión de TZ: `(start_at AT TIME ZONE 'America/Bogota')::date` —
 * trunca el timestamptz a la fecha local Bogota del vuelo. Equivalente
 * al join que ya usa `lib/djiag-spatial-aggregator.ts` y la timeline.
 */
async function fetchActivityComparisonRaw(
  today: string,
  yesterday: string
): Promise<ActivityComparison> {
  const db = getDb();
  const result = await db.query<ActivityComparisonDbRow>(
    `
      SELECT 'today' AS which, * FROM (
        SELECT
          COUNT(*)::text AS flights_count,
          COALESCE(SUM(area_m2), 0)::text AS area_fumigated_m2,
          COUNT(DISTINCT parcel_id)::text AS parcels_touched,
          (COALESCE(SUM(duration_seconds), 0) / 60.0)::text AS duration_minutes
        FROM dji_flights
        WHERE parcel_id IS NOT NULL
          AND (start_at AT TIME ZONE 'America/Bogota')::date = $1::date
      ) t
      UNION ALL
      SELECT 'yesterday' AS which, * FROM (
        SELECT
          COUNT(*)::text AS flights_count,
          COALESCE(SUM(area_m2), 0)::text AS area_fumigated_m2,
          COUNT(DISTINCT parcel_id)::text AS parcels_touched,
          (COALESCE(SUM(duration_seconds), 0) / 60.0)::text AS duration_minutes
        FROM dji_flights
        WHERE parcel_id IS NOT NULL
          AND (start_at AT TIME ZONE 'America/Bogota')::date = $2::date
      ) y
    `,
    [today, yesterday]
  );

  const empty: ActivityDayMetrics = {
    flights_count: 0,
    area_fumigated_m2: 0,
    parcels_touched: 0,
    duration_minutes: 0
  };

  const today_metrics: ActivityDayMetrics = { ...empty };
  const yesterday_metrics: ActivityDayMetrics = { ...empty };

  for (const row of result.rows) {
    const parsed: ActivityDayMetrics = {
      flights_count: Number(row.flights_count),
      area_fumigated_m2: Number(row.area_fumigated_m2),
      parcels_touched: Number(row.parcels_touched),
      duration_minutes: Number(row.duration_minutes)
    };
    if (row.which === "today") Object.assign(today_metrics, parsed);
    else Object.assign(yesterday_metrics, parsed);
  }

  return {
    today: today_metrics,
    yesterday: yesterday_metrics,
    dates: { today, yesterday }
  };
}

/**
 * Wrapper cacheado. El cache key de Next incluye los args (today, yesterday),
 * así que el "ayer" cacheado el 22 de julio NO se reutiliza el 23 de julio
 * (que pide "ayer=2026-07-22, hoy=2026-07-23" — key distinta). Esto es OK:
 * el "ayer" del día siguiente es la misma data, pero la query es barata
 * (~7000 rows totales) y la cache hit durante el mismo día cubre el 99%
 * de los renders del dashboard.
 */
export const fetchActivityComparisonCached = unstable_cache(
  async (today: string, yesterday: string) =>
    fetchActivityComparisonRaw(today, yesterday),
  ["activity-comparison"],
  { revalidate: CACHE_TTL.activityComparison, tags: [CACHE_TAGS.activityComparison, CACHE_TAGS.flights] }
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
  // M3-M5 Q2: invalidar también la lista de "Faltan" — al registrar
  // una fumigación, la cadencia de la parcela afectada se recalcula.
  invalidateTagImmediate(CACHE_TAGS.overdue);
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
  // Sprint A — F4.0: la comparativa ayer/hoy se recalcula cuando entran
  // nuevos vuelos. Mismo criterio que metrics (derivada de dji_flights).
  invalidateTagImmediate(CACHE_TAGS.activityComparison);
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
