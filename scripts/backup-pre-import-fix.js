// Backup de seguridad antes del fix del importer (task 3 del usuario).
//
// Por qué existe:
//   - Hoy (2026-07-03) descubrimos que `import_djiag_data.js` corre
//     `TRUNCATE ... CASCADE` sobre dji_parcels, lo cual borra
//     dji_flights y dji_fumigations también (no solo les setea NULL).
//   - El comentario en el código dice lo contrario (afirma que fumigations
//     NO se truncan). Eso está MAL — TRUNCATE CASCADE borra TODAS las
//     tablas con cualquier FK, sin importar el ON DELETE rule.
//   - Después de esta corrida de prueba perdimos 7710 flights y 714
//     fumigations. Recuperamos todo desde perflight_records.json y
//     fumigations.json, pero queremos un backup de seguridad ANTES de
//     tocar el importer.
//
// Output: djiag_exports/backup-pre-import-fix-<timestamp>.json
//
// Variables de entorno (.env.local):
//   DATABASE_URL

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}

async function main() {
  loadLocalEnv();
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(process.cwd(), 'djiag_exports');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `backup-pre-import-fix-${ts}.json`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3
  });
  const client = await pool.connect();
  try {
    console.log('[backup] Exportando dji_flights + dji_fumigations + dji_fumigation_schedule...');
    const flights = await client.query(`SELECT * FROM dji_flights`);
    const fums = await client.query(`SELECT * FROM dji_fumigations`);
    const schedules = await client.query(`SELECT * FROM dji_fumigation_schedule`);
    const parcels = await client.query(`SELECT id, external_id, land_name FROM dji_parcels`);

    const payload = {
      capturedAt: new Date().toISOString(),
      reason: 'Pre-fix backup before changing TRUNCATE CASCADE → DELETE CASCADE in import_djiag_data.js',
      counts: {
        flights: flights.rowCount,
        fumigations: fums.rowCount,
        schedules: schedules.rowCount,
        parcels: parcels.rowCount,
      },
      flights: flights.rows,
      fumigations: fums.rows,
      schedules: schedules.rows,
      parcels: parcels.rows,
    };
    fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
    const sizeMB = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2);
    console.log(`[backup] OK → ${path.relative(process.cwd(), outFile)} (${sizeMB} MB)`);
    console.log(`  flights: ${flights.rowCount}`);
    console.log(`  fumigations: ${fums.rowCount}`);
    console.log(`  schedules: ${schedules.rowCount}`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { main };