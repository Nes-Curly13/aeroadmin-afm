// Aplica db/schema.sql a la base de datos local
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
  const sql = fs.readFileSync(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8');
  const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const c = await p.connect();
  try {
    await c.query(sql);
    const r = await c.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'dji_%'
      ORDER BY table_name
    `);
    console.log('Tablas:', r.rows.map(x => x.table_name).join(', '));
  } finally { c.release(); await p.end(); }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
