// lib/djiag-spatial-aggregator.ts
//
// Agregador espacial para la vista Task History (Figma frame B).
//
// Source:
//   - `dji_parcels` (id, land_name, declared_area_ha, spray_geom, ...)
//   - `dji_flights` (parcel_id, start_at, drone_serial, pilot_name, ...)
//
// El join `dji_flights.parcel_id -> dji_parcels.id` se llena en el backfill
// espacial (scripts/spatial-join-flights-parcels.js). Hoy (2026-07-12) está
// 100% completado — todos los flights agrícolas tienen parcel_id asignado.
//
// Función principal: `getPolygonsInRange`. Dos modos:
//   - `onlyFumigated: true`  → INNER JOIN: solo parcelas con al menos 1
//     vuelo en el rango [from, to]. Cada parcela trae `datesFumigated` con
//     los días en que se fumigó (en TZ America/Bogota, igual que el resto
//     de la app).
//   - `onlyFumigated: false` → TODAS las parcelas con `spray_geom` (1207/1207
//     hoy), sin importar si hubo vuelo en el rango. `datesFumigated` queda
//     `[]` si la parcela no tuvo actividad en el rango.
//
// Filtros adicionales (todos opcionales, todos AND entre sí):
//   - `parcelId: number`     → filtra a una parcela específica
//   - `droneSerial: string`  → flights con `drone_serial` exacto
//   - `pilot: string`        → flights con `pilot_name` exacto
//
// Por qué los filtros van a `datesFumigated` (no a la lista de parcelas) en
// el modo `onlyFumigated: true`: si filtrás por drone, querés ver solo las
// parcelas fumigadas POR ESE drone. Si filtrás por piloto, lo mismo.
//
// Por qué `datesFumigated` viene como YYYY-MM-DD string: pg devuelve `date`
// como objeto `Date` JS; la API lo normaliza en el boundary para que el
// frontend no reciba `[object Date]` (mismo patrón que `getFumigationEventsByParcel`).
//
// Por qué `geometry` viene como `GeoJSON.Geometry | null`: ST_AsGeoJSON(spray_geom)::json
// devuelve el GeoJSON crudo (MultiPolygon). `null` cuando spray_geom es NULL
// (~2 parcelas nuevas del re-scrape atómico 2026-07-11; ver figma-vs-bd.md gap #1).
//
// Tests: tests/djiag-spatial-aggregator.test.ts cubre ambos modos con DB mockeada.

import { getDb } from "@/lib/db";
import { toDateString } from "@/lib/format";

/** Parámetros de entrada de `getPolygonsInRange`. */
export interface PolygonsQuery {
  /** YYYY-MM-DD inclusive. */
  from: string;
  /** YYYY-MM-DD inclusive. */
  to: string;
  /**
   * - `true`  → solo parcelas fumigadas en el rango
   * - `false` → todas las parcelas con `spray_geom` (default UI: false;
   *             el caller decide según qué vista del mapa está renderizando)
   */
  onlyFumigated: boolean;
  /** Filtro opcional por id de parcela (1-N). */
  parcelId?: number;
  /** Filtro opcional por serial de dron (match exacto). */
  droneSerial?: string;
  /** Filtro opcional por nombre de piloto (match exacto). */
  pilot?: string;
}

/** Una parcela fumigada con su geometría + lista de días fumigados. */
export interface PolygonInfo {
  parcelId: number;
  landName: string | null;
  /** Hectáreas declaradas. Viene de `dji_parcels.declared_area_ha` (PostGIS area backfill). */
  areaHa: number | null;
  /** YYYY-MM-DD strings, ordenadas asc. Vacío si `onlyFumigated: false` y no hubo vuelo. */
  datesFumigated: string[];
  /** GeoJSON (MultiPolygon/Polygon) o null si `spray_geom` es NULL. */
  geometry: GeoJSON.Geometry | null;
}

/** Row cruda que devuelve pg.query. */
interface PolygonDbRow {
  parcel_id: number;
  land_name: string | null;
  declared_area_ha: number | null;
  dates_fumigated: string[] | null;
  geometry: GeoJSON.Geometry | string | null;
}

/**
 * Devuelve la lista de polígonos fumigados (o todas las parcelas con
 * `spray_geom`, según `onlyFumigated`) en el rango [from, to] con los
 * filtros opcionales aplicados.
 *
 * Si la BD está offline, devuelve `[]` (no rompe la API; el caller puede
 * decidir qué hacer — la ruta de /api/task-history devuelve 500 en ese caso).
 */
export async function getPolygonsInRange(query: PolygonsQuery): Promise<PolygonInfo[]> {
  // Despacho a una de las dos variantes segun el flag. Cada variante tiene
  // su propia logica de placeholders (INNER JOIN vs subquery lateral) y
  // compartir una sola funcion las hace ilegibles.
  const result = query.onlyFumigated
    ? await runOnlyFumigatedQuery(query)
    : await runAllParcelsQuery(query);

  return result.rows.map((row: PolygonDbRow) => ({
    parcelId: row.parcel_id,
    landName: row.land_name,
    areaHa: row.declared_area_ha === null ? null : Number(row.declared_area_ha),
    // pg devuelve array_agg de text como string[]; ya viene en formato
    // YYYY-MM-DD porque el to_char arriba.
    datesFumigated: (row.dates_fumigated ?? []).map((d) => toDateString(d) ?? String(d)),
    geometry: parseGeometry(row.geometry)
  }));
}

/** Modo `onlyFumigated: true`: INNER JOIN, solo parcelas fumigadas. */
async function runOnlyFumigatedQuery(
  query: PolygonsQuery
): Promise<{ rows: PolygonDbRow[] }> {
  const db = getDb();
  const params: unknown[] = [query.from, query.to];
  const filters: string[] = [];

  // Los placeholders arrancan en $3 (from=$1, to=$2)
  if (query.droneSerial) {
    params.push(query.droneSerial);
    filters.push(`f.drone_serial = $${params.length}`);
  }
  if (query.pilot) {
    params.push(query.pilot);
    filters.push(`f.pilot_name = $${params.length}`);
  }
  if (query.parcelId !== undefined) {
    params.push(query.parcelId);
    filters.push(`p.id = $${params.length}`);
  }

  const whereExtras = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";

  const sql = `
    SELECT
      p.id AS parcel_id,
      p.land_name,
      p.declared_area_ha,
      ST_AsGeoJSON(p.spray_geom)::json AS geometry,
      array_agg(DISTINCT to_char(
                 (f.start_at AT TIME ZONE 'America/Bogota')::date,
                 'YYYY-MM-DD'
               ) ORDER BY to_char(
                 (f.start_at AT TIME ZONE 'America/Bogota')::date,
                 'YYYY-MM-DD'
               )) AS dates_fumigated
    FROM dji_parcels p
    INNER JOIN dji_flights f
      ON f.parcel_id = p.id
     AND f.start_at >= $1::date
     AND f.start_at <  ($2::date + INTERVAL '1 day')
    WHERE p.spray_geom IS NOT NULL
      -- Sprint B — H1: soft delete. Excluimos parcelas borradas del mapa
      -- de Task History. Si se borra una parcela, su polígono no debe
      -- seguir visible para el operador.
      AND p.deleted_at IS NULL
      ${whereExtras}
    GROUP BY p.id, p.land_name, p.declared_area_ha, p.spray_geom
    ORDER BY p.land_name NULLS LAST, p.id ASC
  `;
  const result = await db.query<PolygonDbRow>(sql, params);
  return { rows: result.rows };
}

/** Modo `onlyFumigated: false`: TODAS las parcelas con spray_geom. */
async function runAllParcelsQuery(query: PolygonsQuery): Promise<{ rows: PolygonDbRow[] }> {
  const db = getDb();
  const params: unknown[] = [query.from, query.to];
  let lateralFilters = "";
  let extraFilters = "";

  if (query.droneSerial) {
    params.push(query.droneSerial);
    lateralFilters += ` AND f.drone_serial = $${params.length}`;
  }
  if (query.pilot) {
    params.push(query.pilot);
    lateralFilters += ` AND f.pilot_name = $${params.length}`;
  }
  if (query.parcelId !== undefined) {
    params.push(query.parcelId);
    extraFilters = `AND p.id = $${params.length}`;
  }

  const sql = `
    SELECT
      p.id AS parcel_id,
      p.land_name,
      p.declared_area_ha,
      ST_AsGeoJSON(p.spray_geom)::json AS geometry,
      COALESCE(
        (
          SELECT array_agg(DISTINCT to_char(
                     (f.start_at AT TIME ZONE 'America/Bogota')::date,
                     'YYYY-MM-DD'
                   ) ORDER BY to_char(
                     (f.start_at AT TIME ZONE 'America/Bogota')::date,
                     'YYYY-MM-DD'
                   ))
            FROM dji_flights f
           WHERE f.parcel_id = p.id
             AND f.start_at >= $1::date
             AND f.start_at <  ($2::date + INTERVAL '1 day')
             ${lateralFilters}
        ),
        ARRAY[]::text[]
      ) AS dates_fumigated
    FROM dji_parcels p
    WHERE p.spray_geom IS NOT NULL
      -- Sprint B — H1: soft delete. Mismo criterio que runOnlyFumigatedQuery.
      AND p.deleted_at IS NULL
      ${extraFilters}
    ORDER BY p.land_name NULLS LAST, p.id ASC
  `;
  const result = await db.query<PolygonDbRow>(sql, params);
  return { rows: result.rows };
}

/**
 * `ST_AsGeoJSON(...)::json` en pg devuelve un objeto JSON (que `pg` parsea
 * a JS object automáticamente). Pero a veces llega como string si el driver
 * no se configuró con el type parser de JSON. Aceptamos ambas formas.
 */
function parseGeometry(raw: GeoJSON.Geometry | string | null): GeoJSON.Geometry | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as GeoJSON.Geometry;
    } catch {
      return null;
    }
  }
  return raw;
}
