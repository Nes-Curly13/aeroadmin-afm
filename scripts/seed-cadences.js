// Seed del schedule de fumigación con cadencias por defecto.
// Crea 1 fila en dji_fumigation_schedule por cada parcela activa,
// usando la cadencia conservadora según field_type:
//   - Farmland (caña)  → 14 días
//   - Orchards (frutales) → 10 días
//   - otros/desconocidos → 14 días
//
// Idempotente: usa ON CONFLICT (parcel_id) DO UPDATE.
// Si una parcela ya tiene una fumigación registrada, la respeta.
//
// Uso: node scripts/seed-cadences.js
//      node scripts/seed-cadences.js --force-cadence 21   (override)
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
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

const DEFAULTS = {
  Farmland: { crop_type: "Caña de azúcar", cadence: 14 },
  Orchards: { crop_type: "Frutales", cadence: 10 }
};

function defaultFor(fieldType) {
  if (fieldType === "Orchards") return DEFAULTS.Orchards;
  return DEFAULTS.Farmland;
}

async function main() {
  loadEnv();

  // --force-cadence N override
  const forceIdx = process.argv.indexOf("--force-cadence");
  const forceCadence = forceIdx >= 0 ? Number(process.argv[forceIdx + 1]) : null;
  if (forceCadence !== null && (!Number.isFinite(forceCadence) || forceCadence < 1)) {
    console.error("--force-cadence requiere un entero positivo");
    process.exit(1);
  }

  const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const c = await p.connect();
  try {
    await c.query('BEGIN');

    // Para cada parcela, insertar o actualizar el schedule
    const result = await c.query(`
      SELECT id, field_type
      FROM dji_parcels
      ORDER BY id
    `);
    console.log(`Parcelas activas: ${result.rowCount}`);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    for (const row of result.rows) {
      const def = defaultFor(row.field_type);
      const cadence = forceCadence ?? def.cadence;
      const cropType = def.crop_type;
      const r = await c.query(
        `
          INSERT INTO dji_fumigation_schedule
            (parcel_id, crop_type, recommended_cadence_days, is_active)
          VALUES ($1, $2, $3, true)
          ON CONFLICT (parcel_id) DO UPDATE
          SET
            recommended_cadence_days = EXCLUDED.recommended_cadence_days,
            crop_type = EXCLUDED.crop_type,
            updated_at = NOW()
          WHERE dji_fumigation_schedule.last_fumigation_date IS NULL
          RETURNING (xmax = 0) AS inserted
        `,
        [row.id, cropType, cadence]
      );
      const wasInsert = r.rows[0]?.inserted === true;
      if (wasInsert) inserted += 1;
      else if (r.rowCount > 0) updated += 1;
      else skipped += 1;
    }

    await c.query('COMMIT');
    console.log(`Resultado: ${inserted} insertados, ${updated} actualizados, ${skipped} saltados (ya tienen fumigación registrada)`);
    if (forceCadence !== null) {
      console.log(`(Override aplicado: cadencia forzada a ${forceCadence} días para todas las parcelas)`);
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
