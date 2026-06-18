// Test directo: iterar cada geometry.json, ejecutar el SQL equivalente,
// ver cuál falla.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
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

function buildGeomSql(geojson) {
  const wrap = (g) =>
    `ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_GeomFromGeoJSON('${JSON.stringify(g)}'))), 3))`;
  if (geojson.type === 'FeatureCollection') {
    const polys = geojson.features
      .map(f => f.geometry)
      .filter(g => g && (g.type === 'Polygon' || g.type === 'MultiPolygon'))
      .map(wrap);
    if (polys.length === 0) return null;
    return polys.length === 1 ? polys[0] : `ST_Multi(ST_Collect(ARRAY[${polys.join(', ')}]))`;
  }
  if (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon') {
    return wrap(geojson);
  }
  return null;
}

async function main() {
  loadEnv();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    const filesDir = './djiag_exports/land_files';
    const files = fs.readdirSync(filesDir).filter(f => f.endsWith('_geometry.json'));
    let ok = 0, bad = 0;
    for (const f of files) {
      const content = fs.readFileSync(path.join(filesDir, f), 'utf8');
      const geojson = JSON.parse(content);
      const sql = buildGeomSql(geojson);
      if (!sql) { console.log(`${f}: NO SQL`); continue; }
      try {
        const r = await client.query(`SELECT GeometryType(${sql}::geometry(MultiPolygon, 4326)) AS gtype`);
        if (r.rows[0].gtype === 'MULTIPOLYGON' || r.rows[0].gtype === 'POLYGON') {
          ok++;
        } else {
          bad++;
          console.log(`${f}: ${r.rows[0].gtype}`);
        }
      } catch (e) {
        bad++;
        console.log(`${f}: ERROR ${e.message}`);
      }
    }
    console.log(`\nOK: ${ok} / Bad: ${bad}`);
  } finally {
    client.release();
    await pool.end();
  }
}
main();
