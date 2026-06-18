// Seed del schedule de fumigación con cadencias configurables.
//
// Lee defaults desde config/fumigation-cadences.json (opcional).
// Si el archivo no existe, usa los defaults internos.
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
// Uso:
//   node scripts/seed-cadences.js
//   node scripts/seed-cadences.js --force-cadence 21
//   node scripts/seed-cadences.js --config config/fumigation-cadences.json
//   node scripts/seed-cadences.js --interactive
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Pool } = require('pg');

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

const HARDCODED_DEFAULTS = {
  Farmland: { crop_type: "Caña de azúcar", cadence: 14 },
  Orchards: { crop_type: "Frutales", cadence: 10 }
};

function loadConfig(configPath) {
  if (!configPath || !fs.existsSync(configPath)) {
    return { defaults: null, by_crop: {}, by_drone: {}, by_parcel: {} };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return {
      defaults: raw.defaults ?? null,
      by_crop: raw.by_crop ?? {},
      by_drone: raw.by_drone ?? {},
      by_parcel: raw.by_parcel_external_id ?? {}
    };
  } catch (e) {
    console.error(`Error parseando ${configPath}: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Resuelve la cadencia para una parcela, respetando precedencia:
 *   1. override por external_id (más específico)
 *   2. override por drone_model_code
 *   3. override por crop_type actual del schedule (si existe)
 *   4. override por field_type (Farmland/Orchards)
 *   5. default del config
 *   6. default hardcoded
 */
function resolveCadence(parcel, currentSchedule, config) {
  // 1. Por external_id
  if (config.by_parcel[parcel.external_id]) {
    return {
      cadence: config.by_parcel[parcel.external_id],
      crop_type: currentSchedule?.crop_type ?? (parcel.is_orchard ? HARDCODED_DEFAULTS.Orchards.crop_type : HARDCODED_DEFAULTS.Farmland.crop_type),
      reason: `parcel_id override: ${config.by_parcel[parcel.external_id]}d`
    };
  }
  // 2. Por drone
  if (parcel.drone_model_code && config.by_drone[String(parcel.drone_model_code)]) {
    return {
      cadence: config.by_drone[String(parcel.drone_model_code)],
      crop_type: currentSchedule?.crop_type ?? (parcel.is_orchard ? HARDCODED_DEFAULTS.Orchards.crop_type : HARDCODED_DEFAULTS.Farmland.crop_type),
      reason: `drone_code ${parcel.drone_model_code} override: ${config.by_drone[String(parcel.drone_model_code)]}d`
    };
  }
  // 3. Por crop_type actual del schedule
  if (currentSchedule?.crop_type && config.by_crop[currentSchedule.crop_type]) {
    return {
      cadence: config.by_crop[currentSchedule.crop_type],
      crop_type: currentSchedule.crop_type,
      reason: `crop_type "${currentSchedule.crop_type}" override: ${config.by_crop[currentSchedule.crop_type]}d`
    };
  }
  // 4. Defaults del config
  if (config.defaults) {
    const fieldType = parcel.is_orchard ? "Orchards" : "Farmland";
    if (config.defaults[fieldType]) {
      return {
        cadence: config.defaults[fieldType],
        crop_type: parcel.is_orchard ? HARDCODED_DEFAULTS.Orchards.crop_type : HARDCODED_DEFAULTS.Farmland.crop_type,
        reason: `config defaults[${fieldType}]: ${config.defaults[fieldType]}d`
      };
    }
  }
  // 5. Hardcoded
  const def = parcel.is_orchard ? HARDCODED_DEFAULTS.Orchards : HARDCODED_DEFAULTS.Farmland;
  return { cadence: def.cadence, crop_type: def.crop_type, reason: "hardcoded default" };
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
  const configIdx = args.indexOf("--config");
  const configPath = configIdx >= 0 ? args[configIdx + 1] : null;
  const forceIdx = args.indexOf("--force-cadence");
  const forceCadence = forceIdx >= 0 ? Number(args[forceIdx + 1]) : null;
  const interactive = args.includes("--interactive");
  const dryRun = args.includes("--dry-run");

  if (forceCadence !== null && (!Number.isFinite(forceCadence) || forceCadence < 1)) {
    console.error("--force-cadence requiere un entero positivo");
    process.exit(1);
  }

  const config = loadConfig(configPath);
  if (configPath) {
    console.log(`Config cargado: ${configPath}`);
    console.log(`  defaults: ${JSON.stringify(config.defaults ?? {})}`);
    console.log(`  by_crop: ${Object.keys(config.by_crop).length} cultivos`);
    console.log(`  by_drone: ${Object.keys(config.by_drone).length} drones`);
    console.log(`  by_parcel_external_id: ${Object.keys(config.by_parcel).length} parcelas`);
  } else {
    console.log("Sin --config: usando defaults hardcoded (Caña 14d, Frutales 10d)");
  }

  const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const c = await p.connect();
  try {
    await c.query("BEGIN");

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
    const overrides = [];

    for (const row of result.rows) {
      let cadence;
      let cropType;
      let reason;

      if (forceCadence !== null) {
        cadence = forceCadence;
        const def = row.is_orchard ? HARDCODED_DEFAULTS.Orchards : HARDCODED_DEFAULTS.Farmland;
        cropType = row.crop_type ?? def.crop_type;
        reason = `--force-cadence override: ${forceCadence}d`;
      } else {
        const resolved = resolveCadence(
          {
            external_id: row.external_id,
            is_orchard: row.is_orchard,
            drone_model_code: row.drone_model_code
          },
          { crop_type: row.crop_type },
          config
        );
        cadence = resolved.cadence;
        cropType = resolved.crop_type;
        reason = resolved.reason;
      }

      // Modo interactivo: confirma si la cadencia no viene del config
      if (interactive && reason === "hardcoded default") {
        const ans = await ask(
          `  ${row.external_id} (${row.field_type}): cadencia actual=${row.recommended_cadence_days ?? "—"}, default=${cadence}d. ¿Custom? (Enter = acepta ${cadence}, o número): `
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
    if (wasInsert) inserted += 1;
    else if (r.rowCount > 0) {
      updated += 1;
      overrides.push({ parcel_id: row.id, land_name: row.external_id, cadence, reason });
    }
    }

    if (dryRun) {
      await c.query("ROLLBACK");
      console.log(`\n(Dry-run: rollback aplicado. ${inserted} hubieran sido insertados, ${updated} actualizados, ${skipped} saltados)`);
    } else {
      await c.query("COMMIT");
      console.log(`\nResultado: ${inserted} insertados, ${updated} actualizados, ${skipped} saltados (ya tienen fumigación)`);
      if (overrides.length > 0) {
        console.log(`\nOverrides aplicados:`);
        for (const o of overrides.slice(0, 10)) {
          console.log(`  parcela #${o.parcel_id} (${o.land_name}): ${o.cadence}d — ${o.reason}`);
        }
        if (overrides.length > 10) console.log(`  ... y ${overrides.length - 10} más`);
      }
    }
  } catch (err) {
    await c.query("ROLLBACK");
    console.error("ERROR:", err.message);
    process.exit(1);
  } finally {
    c.release();
    await p.end();
  }
}

main();
