// CLI: actualiza dji_fumigation_schedule.last_fumigation_date + next_due_date
// desde los datos reales de dji_fumigations.
//
// Para cada fila activa en dji_fumigation_schedule:
//   - last_fumigation_date = MAX(dji_fumigations.fumigation_date) WHERE parcel_id
//   - next_due_date = last_fumigation_date + recommended_cadence_days
//
// Idempotente: corre N veces = mismo resultado.
//
// Uso:
//   node scripts/update-fumigation-schedule.js
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
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}

function createPool() {
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  const useSsl = process.env.DATABASE_SSL === 'true';
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  return new Pool({ connectionString, max: 3, idleTimeoutMillis: 30_000, ssl: useSsl ? { rejectUnauthorized: false } : undefined });
}

async function updateSchedule(client) {
  const sql = `
    WITH last_fum AS (
      SELECT parcel_id, MAX(fumigation_date) AS last_date
      FROM dji_fumigations
      WHERE parcel_id IS NOT NULL
      GROUP BY parcel_id
    )
    UPDATE dji_fumigation_schedule s
    SET
      last_fumigation_date = lf.last_date,
      -- s.recommended_cadence_days es int; convertimos a interval con make_interval
      next_due_date = lf.last_date + make_interval(days => s.recommended_cadence_days)
    FROM last_fum lf
    WHERE s.parcel_id = lf.parcel_id
      AND s.is_active = true
    RETURNING s.id, s.parcel_id, s.last_fumigation_date, s.next_due_date
  `;
  const r = await client.query(sql);
  return r.rows;
}

async function main() {
  loadLocalEnv();
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await updateSchedule(client);
    await client.query('COMMIT');
    console.log(`[update-schedule] OK: ${updated.length} schedule rows actualizadas`);
    if (updated.length > 0) {
      console.log('\nSample (first 5):');
      for (const r of updated.slice(0, 5)) {
        console.log(`  id=${r.id} parcel=${r.parcel_id} last=${r.last_fumigation_date?.toISOString().slice(0, 10)} next=${r.next_due_date?.toISOString().slice(0, 10)}`);
      }
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[update-schedule] ERROR:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, updateSchedule };