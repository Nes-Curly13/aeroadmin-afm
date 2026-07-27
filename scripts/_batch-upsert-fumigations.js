// Batch upsert de fumigations aggregate desde djiag_exports/fumigations.json.
// Hace un SQL "SELECT id, total_area_mu, work_area_mu, ..." del aggregate
// y mete filas en dji_fumigations (source='dji_aggr', parcel_id NULL).
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

const BATCH = 200;

async function main() {
  loadLocalEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not configured');
  const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
  const pool = new Pool({ connectionString: url, max: 3, ssl });

  // fumigations aggregate: viene del paso 2 (scrape_djiag_records.js).
  // El formato exacto depende de lo que guardó el scraper. Miramos
  // fumigations.json y day_items o similar.
  const dir = path.join(process.cwd(), 'djiag_exports');
  const cand = ['fumigations.json', 'records.json', 'fumigations-aggregate.json'];
  let inPath = null;
  for (const c of cand) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) { inPath = p; break; }
  }
  if (!inPath) {
    // Buscar cualquier .json con 'fumigation' o 'day_item' en el nombre
    const all = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const hit = all.find((f) => /fumigat|day_item|day_item|aggregate|graphql_lands/i.test(f));
    if (hit) inPath = path.join(dir, hit);
  }
  if (!inPath) throw new Error('No se encontró fumigations.json en djiag_exports/');
  console.log('[fumigations] leyendo ' + path.relative(process.cwd(), inPath));
  const raw = JSON.parse(fs.readFileSync(inPath, 'utf8'));

  // El formato puede ser:
  //   { data: [...] } | { items: [...] } | { day_items: [...] } | { results: [...] } | [...]
  // O un array directo.
  let items = null;
  if (Array.isArray(raw)) items = raw;
  else {
    for (const k of ['day_items', 'data', 'items', 'records', 'results', 'fumigations']) {
      if (Array.isArray(raw[k])) { items = raw[k]; break; }
    }
  }
  if (!items) {
    console.log('  keys en el JSON:', Object.keys(raw).join(', '));
    // buscar arrays anidados
    for (const k of Object.keys(raw)) {
      if (Array.isArray(raw[k]) && raw[k].length > 0 && typeof raw[k][0] === 'object') {
        items = raw[k];
        console.log('  usando key:', k);
        break;
      }
    }
  }
  if (!items) throw new Error('No encontré array de fumigations en el JSON');
  console.log('[fumigations] ' + items.length + ' items');

  // Ver schema de dji_fumigations
  const client = await pool.connect();
  try {
    const cols = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='dji_fumigations' ORDER BY ordinal_position");
    console.log('  columnas dji_fumigations:');
    cols.rows.forEach((x) => console.log('    ' + x.column_name + ' (' + x.data_type + ')'));
  } finally {
    client.release();
  }
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
