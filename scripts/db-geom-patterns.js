// Test diferentes patrones de SQL para reparar geometrías DJI
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

async function main() {
  loadEnv();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    // Test against one failing geometry
    const f = '1268692918907510784-flyer-047d2e5c-14b6-442c-992f-3ec9355fe430_geometry.json';
    const content = fs.readFileSync(path.join('./djiag_exports/land_files', f), 'utf8');
    const j = JSON.parse(content);
    const g = JSON.stringify(j.features[0].geometry);
    const patterns = [
      ['ST_Buffer,0 + ST_Multi', `ST_Multi(ST_Buffer(ST_Force2D(ST_GeomFromGeoJSON('${g}')), 0))::geometry(MultiPolygon, 4326)`],
      ['ST_MakeValid + Homogenize', `ST_Multi(ST_CollectionHomogenize(ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_GeomFromGeoJSON('${g}'))), 3)))::geometry(MultiPolygon, 4326)`],
      ['ST_Dump + collect', `(SELECT ST_Multi(ST_Collect(geom))::geometry(MultiPolygon, 4326) FROM (SELECT (ST_Dump(ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_GeomFromGeoJSON('${g}'))), 3))).geom) x)`],
      ['geometry(Geometry) generic', `ST_Buffer(ST_Force2D(ST_GeomFromGeoJSON('${g}')), 0)::geometry(Geometry, 4326)`],
    ];
    for (const [name, sql] of patterns) {
      try {
        const r = await client.query(`SELECT GeometryType(${sql}) AS gtype, ST_NPoints(${sql}) AS n, ST_Area(${sql}) AS area`);
        console.log(`  ${name}: type=${r.rows[0].gtype}, npoints=${r.rows[0].n}, area=${parseFloat(r.rows[0].area).toFixed(2)}`);
      } catch (e) {
        console.log(`  ${name}: ERROR ${e.message}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}
main();
