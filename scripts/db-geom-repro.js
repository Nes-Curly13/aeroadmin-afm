// Investigar el SQL exacto
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

function geoJsonToGeometrySql(geojson) {
  if (!geojson) return null;
  const wrap = (g) =>
    `ST_Multi(ST_Buffer(ST_Force2D(ST_GeomFromGeoJSON('${JSON.stringify(g)}')), 0))`;
  if (geojson.type === 'FeatureCollection') {
    const geometries = geojson.features
      .map((f) => f.geometry)
      .filter(Boolean)
      .filter((g) => g.type === 'Polygon' || g.type === 'MultiPolygon')
      .map(wrap);
    console.log('  features:', geojson.features.length);
    console.log('  after filter:', geometries.length);
    if (geometries.length === 0) return null;
    return geometries.length === 1 ? geometries[0] : `ST_Multi(ST_Collect(ARRAY[${geometries.join(', ')}]))`;
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
    // Test the failing one
    const f = '1268692918907510784-flyer-047d2e5c-14b6-442c-992f-3ec9355fe430_geometry.json';
    const content = fs.readFileSync(path.join('./djiag_exports/land_files', f), 'utf8');
    const j = JSON.parse(content);
    console.log('Features in FC:');
    for (let i = 0; i < j.features.length; i++) {
      const f = j.features[i];
      console.log(`  [${i}] type=${f.geometry?.type} funcType=${f.properties?.funcType}`);
    }
    const sql = geoJsonToGeometrySql(j);
    console.log('\n=== generated SQL ===');
    console.log(sql);
    console.log('=== end ===\n');

    // Test the inner ST_Multi(ST_Buffer(...)) directly
    const innerGeom = j.features[0].geometry;
    const innerSql = `ST_Multi(ST_Buffer(ST_Force2D(ST_GeomFromGeoJSON('${JSON.stringify(innerGeom)}')), 0))`;
    const r1 = await client.query(`SELECT GeometryType(${innerSql}) AS gtype`);
    console.log('Inner ST_Multi(ST_Buffer):', r1.rows[0].gtype);

    // Test the whole thing cast
    try {
      const r2 = await client.query(`SELECT GeometryType((${sql})::geometry(MultiPolygon, 4326)) AS gtype`);
      console.log('Whole SQL cast:', r2.rows[0].gtype);
    } catch (e) {
      console.log('Whole SQL cast ERROR:', e.message);
    }
  } finally {
    client.release();
    await pool.end();
  }
}
main();
