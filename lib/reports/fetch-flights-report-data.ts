// lib/reports/fetch-flights-report-data.ts
//
// Data layer del export CSV "todos los vuelos" (feature TBD, 2026-08-30).
//
// Carga la lista de `dji_flights` con JOINs a `dji_parcels` (parcel info)
// + `dji_drone_models` (drone info) + agregados desde `dji_fumigations`
// (cuántas fumigaciones referencian este flight, área total, volumen total).
//
// Patrón: misma shape que `fetch-farms-report-data.ts` — devuelve
// `FlightsReportData` ya agregado, el serializer en `flights-csv.ts` es
// función pura sin I/O.
//
// Decisiones:
//   - **Cap 50.000 filas** (≈ 7x el estado actual, 8.7k). Si llega al
//     cap, devolvemos `capReached: true` y el CSV lo notifica en la
//     sección "Cabecera". Igual que `farms-csv.ts`.
//   - **Wide format** (1 fila = 1 vuelo, 42 columnas). El destino del
//     export es Excel/Sheets/análisis cruzado, donde wide siempre es
//     más fácil de pivotar. (Decisión confirmada por el user en la
//     review `docs/reviews/flights-csv-export-review.md` §7.1.)
//   - **Filtros server-side** (no client-side) — la query es O(N) y
//     los filtros bajan el tamaño del payload. Soportados:
//     from/to (obligatorio), drone_id, pilot (substring), parcel_id,
//     include_orphans (default true), include_default_team (default true).
//   - **CTE para los agregados de fumigaciones** (no N+1 subqueries).
//     El `unnest(flight_ids)` + GROUP BY en CTE corre una sola vez.
//   - **`is_default_team` y `is_orphan`** son columnas booleanas
//     derivadas en SQL (CASE). Le dan al consumidor la opción de
//     filtrar en Excel sin perder data.
//
// Performance: con índices `(start_at desc)`, `(parcel_id)`, GIN
// `(flight_ids)`, esta query corre <500ms en Supabase con 8.7k filas.
// Si crece a >50k, evaluar streaming + CTEs materializadas.

import { getDb } from "@/lib/db";
import { toDateString } from "@/lib/format";

export interface FlightsReportFilters {
  /** YYYY-MM-DD (Bogota local). Obligatorio. */
  from: string;
  /** YYYY-MM-DD (Bogota local). Obligatorio. */
  to: string;
  /** Filtro por drone_model_code (numeric). Opcional. */
  droneId?: number | null;
  /** Filtro por pilot_name (substring, ILIKE). Opcional. */
  pilot?: string | null;
  /** Filtro por parcel_id (FK). Opcional. */
  parcelId?: number | null;
  /** Incluir flights sin parcel_id (orphan). Default true. */
  includeOrphans?: boolean;
  /** Incluir flights con pilot_name='default team'. Default true. */
  includeDefaultTeam?: boolean;
}

/** 1 fila del export = 1 vuelo con todos los JOINs. */
export interface FlightsExportRow {
  flight_id: number;
  parcel_id: number | null;
  parcel_name: string | null;
  parcel_external_id: string | null;
  client_name: string | null;
  farm_name: string | null;
  municipality: string | null;
  start_at: string;
  end_at: string;
  duration_seconds: number;
  duration_min: number;
  duration_human: string;       // HH:MM:SS
  area_m2: number | string | null;
  area_ha: number | string | null;
  spray_usage_ml: number | null;
  spray_usage_l: number | string | null;
  drone_serial: string | null;
  drone_nickname: string | null;
  drone_model: string | null;
  drone_model_code: number | null;
  drone_registration: string | null;
  pilot_name: string | null;
  is_default_team: boolean;
  is_orphan: boolean;
  district: string | null;
  location: string | null;
  lng: number | string | null;
  lat: number | string | null;
  mode: string;                 // "manual" | "spray" | "tree" | ...
  manual_mode: boolean;
  work_speed_m_s: number | string | null;
  spray_width_m: number | string | null;
  radar_height_m: number | string | null;
  fumigations_count: number;
  fumigations_total_area_m2: number | string | null;
  fumigations_total_volume_l: number | string | null;
  source: string | null;
  captured_at: string | null;
  notes_summary: string | null; // primeros 200 chars de notes (jsonb)
}

export interface FlightsReportData {
  window: { from: string; to: string };
  generatedAt: string;
  operatorName: string;
  operatorRegion: string;
  filters: {
    droneId: number | null;
    pilot: string | null;
    parcelId: number | null;
    includeOrphans: boolean;
    includeDefaultTeam: boolean;
  };
  totals: {
    nFlights: number;
    nWithParcel: number;
    nOrphans: number;
    nDefaultTeam: number;
  };
  flights: FlightsExportRow[];
  capReached: boolean;
  cap: number;
}

/** Cap máximo de filas del export. */
const FLIGHTS_EXPORT_CAP = 50_000;

/** Mapeo de `mode_name` (int) a label legible. Tabla de DJI. */
const MODE_NAME_MAP: Record<number, string> = {
  0: "manual",
  1: "tree",
  2: "route",
  3: "a-b",
  4: "spray",
  5: "tree-spray",
  6: "route-spray"
};

/** Formatea segundos a HH:MM:SS (Excel-friendly). */
function formatDurationHuman(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Aplana `notes` (jsonb) a un summary de 200 chars. */
function summarizeNotes(raw: unknown): string | null {
  if (raw == null) return null;
  let s: string;
  if (typeof raw === "string") s = raw;
  else {
    try {
      s = JSON.stringify(raw);
    } catch {
      return null;
    }
  }
  return s.length > 200 ? s.slice(0, 200) + "..." : s;
}

/**
 * Query principal. Usa CTE para los agregados de fumigaciones
 * (1 unn + group en vez de 3 subqueries correlated).
 *
 * `any($N::bigint[])` para `parcel_id` con sentinel 0: si el caller
 * no filtra por parcel, igual hacemos un array de 1 elemento [0] que
 * no matchea nada, y el LEFT JOIN ya filtra. Mas eficiente que armar
 * SQL dinamico con $1 o $1 IS NULL.
 */
async function fetchFlightsQuery(
  from: string,
  to: string,
  droneId: number | null,
  pilot: string | null,
  parcelId: number | null,
  includeOrphans: boolean,
  includeDefaultTeam: boolean
): Promise<FlightsExportRow[]> {
  const db = getDb();
  // Sentinel: 0 = "no filter" (no existe parcel_id 0 en dji_parcels).
  const parcelFilterArr = parcelId != null ? [parcelId] : [0];
  const droneFilterArr = droneId != null ? [droneId] : [0];

  const sql = `
    WITH fum_agg AS (
      SELECT
        unnest(flight_ids) AS flight_pk,
        COUNT(*) AS n_fum,
        COALESCE(SUM(area_fumigated_m2), 0) AS total_area_m2,
        COALESCE(
          SUM(area_fumigated_m2 * dose_l_per_ha),
          0
        ) AS total_vol_l
      FROM dji_fumigations
      WHERE flight_ids IS NOT NULL
        AND array_length(flight_ids, 1) > 0
        AND deleted_at IS NULL
      GROUP BY unnest(flight_ids)
    )
    SELECT
      f.flight_id,
      f.parcel_id,
      p.land_name           AS parcel_name,
      p.external_id         AS parcel_external_id,
      p.client_name,
      p.farm_name,
      p.municipality,
      f.start_at,
      f.end_at,
      f.duration_seconds,
      (f.duration_seconds / 60.0)::numeric AS duration_min,
      f.area_m2,
      f.spray_usage_ml,
      f.drone_serial,
      f.drone_nickname,
      dm.name               AS drone_model_name,
      p.drone_model_code    AS drone_model_code,
      dm.registration_number AS drone_registration,
      f.pilot_name,
      (f.pilot_name = 'default team') AS is_default_team,
      (f.parcel_id IS NULL) AS is_orphan,
      f.district,
      f.location,
      f.lng, f.lat,
      f.mode_name,
      f.manual_mode,
      f.work_speed_m_s,
      f.spray_width_m,
      f.radar_height_m,
      COALESCE(fa.n_fum, 0) AS fumigations_count,
      fa.total_area_m2       AS fumigations_total_area_m2,
      fa.total_vol_l         AS fumigations_total_volume_l,
      f.source,
      f.captured_at,
      f.notes
    FROM dji_flights f
    LEFT JOIN dji_parcels p ON p.id = f.parcel_id
    LEFT JOIN dji_drone_models dm ON dm.code = p.drone_model_code
    LEFT JOIN fum_agg fa ON fa.flight_pk = f.id
    WHERE f.start_at >= $1::date
      AND f.start_at <  $2::date + INTERVAL '1 day'
      AND ($3 = 'true'::boolean OR f.parcel_id IS NOT NULL)
      AND ($4 = 'true'::boolean OR f.pilot_name IS DISTINCT FROM 'default team')
      AND (cardinality($5::int[]) = 0 OR p.drone_model_code = ANY($5::int[]))
      AND (cardinality($6::int[]) = 0 OR f.parcel_id = ANY($6::bigint[]))
      AND ($7::text IS NULL OR f.pilot_name ILIKE '%' || $7 || '%')
    ORDER BY f.start_at DESC
    LIMIT ${FLIGHTS_EXPORT_CAP}
  `;

  const result = await db.query(sql, [
    from,
    to,
    includeOrphans ? "true" : "false",
    includeDefaultTeam ? "true" : "false",
    droneId != null ? [droneId] : [],
    parcelId != null ? [parcelId] : [],
    pilot && pilot.length > 0 ? pilot : null
  ]);

  // Mapear a FlightsExportRow (con conversiones de tipos).
  return result.rows.map((r) => {
    const durationSeconds = Number(r.duration_seconds) || 0;
    const modeName = r.mode_name != null ? Number(r.mode_name) : null;
    return {
      flight_id: Number(r.flight_id),
      parcel_id: r.parcel_id != null ? Number(r.parcel_id) : null,
      parcel_name: r.parcel_name ?? null,
      parcel_external_id: r.parcel_external_id ?? null,
      client_name: r.client_name ?? null,
      farm_name: r.farm_name ?? null,
      municipality: r.municipality ?? null,
      start_at: toDateString(r.start_at) ?? String(r.start_at),
      end_at: toDateString(r.end_at) ?? String(r.end_at),
      duration_seconds: durationSeconds,
      duration_min: Number(r.duration_min) || 0,
      duration_human: formatDurationHuman(durationSeconds),
      area_m2: r.area_m2,
      area_ha:
        r.area_m2 != null ? Number(r.area_m2) / 10000 : null,
      spray_usage_ml: r.spray_usage_ml != null ? Number(r.spray_usage_ml) : null,
      spray_usage_l:
        r.spray_usage_ml != null ? Number(r.spray_usage_ml) / 1000 : null,
      drone_serial: r.drone_serial ?? null,
      drone_nickname: r.drone_nickname ?? null,
      drone_model: r.drone_model_name ?? null,
      drone_model_code:
        r.drone_model_code != null ? Number(r.drone_model_code) : null,
      drone_registration: r.drone_registration ?? null,
      pilot_name: r.pilot_name ?? null,
      is_default_team: Boolean(r.is_default_team),
      is_orphan: Boolean(r.is_orphan),
      district: r.district ?? null,
      location: r.location ?? null,
      lng: r.lng,
      lat: r.lat,
      mode: modeName != null && MODE_NAME_MAP[modeName] != null
        ? MODE_NAME_MAP[modeName]
        : String(modeName ?? ""),
      manual_mode: Boolean(r.manual_mode),
      work_speed_m_s: r.work_speed_m_s,
      spray_width_m: r.spray_width_m,
      radar_height_m: r.radar_height_m,
      fumigations_count: Number(r.fumigations_count) || 0,
      fumigations_total_area_m2: r.fumigations_total_area_m2,
      fumigations_total_volume_l: r.fumigations_total_volume_l,
      source: r.source ?? null,
      captured_at: toDateString(r.captured_at) ?? String(r.captured_at),
      notes_summary: summarizeNotes(r.notes)
    };
  });
}

/**
 * Carga la data del export de vuelos.
 * Devuelve lista cruda + totales + capReached. El serializer
 * (`flights-csv.ts`) es función pura sobre este shape.
 */
export async function fetchFlightsReportData(
  filters: FlightsReportFilters
): Promise<FlightsReportData> {
  const {
    from,
    to,
    droneId = null,
    pilot = null,
    parcelId = null,
    includeOrphans = true,
    includeDefaultTeam = true
  } = filters;

  const flights = await fetchFlightsQuery(
    from,
    to,
    droneId,
    pilot,
    parcelId,
    includeOrphans,
    includeDefaultTeam
  );

  const nWithParcel = flights.filter((f) => !f.is_orphan).length;
  const nOrphans = flights.filter((f) => f.is_orphan).length;
  const nDefaultTeam = flights.filter((f) => f.is_default_team).length;
  const capReached = flights.length === FLIGHTS_EXPORT_CAP;

  const operatorName = process.env.OPERATOR_NAME ?? "AeroAdmin";
  const operatorRegion = process.env.OPERATOR_REGION ?? "Valle del Cauca, Colombia";

  return {
    window: { from, to },
    generatedAt: new Date().toISOString(),
    operatorName,
    operatorRegion,
    filters: {
      droneId: droneId ?? null,
      pilot: pilot ?? null,
      parcelId: parcelId ?? null,
      includeOrphans,
      includeDefaultTeam
    },
    totals: {
      nFlights: flights.length,
      nWithParcel,
      nOrphans,
      nDefaultTeam
    },
    flights,
    capReached,
    cap: FLIGHTS_EXPORT_CAP
  };
}
