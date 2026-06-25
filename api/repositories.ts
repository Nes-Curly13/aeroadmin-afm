import { getDb } from "@/lib/db";
import fs from "node:fs";
import path from "node:path";
import {
  CADENCE_DEFAULTS,
  computeNextDueDate,
  daysUntilNextDue,
  getFumigationStatus
} from "@/lib/fumigation-cadence";
import { toDateString } from "@/lib/format";
import type {
  DashboardMetrics,
  DjiAssetRecord,
  DjiDailySummaryRecord,
  DjiFlightRecord,
  DjiAlertRecord,
  DjiFumigationEvent,
  DjiFumigationSchedule,
  DjiParcelRecord,
  UpcomingFumigation
} from "@/lib/types";

interface MetricsRow {
  total_flights: string;
  total_area_covered: string | null;
  high_alert_days: string;
  total_assets: string;
  total_fields: string;
}

const localExportsRoot = path.join(process.cwd(), "djiag_exports");

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function parseLooseNumber(value: unknown) {
  const n = Number(String(value ?? "").replace(/[^0-9.]+/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseSummaryRecord(item: Record<string, unknown>, index: number): DjiDailySummaryRecord {
  const raw = String(item.raw ?? item.raw_text ?? "");
  const date = String(item.date ?? item.record_date ?? raw.match(/^(\d{4}\/\d{2}\/\d{2})/)?.[1] ?? "");
  const rawMatch = raw.match(/^(\d{4}\/\d{2}\/\d{2})([A-Za-z]+)Agriculture([\d.]+)mu(\d+)times([\d.]+)L-(.+)$/);
  return {
    id: index + 1,
    record_date: date.includes("/") ? date.replace(/\//g, "-") : date,
    weekday: String(item.weekday ?? rawMatch?.[2] ?? "").replace(/Agriculture$/, "") || null,
    category: String(item.category ?? "Agriculture") || "Agriculture",
    area_mu: parseLooseNumber(item.area ?? item.area_mu ?? rawMatch?.[3]),
    times_count: parseLooseNumber(item.times ?? item.times_count ?? rawMatch?.[4]),
    usage_liters: parseLooseNumber(item.usage ?? item.usage_liters ?? rawMatch?.[5]),
    work_time_text: String(item.workTime ?? item.work_time_text ?? rawMatch?.[6] ?? ""),
    raw_text: raw
  };
}

function loadLocalSummaryRecords(): DjiDailySummaryRecord[] {
  const filePath = path.join(localExportsRoot, "records_history.json");
  const raw = readJsonFile<Array<Record<string, unknown>>>(filePath, []);
  return raw.map((item, index) => parseSummaryRecord(item, index)).sort((a, b) => b.record_date.localeCompare(a.record_date));
}

function loadLocalAssetRecords(): DjiAssetRecord[] {
  const assetList = readJsonFile<Array<Record<string, unknown>>>(path.join(localExportsRoot, "land_file_urls.json"), []);
  return assetList.map((item, index) => ({
    id: index + 1,
    external_id: String(item.externalId ?? ""),
    land_name: String(item.landName ?? ""),
    asset_kind: String(item.kind ?? ""),
    source_url: String(item.url ?? ""),
    raw_json: null,
    geometry: null
  }));
}

function loadLocalFieldCount() {
  const fields = readJsonFile<Array<Record<string, unknown>>>(path.join(localExportsRoot, "mission_fields.json"), []);
  return fields.length;
}

async function withLocalFallback<T>(queryFn: () => Promise<T>, fallbackFn: () => Promise<T>) {
  try {
    return await queryFn();
  } catch {
    return fallbackFn();
  }
}

const assetsQuery = `
  SELECT
    id,
    external_id,
    land_name,
    asset_kind,
    source_url,
    raw_json,
    CASE
      WHEN geom IS NULL THEN NULL
      ELSE ST_AsGeoJSON(geom)::json
    END AS geometry
  FROM dji_land_assets
`;

const summariesQuery = `
  SELECT
    id,
    record_date,
    weekday,
    category,
    area_mu,
    times_count,
    usage_liters,
    work_time_text,
    raw_text
  FROM dji_daily_summaries
`;

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ============================================================
// NUEVO — Opción B: 1 fila por parcela con columnas planas
// ============================================================

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

export interface DjiParcelsFilter {
  isOrchard?: boolean;
  droneModelCode?: number;
  minSprayAreaM2?: number;
  fieldType?: string;
}

/**
 * Devuelve la lista normalizada de parcelas (Opción B).
 * Usa la tabla dji_parcels, con columnas planas y geometrías PostGIS como GeoJSON.
 */
export async function getParcelsNormalized(page = 1, limit = 20, filter: DjiParcelsFilter = {}) {
  const db = getDb();
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  if (filter.isOrchard !== undefined) {
    where.push(`is_orchard = $${p++}`);
    params.push(filter.isOrchard);
  }
  if (filter.droneModelCode !== undefined) {
    where.push(`drone_model_code = $${p++}`);
    params.push(filter.droneModelCode);
  }
  if (filter.minSprayAreaM2 !== undefined) {
    where.push(`spray_area_m2 >= $${p++}`);
    params.push(filter.minSprayAreaM2);
  }
  if (filter.fieldType) {
    where.push(`field_type = $${p++}`);
    params.push(filter.fieldType);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return withLocalFallback(
    async () => {
      const result = await db.query<DjiParcelRecord>(
        `${djiParcelsQuery} ${whereSql} ORDER BY land_name ASC NULLS LAST, id ASC LIMIT $${p++} OFFSET $${p++}`,
        [...params, limit, offset]
      );
      const countResult = await db.query<{ total: string }>(
        `SELECT COUNT(*)::int AS total FROM dji_parcels ${whereSql}`,
        params
      );
      const total = Number(countResult.rows[0]?.total ?? 0);
      return {
        data: result.rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    },
    async () => ({
      data: [],
      total: 0,
      page,
      limit,
      totalPages: 0
    })
  );
}

/**
 * Resumen agregado por tipo de dron y tipo de campo.
 * Útil para el dashboard ejecutivo.
 */
export async function getParcelsSummary() {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<{
        total_parcels: string;
        total_orchards: string;
        total_farmlands: string;
        total_spray_area_m2: string | null;
        avg_spray_area_m2: string | null;
        drone_model_code: number | null;
        drone_model_name: string | null;
        count_by_drone: string;
      }>(`
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
    },
    async () => []
  );
}

/**
 * Devuelve una sola parcela por id, con todas sus geometrías como GeoJSON.
 * Devuelve null si no existe.
 */
export async function getParcelById(id: number): Promise<DjiParcelRecord | null> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiParcelRecord>(
        `${djiParcelsQuery} WHERE id = $1`,
        [id]
      );
      return result.rows[0] ?? null;
    },
    async () => null
  );
}

// ============================================================
// Fumigaciones: schedule + eventos
// ============================================================

const fumigationScheduleByParcelQuery = `
  SELECT
    parcel_id,
    crop_type,
    recommended_cadence_days,
    last_fumigation_date,
    next_due_date,
    is_active,
    notes
  FROM dji_fumigation_schedule
`;

const fumigationEventsByParcelQuery = `
  SELECT
    id,
    parcel_id,
    fumigation_date,
    product_used,
    dose_l_per_ha,
    area_fumigated_m2,
    drone_code_used,
    duration_minutes,
    notes,
    recorded_by,
    recorded_at,
    source
  FROM dji_fumigations
  WHERE parcel_id = $1
  ORDER BY fumigation_date DESC, recorded_at DESC
`;

/**
 * Devuelve el schedule de una parcela (o null si no existe).
 *
 * `pg` devuelve columnas `DATE` como objetos `Date` de JS; los normalizamos
 * a `YYYY-MM-DD` en el boundary para evitar "Objects are not valid as a
 * React child" cuando se renderizan.
 */
export async function getFumigationSchedule(parcelId: number): Promise<DjiFumigationSchedule | null> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiFumigationSchedule>(
        `${fumigationScheduleByParcelQuery} WHERE parcel_id = $1`,
        [parcelId]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        ...row,
        last_fumigation_date: toDateString(row.last_fumigation_date),
        next_due_date: toDateString(row.next_due_date)
      };
    },
    async () => null
  );
}

/**
 * Lista de eventos de fumigación de una parcela, ordenados por fecha desc.
 *
 * Normaliza `fumigation_date` de `Date` (devuelto por `pg`) a `YYYY-MM-DD`.
 */
export async function getFumigationEventsByParcel(parcelId: number): Promise<DjiFumigationEvent[]> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiFumigationEvent>(fumigationEventsByParcelQuery, [parcelId]);
      return result.rows.map((row) => ({
        ...row,
        fumigation_date: toDateString(row.fumigation_date) ?? ""
      }));
    },
    async () => []
  );
}

/**
 * Inserta un nuevo evento de fumigación. Recalcula `next_due_date`
 * en el schedule correspondiente.
 */
export async function createFumigationEvent(event: {
  parcel_id: number;
  fumigation_date: string;
  product_used?: string | null;
  dose_l_per_ha?: number | null;
  area_fumigated_m2?: number | null;
  drone_code_used?: number | null;
  duration_minutes?: number | null;
  notes?: string | null;
  recorded_by?: string | null;
}): Promise<DjiFumigationEvent> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const ins = await client.query<DjiFumigationEvent>(
          `
            INSERT INTO dji_fumigations
              (parcel_id, fumigation_date, product_used, dose_l_per_ha,
               area_fumigated_m2, drone_code_used, duration_minutes, notes,
               recorded_by, source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual')
            RETURNING
              id, parcel_id, fumigation_date, product_used, dose_l_per_ha,
              area_fumigated_m2, drone_code_used, duration_minutes, notes,
              recorded_by, recorded_at, source
          `,
          [
            event.parcel_id,
            event.fumigation_date,
            event.product_used ?? null,
            event.dose_l_per_ha ?? null,
            event.area_fumigated_m2 ?? null,
            event.drone_code_used ?? null,
            event.duration_minutes ?? null,
            event.notes ?? null,
            event.recorded_by ?? null
          ]
        );
        const created = ins.rows[0];

        // Recalcular last_fumigation_date y next_due_date en el schedule
        const sched = await getFumigationSchedule(event.parcel_id);
        const cadence = sched?.recommended_cadence_days ?? 14;
        const next = computeNextDueDate(event.fumigation_date, cadence);
        await client.query(
          `
            UPDATE dji_fumigation_schedule
            SET last_fumigation_date = $2,
                next_due_date = $3,
                updated_at = NOW()
            WHERE parcel_id = $1
          `,
          [event.parcel_id, event.fumigation_date, next]
        );
        await client.query("COMMIT");
        return created;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    async () => {
      throw new Error("DB no disponible");
    }
  );
}

/**
 * Actualiza la cadencia esperada de una parcela. Si la parcela no tiene
 * schedule, lo crea con los defaults.
 */
export async function setFumigationCadence(parcelId: number, cadenceDays: number): Promise<void> {
  if (!Number.isFinite(cadenceDays) || cadenceDays < 1 || cadenceDays > 365) {
    throw new Error("cadence_days debe estar entre 1 y 365");
  }
  const db = getDb();
  await withLocalFallback(
    async () => {
      const parcel = await getParcelById(parcelId);
      if (!parcel) throw new Error("Parcela no encontrada");
      const def = parcel.is_orchard
        ? CADENCE_DEFAULTS.Orchards
        : CADENCE_DEFAULTS.Farmland;
      const current = await getFumigationSchedule(parcelId);
      const cropType = current?.crop_type ?? def.crop_type;
      const lastDate = current?.last_fumigation_date ?? null;
      const next = computeNextDueDate(lastDate, cadenceDays);
      await db.query(
        `
          INSERT INTO dji_fumigation_schedule
            (parcel_id, crop_type, recommended_cadence_days, last_fumigation_date, next_due_date, is_active)
          VALUES ($1, $2, $3, $4, $5, true)
          ON CONFLICT (parcel_id) DO UPDATE
          SET recommended_cadence_days = EXCLUDED.recommended_cadence_days,
              crop_type = EXCLUDED.crop_type,
              next_due_date = EXCLUDED.next_due_date,
              updated_at = NOW()
        `,
        [parcelId, cropType, cadenceDays, lastDate, next]
      );
    },
    async () => {
      throw new Error("DB no disponible");
    }
  );
}

/**
 * Devuelve las próximas fumigaciones (overdue + due_soon) ordenadas por
 * urgencia. Calcula el estado en aplicación, no en la BD, para que siempre
 * esté fresco al consultar.
 */
export async function getUpcomingFumigations(limit = 10): Promise<UpcomingFumigation[]> {
  const db = getDb();
  return withLocalFallback(
    async () => {
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
        // Normalizar fecha cruda (pg devuelve Date) ANTES de pasar a las funciones
        // de cadencia y al componente, para evitar [object Date] en el render.
        const lastDate = toDateString(row.last_fumigation_date);
        const status = getFumigationStatus(lastDate, row.recommended_cadence_days, now);
        const days = daysUntilNextDue(lastDate, row.recommended_cadence_days, now);
        return {
          ...row,
          last_fumigation_date: lastDate,
          next_due_date: computeNextDueDate(lastDate, row.recommended_cadence_days)?.toISOString().slice(0, 10) ?? null,
          days_until_next_due: days,
          status
        };
      });
      // Ordenar: overdue primero (más viejo primero), luego due_soon
      enriched.sort((a, b) => {
        const order = { overdue: 0, due_soon: 1, ok: 2, no_history: 3 };
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        const aDays = a.days_until_next_due ?? 0;
        const bDays = b.days_until_next_due ?? 0;
        return aDays - bDays; // más negativo (más vencido) primero
      });
      return enriched.slice(0, limit);
    },
    async () => []
  );
}

export async function getParcels(page = 1, limit = 20) {
  const db = getDb();
  const offset = (page - 1) * limit;
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiAssetRecord>(
        `
          ${assetsQuery}
          ORDER BY land_name ASC, asset_kind ASC, id ASC
          LIMIT $1 OFFSET $2
        `,
        [limit, offset]
      );
      const countResult = await db.query<{ total: string }>("SELECT COUNT(*)::int AS total FROM dji_land_assets");
      const total = Number(countResult.rows[0]?.total ?? 0);
      return {
        data: result.rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    },
    async () => {
      const data = loadLocalAssetRecords();
      const total = data.length;
      return {
        data: data.slice(offset, offset + limit),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    }
  );
}

export async function getFlights(page = 1, limit = 20) {
  const db = getDb();
  const offset = (page - 1) * limit;
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiDailySummaryRecord>(
        `
          ${summariesQuery}
          ORDER BY record_date DESC, id DESC
          LIMIT $1 OFFSET $2
        `,
        [limit, offset]
      );
      const countResult = await db.query<{ total: string }>("SELECT COUNT(*)::int AS total FROM dji_daily_summaries");
      const total = Number(countResult.rows[0]?.total ?? 0);
      return {
        data: result.rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    },
    async () => {
      const data = loadLocalSummaryRecords();
      const total = data.length;
      return {
        data: data.slice(offset, offset + limit),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    }
  );
}

export async function getAlerts() {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiDailySummaryRecord>(`
        ${summariesQuery}
        ORDER BY record_date DESC, id DESC
      `);
      return result.rows.map((row) => {
        const areaMu = Number(row.area_mu);
        const usageLiters = Number(row.usage_liters);
        const timesCount = Number(row.times_count);
        const ageDays = Math.max(0, Math.round(areaMu / 2));
        const level: DjiAlertRecord["level"] = areaMu >= 60 || timesCount >= 80 ? "HIGH" : areaMu >= 30 ? "MEDIUM" : "LOW";
        return {
          parcel_id: row.id,
          parcel_name: `${row.record_date} ${row.category}`,
          level,
          age_days: ageDays,
          message: `${row.category} en ${row.record_date}: ${timesCount} salidas, ${areaMu.toFixed(2)} mu y ${usageLiters.toFixed(1)} L.`,
          geometry: null
        };
      });
    },
    async () => loadLocalSummaryRecords().map((row) => {
      const areaMu = Number(row.area_mu);
      const usageLiters = Number(row.usage_liters);
      const timesCount = Number(row.times_count);
      const ageDays = Math.max(0, Math.round(areaMu / 2));
      const level: DjiAlertRecord["level"] = areaMu >= 60 || timesCount >= 80 ? "HIGH" : areaMu >= 30 ? "MEDIUM" : "LOW";
      return {
        parcel_id: row.id,
        parcel_name: `${row.record_date} ${row.category}`,
        level,
        age_days: ageDays,
        message: `${row.category} en ${row.record_date}: ${timesCount} salidas, ${areaMu.toFixed(2)} mu y ${usageLiters.toFixed(1)} L.`,
        geometry: null
      };
    })
  );
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<MetricsRow>(`
        SELECT
          COUNT(*)::text AS total_flights,
          COALESCE(SUM(area_mu), 0)::text AS total_area_covered,
          COUNT(*) FILTER (WHERE area_mu >= 60 OR times_count >= 80)::text AS high_alert_days,
          (SELECT COUNT(*)::text FROM dji_land_assets) AS total_assets,
          (SELECT COUNT(*)::text FROM dji_field_catalog) AS total_fields
        FROM dji_daily_summaries
      `);
      const row = result.rows[0];
      return {
        totalFlights: Number(row?.total_flights ?? 0),
        totalAreaCovered: Number(row?.total_area_covered ?? 0),
        highAlertParcels: Number(row?.high_alert_days ?? 0),
        totalAssets: Number(row?.total_assets ?? 0) + Number(row?.total_fields ?? 0)
      };
    },
    async () => {
      const flights = loadLocalSummaryRecords();
      const assets = loadLocalAssetRecords();
      const fields = loadLocalFieldCount();
      const highAlertParcels = flights.filter((flight) => Number(flight.area_mu) >= 60 || Number(flight.times_count) >= 80).length;
      return {
        totalFlights: flights.length,
        totalAreaCovered: flights.reduce((sum, flight) => sum + Number(flight.area_mu), 0),
        highAlertParcels,
        totalAssets: assets.length + fields
      };
    }
  );
}
