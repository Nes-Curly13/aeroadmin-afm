import { getDb } from "@/lib/db";
import fs from "node:fs";
import path from "node:path";
import type {
  DashboardMetrics,
  DjiAssetRecord,
  DjiDailySummaryRecord,
  DjiFlightRecord,
  DjiAlertRecord,
  DjiParcelRecord
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
