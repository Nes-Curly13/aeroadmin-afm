// Parser puro de la response de `flight_records/aggr_by_day` de DJI AG.
//
// Schema del API (confirmado contra captura 2026-06-19, response 11.7 KB):
//   {
//     "data": {
//       "aggr_info": [
//         {
//           "create_timestamp": 1781884800,   // segundos UTC (inicio del dia en local)
//           "work_area": 4668,                // m² fumigados ese dia
//           "work_times": 4,                  // cantidad de vuelos (sorties)
//           "work_time": 1180800,             // segundos de vuelo
//           "spray_usage": 54571,             // mL de liquido aplicado
//           "sow_usage": 0,                   // mL de semilla (no usado por este cliente)
//           "ag": { ... },                    // bloque agriculture (mismos campos resumidos)
//           "delivery": { ... }               // bloque delivery (todo 0 — no se usa)
//         },
//         ...
//       ]
//     }
//   }
//
// Diseño:
//   - Sin paginacion explicita confirmada (el response siempre trae 30 items =
//     page_size default). Asumimos cursor-less pagination: cada response es 1 pagina
//     de hasta 30 dias. Para la siguiente pagina, el caller mueve el rango de
//     timestamps hacia adelante.
//   - Sin totalCount en la response. Para saber cuando parar, el caller cuenta los
//     items y si son < page_size, termino. Esto es fragil pero es lo que tenemos.
//   - Sin parcel_id, drone_code_used, product_used. Este endpoint es AGREGADO por
//     dia para TODA la cuenta. Para detalle por vuelo (con parcel_id), hay otro
//     endpoint (`flight_records?page=1&page_size=30`) que capturaremos aparte.
//
// Conversion de unidades:
//   - DJI reporta: m² (area), segundos (tiempo), mL (liquido), sin unidad (count)
//   - dji_fumigations espera: m² (area_fumigated_m2), minutos (duration_minutes),
//     L/ha (dose_l_per_ha)
//   - dose_l_per_ha = (spray_usage_ml / 1000) / (area_m2 / 10000)
//                     = spray_usage_L / area_ha
//   - Asumimos densidad de agua 1 g/mL (DJI no expone el producto ni la concentracion).

const MS_PER_SEC = 1000;
const ML_PER_L = 1000;
const M2_PER_HA = 10000;

/**
 * Parsea la response de aggr_by_day y devuelve un array de dias normalizados.
 *
 * @param {object} response
 * @returns {{
 *   days: Array<{
 *     createTimestamp: number,     // segundos UTC
 *     date: string,                // 'YYYY-MM-DD' en UTC
 *     workAreaM2: number | null,
 *     workTimeSec: number | null,
 *     workTimeMin: number | null,  // derivado
 *     sortieCount: number | null,
 *     sprayUsageMl: number | null,
 *     sprayUsageL: number | null,   // derivado
 *     doseLPerHa: number | null,    // derivado
 *     hasAgriculture: boolean,     // ag.sortie_count > 0
 *   }>,
 *   hasNextPage: boolean,           // heuristica: si vino < pageSize, no hay mas
 * }}
 */
function parseAggrByDayResponse(response, pageSize = 30) {
  if (!response || typeof response !== 'object') {
    throw new Error('parseAggrByDayResponse: response is not an object');
  }
  const aggrInfo = response?.data?.aggr_info;
  if (!Array.isArray(aggrInfo)) {
    throw new Error('parseAggrByDayResponse: response.data.aggr_info is not an array');
  }
  const days = aggrInfo.map(normalizeDay);
  return {
    days,
    hasNextPage: aggrInfo.length >= pageSize
  };
}

function normalizeDay(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('normalizeDay: raw is not an object');
  }
  const ts = numOrNull(raw.create_timestamp);
  const areaM2 = numOrNull(raw.work_area);
  const workTimeSec = numOrNull(raw.work_time);
  const sprayUsageMl = numOrNull(raw.spray_usage);
  const sortieCount = numOrNull(raw.work_times);
  const hasAgriculture = numOrNull(raw.ag?.sortie_count) > 0 || numOrNull(raw.work_times) > 0;

  return {
    createTimestamp: ts,
    date: ts !== null ? timestampToDateString(ts) : null,
    workAreaM2: areaM2,
    workTimeSec,
    workTimeMin: workTimeSec !== null ? Math.round(workTimeSec / 60) : null,
    sortieCount,
    sprayUsageMl,
    sprayUsageL: sprayUsageMl !== null ? sprayUsageMl / ML_PER_L : null,
    doseLPerHa: computeDoseLPerHa(sprayUsageMl, areaM2),
    hasAgriculture
  };
}

/**
 * Convierte timestamp (segundos) a 'YYYY-MM-DD' en UTC.
 * Usamos UTC por consistencia con como DJI almacena el timestamp
 * (aunque el usuario lo ve en local time).
 */
function timestampToDateString(sec) {
  const d = new Date(sec * MS_PER_SEC);
  // toISOString() da '2026-06-19T00:00:00.000Z', tomamos los primeros 10 chars
  return d.toISOString().slice(0, 10);
}

/**
 * Computa L/ha. Devuelve null si los inputs son null o area = 0.
 * L/ha = (mL / 1000) / (m² / 10000) = mL * 10 / m²
 */
function computeDoseLPerHa(sprayMl, areaM2) {
  if (sprayMl === null || areaM2 === null || areaM2 === 0) return null;
  // mL → L: dividir por 1000. m² → ha: dividir por 10000.
  // L / ha = (sprayMl/1000) / (areaM2/10000) = (sprayMl * 10) / areaM2
  return Number(((sprayMl * 10) / areaM2).toFixed(2));
}

/**
 * Convierte un dia normalizado a params para UPSERT en dji_fumigations.
 *
 * Limitaciones actuales (porque la response es aggregate, no per-flight):
 *   - parcel_id: null (no hay mapeo finca → fumigacion desde este endpoint)
 *   - drone_code_used: null (no hay info de dron)
 *   - product_used: null (DJI no expone el producto)
 *   - area_fumigated_m2: viene del aggregate, NO es por parcela
 *
 * Para tener detalle por parcela, necesitamos el endpoint `flight_records?page=1`
 * (no capturado todavía). Mientras tanto, podemos popular el agregado diario.
 */
function dayToFumigationParams(day) {
  return {
    fumigationDate: day.date,
    parcelId: null,             // No tenemos mapeo finca → fumigacion
    droneCodeUsed: null,        // No tenemos info de dron en aggregate
    productUsed: null,          // DJI no expone el producto
    areaFumigatedM2: day.workAreaM2,
    durationMinutes: day.workTimeMin,
    doseLPerHa: day.doseLPerHa,
    notes: JSON.stringify({
      source: 'djiscraper-aggr-by-day',
      sortieCount: day.sortieCount,
      sprayUsageMl: day.sprayUsageMl,
      workTimeSec: day.workTimeSec,
      createTimestamp: day.createTimestamp
    }),
    recordedBy: 'djiag-import',
    source: 'import'
  };
}

// ============================================================
// Helpers internos
// ============================================================
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ============================================================
// SQL helpers — UPSERT a dji_fumigations
// ============================================================

/**
 * SQL parametrizado para UPSERT idempotente de fumigaciones aggregate.
 *
 *   INSERT ... ON CONFLICT (fumigation_date, source) WHERE parcel_id IS NULL
 *   DO UPDATE SET <solo campos no-identidad>
 *
 * El conflict target matchea el partial unique index
 * `uq_dji_fumigations_aggregate` (definido en la migration 20260619140000).
 *
 * El caller pasa 9 valores en el orden definido en `paramsToPgArray`.
 * `parcel_id` es NULL para fumigaciones aggregate (no tenemos mapeo finca).
 *
 * `product_used` y `drone_code_used` son NULL por ahora (DJI no expone).
 */
const UPSERT_SQL = `
INSERT INTO dji_fumigations (
  fumigation_date, parcel_id, drone_code_used, product_used,
  area_fumigated_m2, duration_minutes, dose_l_per_ha,
  notes, recorded_by, source
) VALUES (
  $1, $2, $3, $4,
  $5, $6, $7,
  $8, $9, $10
)
ON CONFLICT (fumigation_date, source) WHERE parcel_id IS NULL
DO UPDATE SET
  area_fumigated_m2 = EXCLUDED.area_fumigated_m2,
  duration_minutes  = EXCLUDED.duration_minutes,
  dose_l_per_ha    = EXCLUDED.dose_l_per_ha,
  notes            = EXCLUDED.notes,
  recorded_by      = EXCLUDED.recorded_by
`;

/**
 * Orden exacto de los 10 placeholders. El caller hace:
 *   await client.query(UPSERT_SQL, paramsToPgArray(p))
 */
function paramsToPgArray(p) {
  return [
    p.fumigationDate,         // $1
    p.parcelId,                // $2  (null para aggregate)
    p.droneCodeUsed,          // $3  (null por ahora)
    p.productUsed,             // $4  (null por ahora)
    p.areaFumigatedM2,         // $5
    p.durationMinutes,         // $6
    p.doseLPerHa,              // $7
    p.notes,                   // $8  (jsonb)
    p.recordedBy,              // $9
    p.source                   // $10
  ];
}

module.exports = {
  parseAggrByDayResponse,
  normalizeDay,
  dayToFumigationParams,
  timestampToDateString,
  computeDoseLPerHa,
  UPSERT_SQL,
  paramsToPgArray,
  MS_PER_SEC,
  ML_PER_L,
  M2_PER_HA
};
