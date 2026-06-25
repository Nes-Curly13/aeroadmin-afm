// Parser puro del output de `scrape_djiag_perflight.js`.
//
// Schema del archivo (formato djiag_exports/perflight_records.json):
//   {
//     "flights": [
//       {
//         "id": 638640703,
//         "flyer_name": "Afm Drone",
//         "location": "Capri. Selva La, Anchicaya, El Cerrito, Sur, Valle del Cauca, Colombia",
//         "city": null,
//         "district": "El Cerrito",
//         "create_date": 20260623,           // YYYYMMDD integer
//         "team_name": "breiner pelaez",
//         "manual_mode": false,
//         "serial_number": "R1272065674",   // drone serial
//         "usage_type": 0,
//         "spray_usage": 12669,              // mL
//         "sow_usage": 0,
//         "nickname": "AFM T40 1",          // human name
//         "new_work_area": 6233.3333645,    // m²
//         "start_timestamp": 1782222338,    // unix seconds
//         "end_timestamp": 1782222719,      // unix seconds
//         "work_time_seconds": 381,
//         "mode_name": 4,
//         "work_speed": 5.0,
//         "spray_width": 5.08,
//         "radar_height": 2.9,
//         "plot_name": null,                // DJI no expone parcela
//         "lng": -76.30263127,
//         "lat": 3.66871315,
//         ...
//       },
//       ...
//     ],
//     "total_count": 7059,
//     "total_pages": 236,
//     "captured_at": "...",
//     "days": 30,
//     "pageSize": 50,
//     "pages_captured": 235
//   }
//
// Diseño:
//   - Normalizamos campos al formato `snake_case` que espera dji_flights.
//   - Convierte timestamps seg → timestamptz.
//   - Mantiene el payload crudo en `notes` (jsonb) para futuro debugging.
//   - `parcel_id` queda NULL hasta que spatial-join-flights-parcels.js lo llene.
//
// Conversion de unidades:
//   - DJI: timestamps en segundos epoch, area en m², spray en mL.
//   - DB: timestamptz, m², mL (sin conversion). Display layer convierte a L/ha.

const MS_PER_SEC = 1000;

/**
 * Parsea el archivo perflight_records.json (output de scrape_djiag_perflight.js)
 * y devuelve un array de flights normalizados.
 *
 * @param {object} file  Contenido del JSON parseado
 * @returns {{
 *   flights: Array<{
 *     flightId: number,
 *     parcelId: null,
 *     droneSerial: string | null,
 *     droneNickname: string | null,
 *     pilotName: string | null,
 *     flyerName: string | null,
 *     district: string | null,
 *     location: string | null,
 *     startAt: Date,
 *     endAt: Date,
 *     durationSeconds: number,
 *     areaM2: number | null,
 *     sprayUsageMl: number | null,
 *     workSpeedMS: number | null,
 *     sprayWidthM: number | null,
 *     radarHeightM: number | null,
 *     manualMode: boolean | null,
 *     modeName: number | null,
 *     createDate: string | null,    // 'YYYY-MM-DD'
 *     lng: number | null,
 *     lat: number | null,
 *     notes: object,
 *   }>,
 *   meta: object
 * }}
 */
function parsePerFlightFile(file) {
  if (!file || typeof file !== 'object') {
    throw new Error('parsePerFlightFile: file is not an object');
  }
  const flights = file.flights;
  if (!Array.isArray(flights)) {
    throw new Error('parsePerFlightFile: file.flights is not an array');
  }
  return {
    flights: flights.map(normalizeFlight),
    meta: {
      totalCount: file.total_count ?? flights.length,
      totalPages: file.total_pages ?? null,
      capturedAt: file.captured_at ?? null,
      days: file.days ?? null,
      pageSize: file.pageSize ?? null,
      pagesCaptured: file.pages_captured ?? null,
    }
  };
}

function normalizeFlight(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('normalizeFlight: raw is not an object');
  }
  const flightId = numOrNull(raw.id);
  const startSec = numOrNull(raw.start_timestamp);
  const endSec = numOrNull(raw.end_timestamp);
  const durationSec = numOrNull(raw.work_time_seconds);

  return {
    flightId,
    parcelId: null,             // Llenado por spatial join posterior
    droneSerial: strOrNull(raw.serial_number),
    droneNickname: strOrNull(raw.nickname),
    pilotName: strOrNull(raw.team_name),
    flyerName: strOrNull(raw.flyer_name),
    district: strOrNull(raw.district),
    location: strOrNull(raw.location),
    startAt: startSec !== null ? new Date(startSec * MS_PER_SEC) : null,
    endAt: endSec !== null ? new Date(endSec * MS_PER_SEC) : null,
    durationSeconds: durationSec ?? 0,
    areaM2: numOrNull(raw.new_work_area),
    sprayUsageMl: numOrNull(raw.spray_usage),
    workSpeedMS: numOrNull(raw.work_speed),
    sprayWidthM: numOrNull(raw.spray_width),
    radarHeightM: numOrNull(raw.radar_height),
    manualMode: typeof raw.manual_mode === 'boolean' ? raw.manual_mode : null,
    modeName: numOrNull(raw.mode_name),
    createDate: createDateFromYYYYMMDD(raw.create_date),
    lng: numOrNull(raw.lng),
    lat: numOrNull(raw.lat),
    notes: buildNotes(raw),
  };
}

/**
 * Convierte el `create_date` de DJI (integer YYYYMMDD como 20260623) a
 * 'YYYY-MM-DD'. Devuelve null si el input no es un integer válido de 8 dígitos.
 */
function createDateFromYYYYMMDD(v) {
  const n = numOrNull(v);
  if (n === null) return null;
  // DJI entrega timestamps en local time del operador (Colombia, UTC-5).
  // create_date es la "fecha de creacion" del vuelo en ese local time.
  // Lo tomamos como string ISO sin TZ interpretation; la capa de display
  // puede reformatear si necesita.
  const s = String(n);
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/**
 * Construye el objeto `notes` (jsonb) que se guarda en dji_flights.notes.
 * Conserva el payload crudo de DJI + metadata del importer para debugging.
 */
function buildNotes(raw) {
  return {
    source: 'djiscraper-perflight',
    raw: {
      id: raw.id,
      usage_type: raw.usage_type,
      sow_usage: raw.sow_usage,
      city: raw.city,
      no: raw.no,
      task_serial_number: raw.task_serial_number,
      mission_serial_number: raw.mission_serial_number,
      delivery_weight: raw.delivery_weight,
      delivery_net_weight: raw.delivery_net_weight,
      delivery_work_lap: raw.delivery_work_lap,
      delivery_group_weight: raw.delivery_group_weight,
      delivery_group_net_weight: raw.delivery_group_net_weight,
      delivery_group_laps: raw.delivery_group_laps,
      hardware_id: raw.hardware_id,
      app_version: raw.app_version,
      rtk_precision: raw.rtk_precision,
      is_weight: raw.is_weight,
      plot_name: raw.plot_name,
      created_at: raw.created_at,
      updated_at: raw.updated_at,
    }
  };
}

// ============================================================
// Helpers
// ============================================================
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

// ============================================================
// SQL helpers
// ============================================================

/**
 * SQL parametrizado para UPSERT idempotente de dji_flights.
 *
 *   INSERT ... ON CONFLICT (flight_id, source) DO UPDATE SET <campos no-identidad>
 *
 * El caller pasa 24 valores en el orden definido en `paramsToPgArray`.
 *
 * El conflict target matchea el unique constraint (flight_id, source)
 * definido en la migration 20260623110000_add_dji_flights.sql.
 */
const UPSERT_SQL = `
INSERT INTO dji_flights (
  flight_id, parcel_id, drone_serial, drone_nickname,
  pilot_name, flyer_name, district, location,
  start_at, end_at, duration_seconds,
  area_m2, spray_usage_ml, work_speed_m_s, spray_width_m, radar_height_m,
  manual_mode, mode_name, create_date,
  lng, lat, notes, captured_at, source
) VALUES (
  $1, $2, $3, $4,
  $5, $6, $7, $8,
  $9, $10, $11,
  $12, $13, $14, $15, $16,
  $17, $18, $19,
  $20, $21, $22, $23, $24
)
ON CONFLICT (flight_id, source) DO UPDATE SET
  parcel_id        = EXCLUDED.parcel_id,
  drone_serial     = EXCLUDED.drone_serial,
  drone_nickname   = EXCLUDED.drone_nickname,
  pilot_name       = EXCLUDED.pilot_name,
  flyer_name       = EXCLUDED.flyer_name,
  district         = EXCLUDED.district,
  location         = EXCLUDED.location,
  start_at         = EXCLUDED.start_at,
  end_at           = EXCLUDED.end_at,
  duration_seconds = EXCLUDED.duration_seconds,
  area_m2          = EXCLUDED.area_m2,
  spray_usage_ml   = EXCLUDED.spray_usage_ml,
  work_speed_m_s   = EXCLUDED.work_speed_m_s,
  spray_width_m    = EXCLUDED.spray_width_m,
  radar_height_m   = EXCLUDED.radar_height_m,
  manual_mode      = EXCLUDED.manual_mode,
  mode_name        = EXCLUDED.mode_name,
  create_date      = EXCLUDED.create_date,
  lng              = EXCLUDED.lng,
  lat              = EXCLUDED.lat,
  notes            = EXCLUDED.notes,
  captured_at      = EXCLUDED.captured_at
`;

/**
 * Orden exacto de los 24 placeholders. El caller hace:
 *   await client.query(UPSERT_SQL, paramsToPgArray(f))
 */
function paramsToPgArray(f) {
  return [
    f.flightId,           // $1
    f.parcelId,           // $2  null hasta spatial join
    f.droneSerial,        // $3
    f.droneNickname,      // $4
    f.pilotName,          // $5
    f.flyerName,          // $6
    f.district,           // $7
    f.location,           // $8
    f.startAt,            // $9  timestamptz
    f.endAt,              // $10
    f.durationSeconds,    // $11
    f.areaM2,             // $12
    f.sprayUsageMl,       // $13
    f.workSpeedMS,        // $14
    f.sprayWidthM,        // $15
    f.radarHeightM,       // $16
    f.manualMode,         // $17
    f.modeName,           // $18
    f.createDate,         // $19  'YYYY-MM-DD' o null
    f.lng,                // $20
    f.lat,                // $21
    JSON.stringify(f.notes), // $22  jsonb como string
    new Date(),           // $23  captured_at = now()
    'djiag',             // $24  source
  ];
}

module.exports = {
  parsePerFlightFile,
  normalizeFlight,
  flightToParams: (f) => f,  // alias para consistencia con fumigations
  paramsToPgArray,
  UPSERT_SQL,
  MS_PER_SEC,
};