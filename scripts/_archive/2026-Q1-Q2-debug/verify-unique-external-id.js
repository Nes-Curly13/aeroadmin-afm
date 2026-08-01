// Verificación post-migration: confirma que el constraint ahora es solo
// UNIQUE(external_id), y que la columna batch_id se preserva.
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');

// Cargar .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    console.log('=== Constraints UNIQUE/PRIMARY en dji_parcels ===');
    const r = await c.query(`
      SELECT conname, contype, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.dji_parcels'::regclass
        AND contype IN ('u', 'p')
      ORDER BY conname;
    `);
    for (const row of r.rows) {
      console.log(`  ${row.conname} [${row.contype}]: ${row.definition}`);
    }

    console.log('\n=== Duplicados en external_id (esperado: 0) ===');
    const dup = await c.query(`
      SELECT external_id, COUNT(*) AS cnt
      FROM dji_parcels
      WHERE external_id IS NOT NULL
      GROUP BY external_id
      HAVING COUNT(*) > 1
      LIMIT 5;
    `);
    console.log(`  Duplicados encontrados: ${dup.rowCount}`);

    console.log('\n=== Columna batch_id existe? ===');
    const col = await c.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='dji_parcels' AND column_name='batch_id';
    `);
    console.log(`  ${col.rowCount > 0 ? 'YES' : 'NO'} — ${JSON.stringify(col.rows[0])}`);

    console.log('\n=== Conteo de filas (esperado: 1205) ===');
    const cnt = await c.query('SELECT COUNT(*) AS total FROM dji_parcels;');
    console.log(`  total: ${cnt.rows[0].total}`);
  } finally {
    await c.end();
  }
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
