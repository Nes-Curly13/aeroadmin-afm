const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const {
  loadCadenceConfig,
  resolveCadence,
  BUILTIN_DEFAULTS
} = require('./lib/fumigation-cadence-config');

/**
 * Importador DJI AG — Opción B (modelo normalizado)
 *
 * (S2 / 2026-07-01) Las tablas legacy `dji_daily_summaries` y `dji_land_assets`
 * se dropearon en la migration 20260628120000 (Sprint 2, 2026-06-28). Este
 * importer ahora solo escribe `dji_parcels` (1 fila por campo, columnas planas).
 *
 * Fase 2: agrega los 3 assets por externalId, normaliza los campos del
 * parameter.json, convierte geometría a MultiPolygon y waypoints a
 * MultiPoint, y escribe 1 fila por campo a dji_parcels.
 *
 * El proceso corre dentro de una transacción — si la fase falla, rollback.
 */

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;

  const envFile = fs.readFileSync(envPath, 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function createPool() {
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  const useSsl = process.env.DATABASE_SSL === 'true';
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined
  });
}

// (Sprint 2) parseMu, parseCount, parseUsage, parseHistoryRecord,
// parseFieldCard, toIsoDate — todas eliminadas. Eran parsers del rollup
// diario legacy (records_history.json + mission_fields.json). Las tablas
// dji_daily_summaries y dji_field_catalog se dropearon; los rollups ahora
// se derivan en runtime desde dji_flights vía lib/dji-flights-aggregate.ts.

function geoJsonToGeometrySql(geojson) {
  if (!geojson) return null;
  // DJI geometry.json tiene hasta 3 features:
  //   1. funcType="PlantZone"   → Polygon (zona a fumigar)
  //   2. funcType="ReferencePoint" → MultiPoint (vacío en la mayoría de casos)
  //   3. funcType="ObstacleZone" → Polygon (obstáculos a evitar)
  //
  // Para `spray_geom` usamos SOLO el PlantZone. Los ObstacleZone se modelan
  // aparte (futuro: tabla dji_parcels.obstacles o similar).
  //
  // DJI polygons a veces vienen con self-intersections. El patrón
  // ST_Buffer(geom, 0) es el truco clásico de PostGIS: valida, repara y
  // normaliza el tipo. ST_Force2D quita la dimensión Z (siempre 0 en DJI).
  const wrap = (g) =>
    `ST_Multi(ST_Buffer(ST_Force2D(ST_GeomFromGeoJSON('${JSON.stringify(g)}')), 0))`;

  if (geojson.type === 'FeatureCollection') {
    const plantZone = geojson.features.find(
      (f) => f?.properties?.funcType === 'PlantZone' && f.geometry
    );
    if (plantZone) return wrap(plantZone.geometry);

    // Fallback: si no hay PlantZone, tomar el primer Polygon
    const firstPoly = geojson.features.find(
      (f) => f?.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );
    if (firstPoly) return wrap(firstPoly.geometry);
    return null;
  }
  if (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon') {
    return wrap(geojson);
  }
  return null;
}

function loadAssetFile(rawPath) {
  const rawText = fs.readFileSync(rawPath, 'utf8');
  try {
    return { rawText, rawJson: JSON.parse(rawText), isJson: true };
  } catch {
    return { rawText, rawJson: { format: 'xml', rawText }, isJson: false };
  }
}

// Regex para el patrón de nombre de archivo DJI:
//   {externalId}_flyer_{uuid}_{kind}.json
// Donde externalId es dígitos (account/org id) y uuid es hex con guiones.
const DJI_FILE_PATTERN = /^(\d+)-flyer-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(geometry|parameter|waypoint)\.json$/i;

// Cadencia por defecto por field_type: ahora vive en
// lib/fumigation-cadence-config.js (BUILTIN_DEFAULTS). El importer y
// scripts/seed-cadences.js comparten esa tabla única. La cadencia real
// usada en Fase 2.5 se resuelve con resolveCadence() leyendo
// config/fumigation-cadences.json.

/**
 * Extrae el `<Document><name>` de un KML de DJI.
 * Devuelve null si no se puede parsear o no hay name.
 */
function extractLandNameFromKml(kmlPath) {
  try {
    const kml = fs.readFileSync(kmlPath, 'utf8');
    const m = kml.match(/<Document>\s*<name>([^<]+)<\/name>/);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Fallback: si el scraper no pobla land_file_urls.json (bug conocido §2.1),
 * escaneamos el filesystem para reconstruir el índice a partir de los
 * archivos ya descargados. Devuelve un array con la misma forma que el
 * land_file_urls.json del scraper.
 *
 * Cada entrada: { kind, landName, uuid, externalId, url }
 *   - externalId: el ID compuesto (cuenta-flyer-uuid) que matchea
 *     con el `externalId` que usaría el scraper si hubiera funcionado
 *   - landName: extraído del KML (que sí tiene el nombre del campo)
 *   - url: vacío (los archivos están en disco, no necesitamos URL)
 */
function buildAssetIndexFromFilesystem(filesDir) {
  if (!fs.existsSync(filesDir)) return [];
  const index = [];
  const seen = new Set();
  for (const entry of fs.readdirSync(filesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const m = entry.name.match(DJI_FILE_PATTERN);
    if (!m) continue;
    const [, accountId, uuid, kind] = m;
    const externalId = `${accountId}-flyer-${uuid}`.toLowerCase();
    // Solo un asset por (externalId, kind); si hay duplicados, gana el primero
    const key = `${externalId}::${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Intentamos sacar el land_name del KML hermano
    const kmlName = extractLandNameFromKml(
      path.join(filesDir, entry.name.replace(/\.json$/, '.kml'))
    );

    index.push({
      kind,
      landName: kmlName || '',
      uuid,
      externalId,
      url: ''
    });
  }
  return index;
}

// ============================================================
// NUEVO — Helpers para Opción B
// ============================================================

/**
 * Parsea un string que contiene un JSON embebido (formato DJI donde
 * algunos campos como seg_edge_home_point vienen como string JSON).
 */
function parseEmbeddedJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

/**
 * Convierte un FeatureCollection de Points a un PostGIS MultiPoint.
 * Devuelve null si no hay puntos.
 */
function waypointsToMultiPointSql(geojson) {
  if (!geojson || geojson.type !== 'FeatureCollection') return null;
  const points = geojson.features
    .map((f) => f.geometry)
    .filter((g) => g && g.type === 'Point' && Array.isArray(g.coordinates));
  if (points.length === 0) return null;
  // Construimos un MultiPoint GeoJSON limpio
  const mp = { type: 'MultiPoint', coordinates: points.map((p) => p.coordinates) };
  return `ST_Force2D(ST_GeomFromGeoJSON('${JSON.stringify(mp)}'))`;
}

/**
 * Convierte un Point GeoJSON (o un Feature con Point) a SQL PostGIS Point.
 * Soporta 3 formatos:
 *  - GeoJSON Point: {type:"Point", coordinates:[lng,lat,alt]}
 *  - GeoJSON FeatureCollection con Point
 *  - DJI flat: {lat, lng} (formato seg_edge_home_point)
 * Devuelve null si no hay punto válido.
 */
function homePointToPointSql(value) {
  if (value === null || value === undefined || value === '') return null;
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  // Caso 1: GeoJSON Point
  if (parsed.type === 'Point' && Array.isArray(parsed.coordinates)) {
    return `ST_Force2D(ST_GeomFromGeoJSON('${JSON.stringify(parsed)}'))`;
  }

  // Caso 2: FeatureCollection con Point
  if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
    const feat = parsed.features.find((f) => f.geometry?.type === 'Point');
    if (feat) {
      return `ST_Force2D(ST_GeomFromGeoJSON('${JSON.stringify(feat.geometry)}'))`;
    }
  }

  // Caso 3: Feature con Point
  if (parsed.type === 'Feature' && parsed.geometry?.type === 'Point') {
    return `ST_Force2D(ST_GeomFromGeoJSON('${JSON.stringify(parsed.geometry)}'))`;
  }

  // Caso 4: DJI flat {lat, lng} (formato seg_edge_home_point)
  if (typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
    const point = { type: 'Point', coordinates: [parsed.lng, parsed.lat, 0] };
    return `ST_Force2D(ST_GeomFromGeoJSON('${JSON.stringify(point)}'))`;
  }

  return null;
}

/**
 * Normaliza los campos del parameter.json a columnas planas.
 * Devuelve un objeto con valores seguros (null en vez de NaN/undefined).
 */
function normalizeParameter(param) {
  if (!param || typeof param !== 'object') {
    return null;
  }
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const isOrchard = Number(param.tree_spray_selector) === 1 ? 'Orchards' : 'Farmland';
  return {
    drone_model_code: num(param.land_connect_drone_type) ?? 0,
    spray_width_m: num(param.spray_width),
    work_speed_mps: num(param.work_speed),
    optimal_heading_deg: num(param.spray_dir),
    radar_height_m: num(param.radar_height),
    edge_offset_m: num(param.edge_offset),
    obstacle_offset_m: num(param.obstacle_offset),
    climb_height_m: num(param.new_climb_height ?? param.land_climb_height),
    no_spray_zone_m2: num(param.no_spray_zone_area),
    droplet_size: num(param.droplet_size_new ?? param.droplet_size),
    sweep_direction: num(param.sweep_direction),
    is_orchard: isOrchard,
    uses_side_spray: Boolean(param.is_use_side_spray),
    inner_area_m2: num(param.inner_area)
  };
}

/**
 * Convierte el área declarada de "5.78 ha" → 5.78 (number).
 */
function parseAreaHa(areaText) {
  if (!areaText) return null;
  const n = Number(String(areaText).replace(/[^0-9.]+/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Agrupa la lista plana de assets (viene del assetIndex del scraper)
 * por externalId y adjunta los archivos leídos de land_files/.
 */
function groupAssetsByExternalId(assetIndex) {
  const grouped = new Map();
  for (const item of assetIndex) {
    const existing = grouped.get(item.externalId) || {
      externalId: item.externalId,
      landName: item.landName || '',
      assets: {}
    };
    existing.landName = existing.landName || item.landName || '';
    existing.assets[item.kind] = {
      url: item.url,
      filePath: null,
      rawText: null,
      rawJson: null,
      isJson: false
    };
    grouped.set(item.externalId, existing);
  }
  return grouped;
}

async function loadGroupedAssets(grouped, filesDir) {
  for (const entry of grouped.values()) {
    for (const kind of Object.keys(entry.assets)) {
      const fileBase = `${entry.externalId}_${kind}`.replace(/[^a-zA-Z0-9._-]/g, '_');
      const rawPath = path.join(filesDir, `${fileBase}.json`);
      if (!fs.existsSync(rawPath)) continue;
      const file = loadAssetFile(rawPath);
      entry.assets[kind].filePath = rawPath;
      entry.assets[kind].rawText = file.rawText;
      entry.assets[kind].rawJson = file.rawJson;
      entry.assets[kind].isJson = file.isJson;
    }
  }
}

/**
 * Escribe la versión normalizada (1 fila por campo) a dji_parcels.
 * Devuelve el conteo de parcelas escritas.
 */
async function writeDjiParcels(client, batchId, grouped) {
  let written = 0;
  for (const entry of grouped.values()) {
    const geometry = entry.assets.geometry;
    const parameter = entry.assets.parameter;
    const waypoint = entry.assets.waypoint;

    // parameter es la fuente principal de configuración
    if (!parameter || !parameter.isJson) {
      // Sin parameter no podemos clasificar; skip
      continue;
    }
    const norm = normalizeParameter(parameter.rawJson);
    if (!norm) continue;

    // Geometría: el PlantZone del FeatureCollection
    const sprayGeomSql = geometry?.isJson ? geoJsonToGeometrySql(geometry.rawJson) : null;

    // Waypoints: solo si hay archivo y es JSON
    const waypointsSql = waypoint?.isJson ? waypointsToMultiPointSql(waypoint.rawJson) : null;
    const waypointCount = waypoint?.isJson
      ? (waypoint.rawJson?.features?.length ?? 0)
      : null;

    // Home point: lo sacamos del parameter.seg_edge_home_point
    const refPointSql = homePointToPointSql(parameter.rawJson.seg_edge_home_point);

    const sql = `
      INSERT INTO dji_parcels (
        batch_id, external_id, land_name, field_type,
        declared_area_ha, spray_area_m2,
        drone_model_code, drone_model_name,
        spray_width_m, work_speed_mps, optimal_heading_deg, radar_height_m,
        edge_offset_m, obstacle_offset_m, climb_height_m,
        no_spray_zone_m2, droplet_size, sweep_direction,
        is_orchard, uses_side_spray,
        spray_geom, reference_point, waypoints, waypoint_count,
        source_url_geometry, source_url_parameter, source_url_waypoint,
        raw_geometry, raw_parameter, raw_waypoint
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6,
        $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15,
        $16, $17, $18,
        $19, $20,
        ${sprayGeomSql ?? 'NULL'},
        ${refPointSql ?? 'NULL'},
        ${waypointsSql ?? 'NULL'},
        $21,
        $22, $23, $24,
        $25::jsonb, $26::jsonb, $27::jsonb
      )
      ON CONFLICT (batch_id, external_id) DO UPDATE SET
        land_name = EXCLUDED.land_name,
        field_type = EXCLUDED.field_type,
        declared_area_ha = EXCLUDED.declared_area_ha,
        spray_area_m2 = EXCLUDED.spray_area_m2,
        drone_model_code = EXCLUDED.drone_model_code,
        drone_model_name = EXCLUDED.drone_model_name,
        spray_width_m = EXCLUDED.spray_width_m,
        work_speed_mps = EXCLUDED.work_speed_mps,
        optimal_heading_deg = EXCLUDED.optimal_heading_deg,
        radar_height_m = EXCLUDED.radar_height_m,
        edge_offset_m = EXCLUDED.edge_offset_m,
        obstacle_offset_m = EXCLUDED.obstacle_offset_m,
        climb_height_m = EXCLUDED.climb_height_m,
        no_spray_zone_m2 = EXCLUDED.no_spray_zone_m2,
        droplet_size = EXCLUDED.droplet_size,
        sweep_direction = EXCLUDED.sweep_direction,
        is_orchard = EXCLUDED.is_orchard,
        uses_side_spray = EXCLUDED.uses_side_spray,
        spray_geom = EXCLUDED.spray_geom,
        reference_point = EXCLUDED.reference_point,
        waypoints = EXCLUDED.waypoints,
        waypoint_count = EXCLUDED.waypoint_count,
        source_url_geometry = EXCLUDED.source_url_geometry,
        source_url_parameter = EXCLUDED.source_url_parameter,
        source_url_waypoint = EXCLUDED.source_url_waypoint,
        raw_geometry = EXCLUDED.raw_geometry,
        raw_parameter = EXCLUDED.raw_parameter,
        raw_waypoint = EXCLUDED.raw_waypoint,
        fetched_at = NOW()
    `;

    await client.query(sql, [
      batchId,
      entry.externalId,
      entry.landName || null,
      norm.is_orchard,
      parseAreaHa(null), // declared_area_ha queda NULL: DJI no expone área declarada por catálogo, se carga vía input del operador (ver dji_fumigation_schedule + UI de edición)
      norm.inner_area_m2,
      norm.drone_model_code,
      null, // drone_model_name — se puede resolver con un lookup JOIN en queries
      norm.spray_width_m,
      norm.work_speed_mps,
      norm.optimal_heading_deg,
      norm.radar_height_m,
      norm.edge_offset_m,
      norm.obstacle_offset_m,
      norm.climb_height_m,
      norm.no_spray_zone_m2,
      norm.droplet_size,
      norm.sweep_direction,
      norm.is_orchard === 'Orchards',
      norm.uses_side_spray,
      waypointCount,
      geometry?.url ?? null,
      parameter?.url ?? null,
      waypoint?.url ?? null,
      geometry?.isJson ? JSON.stringify(geometry.rawJson) : null,
      parameter?.isJson ? JSON.stringify(parameter.rawJson) : null,
      waypoint?.isJson ? JSON.stringify(waypoint.rawJson) : null
    ]);
    written += 1;
  }
  return written;
}

async function main() {
  loadLocalEnv();
  const root = path.join(process.cwd(), 'djiag_exports');
  const schemaSql = fs.readFileSync(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8');
  const filesDir = path.join(root, 'land_files');

  // (Sprint 2) records_history.json y mission_fields.json ya no se leen —
  // las tablas dji_daily_summaries y dji_field_catalog se dropearon.
  // Los rollups se derivan en runtime desde dji_flights vía el agregador.

  // assetIndex puede venir vacío si el scraper no completó la captura de
  // URLs (bug conocido §2.1 — filtra un endpoint que DJI no usa).
  // En ese caso, reconstruimos desde los archivos en disco.
  const urlIndexPath = path.join(root, 'land_file_urls.json');
  let assetIndex = [];
  if (fs.existsSync(urlIndexPath)) {
    try {
      assetIndex = JSON.parse(fs.readFileSync(urlIndexPath, 'utf8'));
    } catch (err) {
      console.warn(`land_file_urls.json no es JSON válido (${err.message}), usando fallback filesystem.`);
    }
  }
  if (!Array.isArray(assetIndex) || assetIndex.length === 0) {
    const fallback = buildAssetIndexFromFilesystem(filesDir);
    if (fallback.length > 0) {
      console.warn(
        `land_file_urls.json vacío — fallback: ${fallback.length} assets reconstruidos desde ${filesDir}.`
      );
      assetIndex = fallback;
    } else {
      console.warn(
        'No hay assets ni en land_file_urls.json ni en land_files/. dji_parcels quedará vacía.'
      );
    }
  }

  const pool = createPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(schemaSql);
    // Fase 1: limpieza. (S2 / 2026-07-01) Las tablas dji_land_assets y
    // dji_daily_summaries se dropearon en la migration 20260628120000.
    // Solo limpiamos las tablas que SÍ existen en el modelo normalizado.
    //
    // (S4 / 2026-07-03) BUGFIX: el TRUNCATE ... CASCADE anterior borraba
    // también `dji_flights` y `dji_fumigations` (las 7710 flights y 714
    // fumigations se perdían en cada corrida). El comentario antiguo
    // afirmaba que fumigations NO se truncaban, pero TRUNCATE CASCADE
    // borra TODAS las tablas con FK sin importar el ON DELETE rule.
    //
    // Solución: en vez de TRUNCATE CASCADE, usamos DELETE FROM con un
    // subset explícito de tablas donde CASCADE es SEGURO. Esto:
    //   - Borra dji_parcels (la idea del importer)
    //   - Borra dji_fumigation_schedule (tiene FK ON DELETE CASCADE a
    //     dji_parcels — se reconstruye en Fase 2.5)
    //   - Borra dji_fumigations PER-PARCEL (tiene FK ON DELETE CASCADE
    //     a dji_parcels — se reconstruye via backfill-fumigations-from-flights)
    //   - PRESERVA dji_fumigations AGGREGATE (parcel_id IS NULL — no tiene FK)
    //   - PRESERVA dji_flights.parcel_id (FK ON DELETE SET NULL — los flights
    //     quedan con parcel_id=NULL y se re-spajoinean después)
    //   - NO resetea sequences (SERIAL/IDENTITY), así que las IDs son estables.
    //     Si se quiere resetear, agregar RESTART IDENTITY explícito por tabla.
    await client.query(`
      DELETE FROM dji_fumigation_schedule;
      DELETE FROM dji_fumigations WHERE parcel_id IS NOT NULL;
      DELETE FROM dji_parcels;
      DELETE FROM dji_import_batches;
    `);

    const batchResult = await client.query(
      "INSERT INTO dji_import_batches (source) VALUES ('djiag') RETURNING id"
    );
    const batchId = batchResult.rows[0].id;

    // (Sprint 2) Loop de history eliminado — dji_daily_summaries ya no existe.
    // Los rollups diarios ahora se derivan en runtime desde dji_flights.
    // (S2 / 2026-07-01) Loop de assets a dji_land_assets eliminado — la tabla
    // ya no existe. La data cruda de cada asset se preserva en dji_parcels
    // (raw_geometry, raw_parameter, raw_waypoint como JSONB).

    // Fase 2: Opción B — agrupar assets por externalId y escribir dji_parcels
    const grouped = groupAssetsByExternalId(assetIndex);
    await loadGroupedAssets(grouped, filesDir);
    const parcelsWritten = await writeDjiParcels(client, batchId, grouped);

    // Fase 2.5: schedule de fumigación (1 fila por parcela activa)
    //
    // La cadencia se resuelve por parcela con resolveCadence() leyendo
    // config/fumigation-cadences.json (override parcel > drone > crop >
    // default). Si el archivo no existe, se usan los builtin defaults
    // (Caña 14d, Frutales 10d) — el importer debe poder correr offline.
    //
    // Idempotencia:
    //   - INSERT si no existe schedule
    //   - UPDATE solo si last_fumigation_date IS NULL (no pisa fumigaciones reales)
    //   - Re-correr el importer con un config cambiado actualiza los schedules
    //     que aún no tienen fumigación, sin tocar los demás.
    const cadenceConfig = loadCadenceConfig(
      process.env.FUMIGATION_CADENCES_CONFIG ??
        path.join(process.cwd(), 'config', 'fumigation-cadences.json')
    );
    console.log(`[cadence] source: ${cadenceConfig._source}`);

    const parcelsForSchedule = await client.query(`
      SELECT
        p.id, p.external_id, p.field_type, p.is_orchard, p.drone_model_code,
        s.crop_type AS current_crop_type,
        s.recommended_cadence_days AS current_cadence,
        s.last_fumigation_date
      FROM dji_parcels p
      LEFT JOIN dji_fumigation_schedule s ON s.parcel_id = p.id
      WHERE p.batch_id = $1
    `, [batchId]);

    let schedulesInserted = 0;
    let schedulesUpdated = 0;
    let schedulesSkipped = 0;
    for (const row of parcelsForSchedule.rows) {
      if (row.last_fumigation_date) {
        schedulesSkipped += 1;
        continue;
      }
      const resolved = resolveCadence(
        {
          externalId: row.external_id,
          droneModelCode: row.drone_model_code,
          fieldType: row.field_type,
          currentCropType: row.current_crop_type
        },
        cadenceConfig
      );
      const r = await client.query(
        `
          INSERT INTO dji_fumigation_schedule
            (parcel_id, crop_type, recommended_cadence_days, is_active)
          VALUES ($1, $2, $3, true)
          ON CONFLICT (parcel_id) DO UPDATE
          SET crop_type = EXCLUDED.crop_type,
              recommended_cadence_days = EXCLUDED.recommended_cadence_days,
              updated_at = NOW()
          WHERE dji_fumigation_schedule.last_fumigation_date IS NULL
          RETURNING (xmax = 0) AS inserted
        `,
        [row.id, resolved.crop_type, resolved.cadence_days]
      );
      const wasInsert = r.rows[0]?.inserted === true;
      if (wasInsert) {
        schedulesInserted += 1;
      } else if (r.rowCount > 0) {
        schedulesUpdated += 1;
      }
    }
    const schedulesWritten = schedulesInserted + schedulesUpdated;

    // Enriquecer drone_model_name desde la tabla lookup
    await client.query(`
      UPDATE dji_parcels p
      SET drone_model_name = d.name
      FROM dji_drone_models d
      WHERE p.drone_model_code = d.code
        AND p.drone_model_name IS NULL
    `);

    await client.query('COMMIT');
    console.log(
      `Imported batch ${batchId}: ${assetIndex.length} asset records, ${parcelsWritten} normalized parcels, ${schedulesWritten} fumigation schedules (${schedulesInserted} new, ${schedulesUpdated} updated, ${schedulesSkipped} skipped)`
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

// ============================================================
// Exports — para tests y reutilización
// ============================================================
module.exports = {
  main,
  // parsers
  parseAreaHa,
  parseEmbeddedJson,
  // geometry helpers
  geoJsonToGeometrySql,
  waypointsToMultiPointSql,
  homePointToPointSql,
  // aggregator
  groupAssetsByExternalId,
  loadGroupedAssets,
  normalizeParameter,
  writeDjiParcels,
  // filesystem fallback
  buildAssetIndexFromFilesystem,
  extractLandNameFromKml,
  DJI_FILE_PATTERN,
  // re-exported from lib/fumigation-cadence-config for tests
  loadCadenceConfig,
  resolveCadence
};
