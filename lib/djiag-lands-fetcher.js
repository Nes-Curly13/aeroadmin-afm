// Parser/normalizer para responses del endpoint `?name=lands` de DJI AG.
//
// Diseño: este módulo es PURO (sin side effects, sin imports de Playwright
// ni de red). Recibe una response JSON y devuelve objetos normalizados.
//
// Por qué puro: poder testear con fixtures sintéticos (sin necesidad
// de credenciales DJI ni de correr Playwright). La lógica de parsing
// no cambia entre environments; solo cambia el transporte.
//
// La conversión de unidades (MU → ha) NO se hace acá — el consumer decide.
// Mantenemos la unidad original (MU) en el output normalizado y exponemos
// helpers para conversión (MU_PER_HA) por si el importer quiere convertir.

/**
 * DJI usa MU como unidad de área (1 MU = 1/15 ha ≈ 666.67 m²).
 * Estándar chino, no métrico. Documentado en docs/DJI_AREA_UNITS.md (pendiente).
 */
const MU_PER_HA = 15;
const M2_PER_MU = 10000 / MU_PER_HA; // 666.6667 m²
const HA_PER_MU = 1 / MU_PER_HA;

/**
 * Normaliza un land "node" (lo que viene dentro de edge.node) a un objeto
 * plano y predecible. Mantiene los nombres de campos en camelCase (igual
 * que DJI) para que la transformación al schema local sea explícita en
 * el importer.
 *
 * Campos derivados que el importer puede querer:
 *   - `totalAreaHa` calculado con muToHa() — pero lo dejamos como
 *     helper separado para no asumir la decisión de conversión.
 */
function normalizeLand(node) {
  if (!node || typeof node !== 'object') {
    throw new Error('normalizeLand: node must be an object');
  }
  return {
    uuid: node.uuid ?? null,
    externalId: node.externalId ?? null,
    name: node.name ?? '',
    address: node.address ?? null,
    landType: node.landType ?? null,
    sourceType: node.sourceType ?? null,
    totalAreaMu: numOrNull(node.totalArea),
    workAreaMu: numOrNull(node.workArea),
    obstacleAreaMu: numOrNull(node.totalObstacleArea),
    precision: numOrNull(node.precision),
    precisionType: node.precisionType ?? null,
    maxGeometryParameterOffset: numOrNull(node.maxGeometryParameterOffset),
    position: normalizePosition(node.position),
    bbox: normalizeBbox(node.bbox),
    geometryUrl: node.geometry?.storage?.signedURL ?? null,
    geometryStorageUuid: node.geometry?.storage?.uuid ?? null,
    geometryContentMd5: node.geometry?.storage?.contentMd5 ?? null,
    waypointUrl: node.waypoint?.storage?.signedURL ?? null,
    parameterUrl: node.parameter?.storage?.signedURL ?? null,
    serialNumber: node.serialNumber ?? null,
    tags: Array.isArray(node.tags) ? node.tags.slice() : [],
    createdAt: node.createdAt ?? null,
    updatedAt: node.updatedAt ?? null
  };
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizePosition(pos) {
  if (!pos || typeof pos !== 'object') return null;
  const lng = numOrNull(pos.lng);
  const lat = numOrNull(pos.lat);
  if (lng === null && lat === null) return null;
  return { lng, lat };
}

function normalizeBbox(bbox) {
  if (!bbox || typeof bbox !== 'object') return null;
  const ur = bbox.upperRight;
  const dl = bbox.downLeft;
  if (!ur || !dl) return null;
  return {
    upperRight: normalizePosition(ur),
    downLeft: normalizePosition(dl)
  };
}

/**
 * Parsea la response de `?name=lands` y devuelve:
 *   {
 *     lands: [...],   // array de lands normalizados
 *     totalCount: number,
 *     hasNextPage: boolean,
 *     endCursor: string | null,
 *   }
 *
 * Lanza Error si la response no tiene la estructura esperada
 * (data.lands.edges). No lanza si edges está vacío (puede ser legítimo).
 */
function parseLandsResponse(response) {
  if (!response || typeof response !== 'object') {
    throw new Error('parseLandsResponse: response is not an object');
  }
  const data = response.data;
  if (!data || typeof data !== 'object') {
    throw new Error('parseLandsResponse: response.data is missing');
  }
  const lands = data.lands;
  if (!lands || typeof lands !== 'object') {
    throw new Error('parseLandsResponse: response.data.lands is missing');
  }
  const edges = Array.isArray(lands.edges) ? lands.edges : [];
  return {
    lands: edges.map((e) => normalizeLand(e?.node)),
    totalCount: typeof lands.totalCount === 'number' ? lands.totalCount : 0,
    hasNextPage: Boolean(lands.pageInfo?.hasNextPage),
    endCursor: lands.pageInfo?.endCursor ?? null
  };
}

/**
 * Helper de conversión de unidades. Devuelve null si el input es null
 * para mantener la semántica de "no tengo data" en toda la pipeline.
 */
function muToHa(mu) {
  return mu === null || mu === undefined ? null : mu * HA_PER_MU;
}
function muToM2(mu) {
  return mu === null || mu === undefined ? null : mu * M2_PER_MU;
}
function haToMu(ha) {
  return ha === null || ha === undefined ? null : ha * MU_PER_HA;
}

module.exports = {
  // parsing
  normalizeLand,
  normalizePosition,
  normalizeBbox,
  parseLandsResponse,
  // units
  MU_PER_HA,
  HA_PER_MU,
  M2_PER_MU,
  muToHa,
  muToM2,
  haToMu
};
