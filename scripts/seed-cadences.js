// Seed del schedule de fumigación con cadencias configurables.
//
// Lee defaults desde config/fumigation-cadences.json (opcional).
// Si el archivo no existe, usa los defaults internos (Caña 14d, Frutales 10d).
//
// Estructura del config (todos los campos son opcionales):
// {
//   "defaults": { "Farmland": 14, "Orchards": 10 },
//   "by_crop": {
//     "Caña de azúcar": 12,
//     "Maíz": 21
//   },
//   "by_drone": {
//     "201": 10   // Agras T40 fumigación más seguida
//   },
//   "by_parcel_external_id": {
//     "1268692918907510784-flyer-0047243d-...": 7   // parcela especial
//   }
// }
//
// Precedencia (mayor a menor):
//   1. by_parcel_external_id
//   2. by_drone
//   3. by_crop (match normalizado del crop_type actual)
//   4. defaults (por field_type)
//   5. builtin defaults
//
// La lógica de resolución vive en lib/fumigation-cadence-config.js (compartida
// con el importer). Este script solo hace el I/O: lee config, pregunta al
// usuario si --interactive, y hace UPSERT en dji_fumigation_schedule.
//
// Uso:
//   node scripts/seed-cadences.js
//   node scripts/seed-cadences.js --force-cadence 21
//   node scripts/seed-cadences.js --config config/fumigation-cadences.json
//   node scripts/seed-cadences.js --interactive
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Pool } = require('pg');

const {
  loadCadenceConfig,
  resolveCadence,
  BUILTIN_DEFAULTS
} = require('../lib/fumigation-cadence-config');

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const envFile = fs.readFileSync(envPath, 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => {
    rl.close();
    resolve(ans.trim());
  }));
}

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const configIdx = args.indexOf('--config');
  const explicitConfigPath = configIdx >= 0 ? args[configIdx + 1] : null;
  // Default: config/fumigation-cadences.json. Env var FUMIGATION_CADENCES_CONFIG
  // permite apuntar a otro archivo (o null para forzar builtin defaults).
  const configPath =
    explicitConfigPath ??
    process.env.FUMIGATION_CADENCES_CONFIG ??
    path.join(process.cwd(), 'config', 'fumigation-cadences.json');
  const forceIdx = args.indexOf('--force-cadence');
  const forceCadence = forceIdx >= 0 ? Number(args[forceIdx + 1]) : null;
  const interactive = args.includes('--interactive');
  const dryRun = args.includes('--dry-run');

  if (forceCadence !== null && (!Number.isFinite(forceCadence) || forceCadence < 1)) {
    console.error('--force-cadence requiere un entero positivo');
    process.exit(1);
  }

  const config = loadCadenceConfig(configPath);
  console.log(`Config source: ${config._source}`);
  console.log(`  defaults: ${JSON.stringify(config.defaults)}`);
  console.log(`  by_crop: ${Object.keys(config.by_crop).length} cultivos`);
  console.log(`  by_drone: ${Object.keys(config.by_drone).length} drones`);
  console.log(`  by_parcel_external_id: ${Object.keys(config.by_parcel).length} parcelas`);

  const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const c = await p.connect();
  try {
    await c.query('BEGIN');

    const result = await c.query(`
      SELECT
        p.id, p.external_id, p.field_type, p.is_orchard, p.drone_model_code,
        s.crop_type, s.recommended_cadence_days, s.last_fumigation_date
      FROM dji_parcels p
      LEFT JOIN dji_fumigation_schedule s ON s.parcel_id = p.id
      ORDER BY p.id
    `);
    console.log(`\nParcelas a procesar: ${result.rowCount}`);

    let inserted = 0, updated = 0, skipped = 0;
    // updatedEntries: filas cuya cadencia cambió por algo distinto al default
    // hardcoded (config override, --force-cadence, o --interactive). No-op
    // updates (mismo valor que ya estaba) NO se incluyen — la idea es que el
    // admin vea qué se modificó, no qué se reescribió igual.
    const updatedEntries = [];

    for (const row of result.rows) {
      let cadence;
      let cropType;
      let reason;

      if (forceCadence !== null) {
        cadence = forceCadence;
        const def = row.is_orchard ? BUILTIN_DEFAULTS.crop_type.Orchards : BUILTIN_DEFAULTS.crop_type.Farmland;
        cropType = row.crop_type ?? def;
        reason = `--force-cadence override: ${forceCadence}d`;
      } else {
        const resolved = resolveCadence(
          {
            externalId: row.external_id,
            droneModelCode: row.drone_model_code,
            fieldType: row.field_type,
            currentCropType: row.crop_type
          },
          config
        );
        cadence = resolved.cadence_days;
        cropType = resolved.crop_type;
        reason = resolved.reason;
      }

      // Modo interactivo: confirma si la cadencia no viene del config
      if (interactive && reason.startsWith('builtin default')) {
        const ans = await ask(
          `  ${row.external_id} (${row.field_type}): cadencia actual=${row.recommended_cadence_days ?? '—'}, default=${cadence}d. ¿Custom? (Enter = acepta ${cadence}, o número): `
        );
        if (ans && /^\d+$/.test(ans)) {
          cadence = Number(ans);
          reason = `interactive override: ${cadence}d`;
        }
      }

      // Si ya tiene fumigación registrada, no la tocamos
      if (row.last_fumigation_date) {
        skipped += 1;
        continue;
      }

      const r = await c.query(
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
        [row.id, cropType, cadence]
      );
      const wasInsert = r.rows[0]?.inserted === true;
      if (wasInsert) {
        inserted += 1;
      } else if (r.rowCount > 0) {
        updated += 1;
        // Solo loguear cuando la cadencia realmente cambió vs lo que estaba
        if (Number(row.recommended_cadence_days) !== cadence || row.crop_type !== cropType) {
          updatedEntries.push({ parcel_id: row.id, land_name: row.external_id, cadence, reason });
        }
      }
    }

    if (dryRun) {
      await c.query('ROLLBACK');
      console.log(`\n(Dry-run: rollback aplicado. ${inserted} hubieran sido insertados, ${updated} actualizados, ${skipped} saltados)`);
    } else {
      await c.query('COMMIT');
      console.log(`\nResultado: ${inserted} insertados, ${updated} actualizados, ${skipped} saltados (ya tienen fumigación)`);
      if (updatedEntries.length > 0) {
        console.log(`\nCambios aplicados (cadencia o crop_type distinto al previo):`);
        for (const o of updatedEntries.slice(0, 10)) {
          console.log(`  parcela #${o.parcel_id} (${o.land_name}): ${o.cadence}d — ${o.reason}`);
        }
        if (updatedEntries.length > 10) console.log(`  ... y ${updatedEntries.length - 10} más`);
      }
    }
  } catch (err) {
    await c.query('ROLLBACK');
    console.error('ERROR:', err.message);
    process.exit(1);
  } finally {
    c.release();
    await p.end();
  }
}

main();
