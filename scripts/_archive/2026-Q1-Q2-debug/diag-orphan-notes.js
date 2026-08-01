// Diagnóstico: ¿qué hay en notes JSON de las huérfanas?
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadLocalEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadLocalEnv();

const c = new Client({ connectionString: process.env.DATABASE_URL });

(async () => {
  await c.connect();
  try {
    const orphans = await c.query(`
      SELECT id, fumigation_date::date AS date, area_fumigated_m2, dose_l_per_ha, notes
      FROM dji_fumigations
      WHERE parcel_id IS NULL AND deleted_at IS NULL
      ORDER BY fumigation_date DESC
    `);
    console.log(`Total huérfanas: ${orphans.rows.length}\n`);
    orphans.rows.forEach((r) => {
      console.log(`id=${r.id} date=${r.date?.toISOString().slice(0,10)} area=${r.area_fumigated_m2}m² dose=${r.dose_l_per_ha}L/ha`);
      console.log('  notes:', JSON.stringify(r.notes, null, 2));
      console.log('');
    });
  } catch (e) {
    console.error('ERR:', e.message);
  } finally {
    await c.end();
  }
})();
