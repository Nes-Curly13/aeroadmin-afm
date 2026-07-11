// Converter: NormalizedLand → SQL params para UPSERT en dji_parcels.
//
// Diseño:
//   - PURO (sin DB ni Playwright). Recibe un NormalizedLand y devuelve
//     los params + el SQL listo para usar con `pg`.
//   - Idempotente: el SQL hace UPSERT (INSERT ... ON CONFLICT UPDATE).
//   - Conserva las columnas de parameter.json: el ON CONFLICT solo toca
//     las columnas API (las nuevas), nunca pisa spray_geom, drone_model_code,
//     spray_width_m, etc.
//
// WKT (Well-Known Text):
//   - PostGIS acepta geometrías como WKT cuando se pasa un string. El
//     cliente `pg` los manda como text y PostGIS los parsea. Esto evita
//     tener que usar ST_GeomFromText con hex WKB o cosas raras.
//   - Point: "POINT(lng lat)" — OGC usa lng (X) primero.
//   - Polygon: "POLGON((x1 y1, x2 y2, ...))" — 5 puntos para cerrar.
//
// Por qué un módulo separado:
//   - El SQL string cambia poco, pero la lógica de conversión (null safety,
//     normalización a WKT) es testeable independientemente. Si DJI cambia
//     el shape, solo ajustamos normalizeLand (en lands-fetcher.js).

const MU_PER_HA = 15;
const HA_PER_MU = 1 / MU_PER_HA;

/**
 * Convierte un NormalizedLand en params listos para el UPSERT.
 * Garantiza:
 *   - null/undefined → null (nunca NaN, nunca string "null")
 *   - tags vacío → null (PostGIS: '{}'::text[] vs NULL — usamos NULL
 *     para distinguir "no tengo tags" de "tags explícitamente vacío")
 *   - position/bbox → WKT o null
 *   - fieldType derivado de isOrchard (consistencia con land_type_raw)
 */
function landToParcelParams(land) {
  const isOrchard = land.landType === 'Orchards';
  return {
    // Identidad
    externalId: nullIfBlank(land.externalId),
    djiLandUuid: nullIfBlank(land.uuid),
    // Display
    landName: nullIfBlank(land.name),
    fieldType: isOrchard ? 'Orchards' : 'Farmland',
    isOrchard,
    landTypeRaw: nullIfBlank(land.landType),
    // Geometría (WKT o null)
    positionWkt: positionToWkt(land.position),
    bboxWkt: bboxToWkt(land.bbox),
    // Metadata
    tags: Array.isArray(land.tags) && land.tags.length > 0 ? land.tags : null,
    precisionM: numOrNull(land.precision),
    precisionType: nullIfBlank(land.precisionType),
    serialNumber: nullIfBlank(land.serialNumber),
    // Áreas (en MU, raw de DJI)
    totalAreaMu: numOrNull(land.totalAreaMu),
    workAreaMu: numOrNull(land.workAreaMu),
    obstacleAreaMu: numOrNull(land.obstacleAreaMu),
    // Location string (gaps Figma audit 2026-07-09)
    locationLabel: nullIfBlank(land.address),
    // URLs (signedURL de la API, o null)
    sourceUrlGeometry: nullIfBlank(land.geometryUrl),
    sourceUrlParameter: nullIfBlank(land.parameterUrl),
    sourceUrlWaypoint: nullIfBlank(land.waypointUrl)
  };
}

/**
 * Point WKT. lng primero (OGC), lat después.
 * Devuelve null si lng o lat son null.
 *
 *   POINT(-76.328195 3.624620)
 */
function positionToWkt(pos) {
  if (!pos || typeof pos !== 'object') return null;
  const lng = numOrNull(pos.lng);
  const lat = numOrNull(pos.lat);
  if (lng === null || lat === null) return null;
  // Sanity check: coordenadas válidas
  if (lng < -180 || lng > 180) return null;
  if (lat < -90 || lat > 90) return null;
  return `POINT(${lng} ${lat})`;
}

/**
 * Polygon WKT rectangular. CCW (counter-clockwise) por convención OGC.
 *
 *   downLeft (SW)     upperRight (NE)
 *        ┌──────────────┐
 *        │              │
 *        │   polygon    │
 *        │              │
 *        └──────────────┘
 *   dl.lng,dl.lat  → ur.lng,dl.lat → ur.lng,ur.lat → dl.lng,ur.lat → close
 *
 * Devuelve null si upperRight o downLeft faltan o tienen nulls.
 */
function bboxToWkt(bbox) {
  if (!bbox || typeof bbox !== 'object') return null;
  const ur = bbox.upperRight;
  const dl = bbox.downLeft;
  if (!ur || !dl) return null;
  const urlng = numOrNull(ur.lng);
  const urlat = numOrNull(ur.lat);
  const dllng = numOrNull(dl.lng);
  const dllat = numOrNull(dl.lat);
  if (urlng === null || urlat === null || dllng === null || dllat === null) return null;
  // Sanity check
  if (urlng < -180 || urlng > 180 || dllng < -180 || dllng > 180) return null;
  if (urlat < -90 || urlat > 90 || dllat < -90 || dllat > 90) return null;
  return `POLYGON((${dllng} ${dllat}, ${urlng} ${dllat}, ${urlng} ${urlat}, ${dllng} ${urlat}, ${dllng} ${dllat}))`;
}

/**
 * SQL parametrizado para UPSERT. Conserva las columnas de parameter.json
 * (spray_geom, drone_model_code, etc.) — solo escribe las API.
 *
 *   INSERT ... ON CONFLICT (external_id) DO UPDATE SET <solo API>
 *
 * Decisión de diseño (2026-07-11, fix dup-rescrape):
 *   - El conflicto se evalúa SOLO por `external_id` (no por batch_id+external_id).
 *     Esto evita que cada re-scrape cree filas duplicadas para external_ids ya
 *     existentes (el bug del 2026-07-09 que dejó 2412 filas para 1205 extIds).
 *   - `batch_id` NO se incluye en el DO UPDATE SET, así que la fila existente
 *     mantiene el batch_id MÁS ANTIGUO (el del import inicial con
 *     parameter.json). Esto es crítico: el batch viejo tiene spray_geom,
 *     drone_model_code, spray_width_m; los batches nuevos del re-scrape no.
 *   - El INSERT inicial sí escribe batch_id (= batch del re-scrape) para filas
 *     NUEVAS. Solo en el update path se preserva el batch_id original.
 *
 * El caller pasa los 20 valores en el orden definido en `paramOrder`.
 * El client `pg` los referencia como $1, $2, ..., $20.
 */
const UPSERT_SQL = `
INSERT INTO dji_parcels (
  batch_id, external_id, land_name, field_type, is_orchard,
  dji_land_uuid, position, bbox, tags, precision_m, precision_type,
  serial_number, total_area_mu, work_area_mu, obstacle_area_mu,
  land_type_raw, location_label,
  source_url_geometry, source_url_parameter, source_url_waypoint
) VALUES (
  $1, $2, $3, $4, $5,
  $6, $7, $8, $9, $10, $11,
  $12, $13, $14, $15,
  $16, $17,
  $18, $19, $20
)
ON CONFLICT (external_id) DO UPDATE SET
  dji_land_uuid      = EXCLUDED.dji_land_uuid,
  position           = EXCLUDED.position,
  bbox               = EXCLUDED.bbox,
  tags               = EXCLUDED.tags,
  precision_m        = EXCLUDED.precision_m,
  precision_type     = EXCLUDED.precision_type,
  serial_number      = EXCLUDED.serial_number,
  total_area_mu      = EXCLUDED.total_area_mu,
  work_area_mu       = EXCLUDED.work_area_mu,
  obstacle_area_mu   = EXCLUDED.obstacle_area_mu,
  land_type_raw      = EXCLUDED.land_type_raw,
  location_label     = EXCLUDED.location_label,
  source_url_geometry   = COALESCE(dji_parcels.source_url_geometry,   EXCLUDED.source_url_geometry),
  source_url_parameter  = COALESCE(dji_parcels.source_url_parameter,  EXCLUDED.source_url_parameter),
  source_url_waypoint   = COALESCE(dji_parcels.source_url_waypoint,   EXCLUDED.source_url_waypoint),
  api_fetched_at     = NOW()
  -- NOTE: batch_id intentionally NOT in DO UPDATE SET.
  -- On re-scrape, the existing row keeps the OLDEST batch_id (the one from
  -- the original import with parameter.json + assets). The new batch_id
  -- from the re-scrape is only written for genuinely NEW parcels.
`;

/**
 * Orden exacto de los 19 placeholders. El caller hace:
 *   await client.query(UPSERT_SQL, paramsToPgArray(batchId, p))
 */
function paramsToPgArray(batchId, p) {
  return [
    batchId,                     // $1
    p.externalId,                // $2
    p.landName,                  // $3
    p.fieldType,                 // $4
    p.isOrchard,                 // $5
    p.djiLandUuid,               // $6
    p.positionWkt,               // $7
    p.bboxWkt,                   // $8
    p.tags,                      // $9  (text[] o null)
    p.precisionM,                // $10
    p.precisionType,             // $11
    p.serialNumber,              // $12
    p.totalAreaMu,               // $13
    p.workAreaMu,                // $14
    p.obstacleAreaMu,            // $15
    p.landTypeRaw,               // $16
    p.locationLabel,             // $17 (Figma audit gap, 2026-07-09)
    p.sourceUrlGeometry,         // $18
    p.sourceUrlParameter,        // $19
    p.sourceUrlWaypoint          // $20
  ];
}

// ============================================================
// Helpers internos
// ============================================================
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function nullIfBlank(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

module.exports = {
  landToParcelParams,
  positionToWkt,
  bboxToWkt,
  paramsToPgArray,
  UPSERT_SQL,
  MU_PER_HA,
  HA_PER_MU
};
