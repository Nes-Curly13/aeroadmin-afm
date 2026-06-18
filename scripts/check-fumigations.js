// Verifica el estado final de fumigaciones y prueba la lógica de next_due
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

async function main() {
  loadEnv();
  const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const c = await p.connect();
  try {
    console.log('=== Conteos ===');
    const counts = await c.query(`
      SELECT
        (SELECT count(*) FROM dji_fumigation_schedule) AS schedules,
        (SELECT count(*) FROM dji_fumigations) AS events
    `);
    console.log(JSON.stringify(counts.rows[0], null, 2));

    console.log('\n=== Distribución por cultivo y cadencia ===');
    const byCrop = await c.query(`
      SELECT crop_type, recommended_cadence_days, count(*) AS n
      FROM dji_fumigation_schedule
      GROUP BY crop_type, recommended_cadence_days
      ORDER BY n DESC
    `);
    for (const r of byCrop.rows) {
      console.log(`  ${r.crop_type} (${r.recommended_cadence_days}d): ${r.n} parcelas`);
    }

    console.log('\n=== Top 10 upcoming ===');
    const upcoming = await c.query(`
      SELECT
        p.land_name,
        s.crop_type,
        s.recommended_cadence_days,
        s.last_fumigation_date,
        s.next_due_date
      FROM dji_fumigation_schedule s
      JOIN dji_parcels p ON p.id = s.parcel_id
      WHERE s.is_active = true
      ORDER BY s.next_due_date NULLS FIRST
      LIMIT 10
    `);
    for (const r of upcoming.rows) {
      console.log(`  ${r.land_name ?? '?'} | ${r.crop_type} | cadencia=${r.recommended_cadence_days}d | próxima=${r.next_due_date ?? '—'}`);
    }
  } finally {
    c.release();
    await p.end();
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
