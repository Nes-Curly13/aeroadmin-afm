// Lógica de cadencia de fumigación — loader de config + resolver de precedencia.
//
// Usada por:
//   - import_djiag_data.js (Fase 2.5 — siembra dji_fumigation_schedule desde el importer)
//   - scripts/seed-cadences.js (re-seed / dry-run interactivo cuando el config cambia)
//
// Precedencia (mayor a menor):
//   1. by_parcel_external_id (caso especial por parcela)
//   2. by_drone (drone_model_code)
//   3. by_crop (currentCropType o el derivado de fieldType)
//   4. defaults (por field_type: "Farmland" | "Orchards")
//
// Mantenerla pura y testeable (sin dependencias de Node/DOM específicas —
// solo fs para leer el config). Los consumidores la usan desde CommonJS
// (require) porque tanto el importer como seed-cadences son .js.

const fs = require('fs');

/**
 * Defaults por field_type. Si el config no tiene defaults, se usan estos.
 * Justificación: docs/FUMIGATION_CADENCE.md
 *   - Farmland (caña): 14 días (Cenicaña MIPE, conservador)
 *   - Orchards (frutales): 10 días (hongos en temporada de lluvias)
 */
const BUILTIN_DEFAULTS = Object.freeze({
  cadence: Object.freeze({
    Farmland: 14,
    Orchards: 10
  }),
  crop_type: Object.freeze({
    Farmland: 'Caña de azúcar',
    Orchards: 'Frutales'
  })
});

/**
 * Normaliza un crop_type para matchear contra el config: lowercase +
 * strip de acentos (NFD → remover combining marks) + trim. Esto hace que
 * "Cana de azucar", "CAÑA DE AZÚCAR" y "  caña de azúcar  " matcheen
 * todos contra la key "cana de azucar" en el config.
 */
function normalizeCropKey(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Devuelve el crop_type default para un field_type.
 * @param {string|null|undefined} fieldType
 * @returns {string}
 */
function defaultCropTypeFor(fieldType) {
  if (fieldType === 'Orchards') return BUILTIN_DEFAULTS.crop_type.Orchards;
  return BUILTIN_DEFAULTS.crop_type.Farmland;
}

/**
 * Carga el config de cadencias desde un JSON. Si el archivo no existe
 * o es inválido, devuelve un config vacío con los defaults builtin
 * aplicados — NO throw. El importer debe poder correr sin config.
 *
 * Schema esperado (todos los campos son opcionales):
 * {
 *   "defaults":   { "Farmland": 14, "Orchards": 10 },
 *   "by_crop":    { "Caña de azúcar": 12, "Maíz": 21 },
 *   "by_drone":   { "201": 10 },
 *   "by_parcel_external_id": { "1268692918...-flyer-0047243d-...": 7 }
 * }
 *
 * @param {string|null|undefined} configPath
 * @returns {{
 *   defaults: { Farmland: number, Orchards: number },
 *   by_crop: Record<string, number>,
 *   by_drone: Record<string, number>,
 *   by_parcel: Record<string, number>,
 *   _source: string
 * }}
 */
function loadCadenceConfig(configPath) {
  const defaults = { ...BUILTIN_DEFAULTS.cadence };
  const by_crop = {};
  const by_drone = {};
  const by_parcel = {};
  let source = 'builtin-defaults';

  if (!configPath || !fs.existsSync(configPath)) {
    return { defaults, by_crop, by_drone, by_parcel, _source: source };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    source = configPath;

    if (raw.defaults && typeof raw.defaults === 'object' && !Array.isArray(raw.defaults)) {
      for (const [k, v] of Object.entries(raw.defaults)) {
        if (typeof v === 'number' && Number.isFinite(v)) defaults[k] = v;
      }
    }
    for (const [k, v] of Object.entries(raw.by_crop ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        by_crop[normalizeCropKey(k)] = v;
      }
    }
    for (const [k, v] of Object.entries(raw.by_drone ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        by_drone[String(k)] = v;
      }
    }
    for (const [k, v] of Object.entries(raw.by_parcel_external_id ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        by_parcel[String(k)] = v;
      }
    }
  } catch (err) {
    // Re-emitimos como warning pero no tiramos — los defaults builtin son
    // siempre seguros y el importer debe poder correr aunque el config esté roto.
    // eslint-disable-next-line no-console
    console.warn(`[cadence-config] No pude parsear ${configPath}: ${err.message}. Usando builtin defaults.`);
  }
  return { defaults, by_crop, by_drone, by_parcel, _source: source };
}

/**
 * Resuelve la cadencia para una parcela, aplicando precedencia.
 *
 * @param {object} args
 * @param {string} args.externalId          — external_id de la parcela (DJI)
 * @param {number|string|null} args.droneModelCode — land_connect_drone_type
 * @param {string|null} args.fieldType      — "Farmland" | "Orchards" (de dji_parcels.field_type)
 * @param {string|null} args.currentCropType — crop_type actual del schedule (NULL si es nuevo)
 * @param {object} config — de loadCadenceConfig()
 * @returns {{ cadence_days: number, crop_type: string, reason: string }}
 */
function resolveCadence({ externalId, droneModelCode, fieldType, currentCropType }, config) {
  // 1. Override por external_id (caso más específico)
  if (externalId && config.by_parcel[String(externalId)] !== undefined) {
    return {
      cadence_days: config.by_parcel[String(externalId)],
      crop_type: currentCropType || defaultCropTypeFor(fieldType),
      reason: `parcel_id override (${externalId})`
    };
  }

  // 2. Override por drone_model_code
  if (droneModelCode !== null && droneModelCode !== undefined) {
    const droneKey = String(droneModelCode);
    if (config.by_drone[droneKey] !== undefined) {
      return {
        cadence_days: config.by_drone[droneKey],
        crop_type: currentCropType || defaultCropTypeFor(fieldType),
        reason: `drone_code ${droneKey} override`
      };
    }
  }

  // 3. Override por crop_type (match normalizado). Si no hay current,
  // usamos el default de fieldType para que un by_crop del config
  // también pueda overridear al default.
  const cropToMatch = currentCropType || defaultCropTypeFor(fieldType);
  const cropKey = normalizeCropKey(cropToMatch);
  if (cropKey && config.by_crop[cropKey] !== undefined) {
    return {
      cadence_days: config.by_crop[cropKey],
      crop_type: cropToMatch,
      reason: `crop_type "${cropToMatch}" override`
    };
  }

  // 4. Defaults del config por field_type
  const fieldKey = fieldType === 'Orchards' ? 'Orchards' : 'Farmland';
  if (config.defaults[fieldKey] !== undefined) {
    return {
      cadence_days: config.defaults[fieldKey],
      crop_type: cropToMatch,
      reason: `config defaults[${fieldKey}]`
    };
  }

  // 5. Builtin defaults (último recurso, siempre seguros)
  return {
    cadence_days: BUILTIN_DEFAULTS.cadence[fieldKey],
    crop_type: cropToMatch,
    reason: `builtin default (${fieldKey})`
  };
}

module.exports = {
  BUILTIN_DEFAULTS,
  normalizeCropKey,
  defaultCropTypeFor,
  loadCadenceConfig,
  resolveCadence
};
