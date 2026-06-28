// Helper script para validar la DB.
// Lee .env.local, se conecta, y ejecuta queries de diagnóstico.
// Uso: node scripts/db-check.js
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('No se encontró .env.local');
    process.exit(1);
  }
  const envFile = fs.readFileSync(envPath, 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function main() {
  loadEnv();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await pool.connect();
  try {
    // 1. Conexión básica
    const conn = await client.query(`
      SELECT current_database() AS db,
             current_user       AS usr,
             now()              AS now
    `);
    console.log('=== Conexión ===');
    console.log(JSON.stringify(conn.rows[0], null, 2));

    // 2. Tablas DJI existentes
    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name LIKE 'dji_%'
      ORDER BY table_name
    `);
    console.log('\n=== Tablas dji_* existentes ===');
    if (tables.rows.length === 0) {
      console.log('(ninguna — hay que aplicar schema)');
    } else {
      for (const r of tables.rows) console.log('  -', r.table_name);
    }

    // 3. Si existen las tablas, mostrar conteos
    const tableNames = tables.rows.map(r => r.table_name);
    if (tableNames.includes('dji_parcels')) {
      const counts = await client.query(`
        SELECT
          (SELECT count(*) FROM dji_drone_models)        AS drone_models,
          (SELECT count(*) FROM dji_import_batches)      AS import_batches,
          (SELECT count(*) FROM dji_flights)             AS flights,
          (SELECT count(*) FROM dji_fumigations)         AS fumigations,
          (SELECT count(*) FROM dji_fumigation_schedule) AS fumigation_schedule,
          (SELECT count(*) FROM dji_parcels)             AS parcels
      `);
      console.log('\n=== Conteos actuales ===');
      console.log(JSON.stringify(counts.rows[0], null, 2));
    }

    // 4. PostGIS disponible
    const postgis = await client.query(`
      SELECT extname, extversion FROM pg_extension WHERE extname = 'postgis'
    `);
    console.log('\n=== PostGIS ===');
    if (postgis.rows.length === 0) console.log('(no instalado)');
    else console.log(JSON.stringify(postgis.rows[0], null, 2));
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
