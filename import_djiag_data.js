const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

/**
 * Importador DJI AG — Opción B (modelo normalizado)
 *
 * Fase 1: mantiene el comportamiento legacy (escribe dji_daily_summaries,
 *         dji_field_catalog, dji_land_assets) — el dashboard actual sigue
 *         funcionando sin cambios.
 *
 * Fase 2: nueva — agrega los 3 assets por externalId, normaliza los campos
 *         del parameter.json, convierte geometría a MultiPolygon y waypoints
 *         a MultiPoint, y escribe 1 fila por campo a dji_parcels.
 *
 * El proceso corre dentro de la misma transacción, así que si la nueva
 * fase falla se hace rollback de ambas escrituras.
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

function parseMu(value) {
  const n = Number(String(value).replace(/[^0-9.]+/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseCount(value) {
  const n = Number(String(value).replace(/[^0-9]+/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseUsage(value) {
  return parseMu(value);
}

function toIsoDate(dateStr) {
  const match = String(dateStr ?? '').match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (!match) {
    throw new Error(`Unable to parse date from "${dateStr}"`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseHistoryRecord(item) {
  const raw = String(item.raw ?? '');
  const dateMatch = raw.match(/^(\d{4}\/\d{2}\/\d{2})/);
  const date = item.date || (dateMatch ? dateMatch[1] : null);
  if (!date) {
    throw new Error(`Missing record date for history row: ${raw}`);
  }

  const weekdayMatch = raw.match(/^\d{4}\/\d{2}\/\d{2}([A-Za-z]+)Agriculture/);
  const areaMatch = raw.match(/Agriculture([\d.]+)mu/);
  const timesMatch = raw.match(/mu(\d+)times/);
  const usageMatch = raw.match(/times([\d.]+)L-/);
  const workTimeMatch = raw.match(/L-(.+)$/);

  return {
    date,
    weekday: item.weekday || weekdayMatch?.[1] || null,
    category: item.category || 'Agriculture',
    area: item.area || areaMatch?.[1] || '0',
    times: item.times || timesMatch?.[1] || '0',
    usage: item.usage || usageMatch?.[1] || '0',
    workTime: item.workTime || workTimeMatch?.[1] || '',
    raw
  };
}

function parseFieldCard(item) {
  const text = String(item.raw ?? item.raw_text ?? "");
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    field_type: String(item.typeLabel ?? lines[0] ?? "Farmland"),
    field_name: String(item.name ?? lines[1] ?? ""),
    area_text: String(item.area ?? lines[2] ?? ""),
    location_text: String(item.location ?? lines[3] ?? ""),
    record_date: String(item.date ?? lines[4] ?? ""),
    raw_text: text
  };
}

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

// Cadencia por defecto por field_type (en días).
// Justificación: docs/FUMIGATION_CADENCE.md
//   - Farmland (caña): 14 días (Cenicaña MIPE, conservador)
//   - Orchards (frutales): 10 días (hongos en temporada de lluvias)
const DEFAULT_CADENCE_DAYS = {
  Farmland: 14,
  Orchards: 10
};

function getDefaultCadenceDays(fieldType) {
  if (fieldType === "Orchards") return DEFAULT_CADENCE_DAYS.Orchards;
  return DEFAULT_CADENCE_DAYS.Farmland;
}

const DEFAULT_CROP_TYPE = {
  Farmland: "Caña de azúcar",
  Orchards: "Frutales"
};

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
      parseAreaHa(null), // declared_area_ha se llenará en un join posterior con dji_field_catalog
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
  const history = JSON.parse(fs.readFileSync(path.join(root, 'records_history.json'), 'utf8'));
  const fields = JSON.parse(fs.readFileSync(path.join(root, 'mission_fields.json'), 'utf8'));
  const filesDir = path.join(root, 'land_files');

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
    // Fase 1: limpieza y carga legacy
    await client.query('DELETE FROM dji_parcels');
    await client.query('DELETE FROM dji_land_assets');
    await client.query('DELETE FROM dji_daily_summaries');
    await client.query('DELETE FROM dji_field_catalog');
    await client.query('DELETE FROM dji_import_batches');

    const batchResult = await client.query(
      "INSERT INTO dji_import_batches (source) VALUES ('djiag') RETURNING id"
    );
    const batchId = batchResult.rows[0].id;

    for (const item of history) {
      const record = parseHistoryRecord(item);
      const date = toIsoDate(record.date);
      const insertSql = `
        INSERT INTO dji_daily_summaries
          (batch_id, record_date, weekday, category, area_mu, times_count, usage_liters, work_time_text, raw_text)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;
      await client.query(insertSql, [
        batchId,
        date,
        record.weekday,
        record.category,
        parseMu(record.area),
        parseCount(record.times),
        parseUsage(record.usage),
        record.workTime,
        record.raw
      ]);
    }

    for (const [index, item] of fields.entries()) {
      const field = parseFieldCard(item);
      await client.query(
        `
          INSERT INTO dji_field_catalog
            (batch_id, field_type, field_name, area_text, location_text, record_date, raw_text)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7)
        `,
        [batchId, field.field_type, field.field_name, field.area_text, field.location_text, field.record_date, field.raw_text]
      );
    }

    for (const item of assetIndex) {
      const fileBase = `${item.externalId}_${item.kind}`.replace(/[^a-zA-Z0-9._-]/g, '_');
      const rawPath = path.join(filesDir, `${fileBase}.json`);
      if (!fs.existsSync(rawPath)) continue;
      const assetFile = loadAssetFile(rawPath);
      const geomSql = item.kind === 'geometry' && assetFile.isJson ? geoJsonToGeometrySql(assetFile.rawJson) : null;

      await client.query(
        `
          INSERT INTO dji_land_assets
            (batch_id, external_id, land_name, asset_kind, source_url, raw_json, geom)
          VALUES
            ($1, $2, $3, $4, $5, $6::jsonb, ${geomSql ?? 'NULL'})
        `,
        [batchId, item.externalId, item.landName, item.kind, item.url, JSON.stringify(assetFile.rawJson)]
      );
    }

    // Fase 2: Opción B — agrupar assets por externalId y escribir dji_parcels
    const grouped = groupAssetsByExternalId(assetIndex);
    await loadGroupedAssets(grouped, filesDir);
    const parcelsWritten = await writeDjiParcels(client, batchId, grouped);

    // Fase 2.5: schedule de fumigación (1 fila por parcela activa)
    // Solo crea filas para parcelas que NO tengan ya un schedule.
    // La cadencia viene del field_type (Orchards → 10d, otros → 14d).
    const scheduleResult = await client.query(`
      INSERT INTO dji_fumigation_schedule
        (parcel_id, crop_type, recommended_cadence_days, is_active)
      SELECT
        p.id,
        CASE WHEN p.is_orchard THEN $1::text ELSE $2::text END AS crop_type,
        CASE WHEN p.is_orchard THEN $3::int ELSE $4::int END AS cadence,
        true AS is_active
      FROM dji_parcels p
      WHERE p.batch_id = $5
        AND NOT EXISTS (
          SELECT 1 FROM dji_fumigation_schedule s
          WHERE s.parcel_id = p.id
        )
    `, [
      DEFAULT_CROP_TYPE.Orchards,
      DEFAULT_CROP_TYPE.Farmland,
      DEFAULT_CADENCE_DAYS.Orchards,
      DEFAULT_CADENCE_DAYS.Farmland,
      batchId
    ]);
    const schedulesWritten = scheduleResult.rowCount ?? 0;

    // Intentar enriquecer declared_area_ha desde dji_field_catalog
    // buscando por land_name (join aproximado — si el land_name del catálogo
    // matchea el del asset, copiamos el área declarada).
    await client.query(`
      UPDATE dji_parcels p
      SET declared_area_ha = NULLIF(regexp_replace(f.area_text, '[^0-9.]+', '', 'g'), '')::numeric
      FROM dji_field_catalog f
      WHERE p.batch_id = f.batch_id
        AND p.land_name IS NOT NULL
        AND LOWER(TRIM(p.land_name)) = LOWER(TRIM(f.field_name))
        AND p.declared_area_ha IS NULL
    `);

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
      `Imported batch ${batchId}: ${history.length} daily summaries, ${fields.length} field cards, ${assetIndex.length} asset records, ${parcelsWritten} normalized parcels, ${schedulesWritten} fumigation schedules`
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
  parseMu,
  parseCount,
  parseUsage,
  parseHistoryRecord,
  parseFieldCard,
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
  DJI_FILE_PATTERN
};
