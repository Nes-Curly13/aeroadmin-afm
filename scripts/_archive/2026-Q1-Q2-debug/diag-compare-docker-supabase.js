// scripts/diag-compare-docker-supabase.js
//
// Para N parcelas random, compara el spray_geom de docker vs Supabase.
// Si los polígonos son estructuralmente iguales, la sincronización funcionó.

const { Client, Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const envPath = path.resolve(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const LAND_FILES = path.resolve(__dirname, "..", "djiag_exports", "land_files");

async function main() {
  // 1. Sacar todas las externalIds (no random) para cobertura completa
  const docker = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
  await docker.connect();
  const r = await docker.query(`
    SELECT external_id, land_name
    FROM dji_parcels
    WHERE spray_geom IS NOT NULL AND land_name IS NOT NULL
    ORDER BY id
  `);
  await docker.end();
  const samples = r.rows;
  console.log(`[compare] ${samples.length} parcelas (cobertura completa)\n`);

  // 2. Por cada una, traer spray_geom de docker + Supabase + source
  const supabase = new Pool({
    connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT,
    ssl: { rejectUnauthorized: false },
  });
  const docker2 = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
  await docker2.connect();

  let nMatch = 0, nMismatch = 0, nError = 0;
  const issues = [];

  for (const sample of samples) {
    const extId = sample.external_id;
    const name = sample.land_name;

    // Docker geom (WKT)
    const dr = await docker2.query(
      `SELECT ST_AsGeoJSON(spray_geom)::text AS g, ST_NPoints(spray_geom) AS n, ST_Area(spray_geom::geography)::int AS area FROM dji_parcels WHERE external_id = $1`,
      [extId]
    );
    // Supabase geom
    const sr = await supabase.query(
      `SELECT ST_AsGeoJSON(spray_geom)::text AS g, ST_NPoints(spray_geom) AS n, ST_Area(spray_geom::geography)::int AS area FROM dji_parcels WHERE external_id = $1`,
      [extId]
    );

    if (dr.rows.length === 0 || sr.rows.length === 0) {
      console.log(`  ${name.padEnd(20)} ⚠ missing`);
      nError++;
      continue;
    }

    const dGeom = dr.rows[0];
    const sGeom = sr.rows[0];

    // Source vertices
    const landFile = path.join(LAND_FILES, `${extId}_geometry.json`);
    let srcVerts = null;
    if (fs.existsSync(landFile)) {
      const geo = JSON.parse(fs.readFileSync(landFile, "utf-8"));
      const pz = geo.features.find((f) => f?.properties?.funcType === "PlantZone");
      srcVerts = pz?.geometry?.coordinates?.[0]?.length ?? null;
    }

    const sameGeom = dGeom.g === sGeom.g;
    const sameArea = dGeom.area === sGeom.area;
    const sameNPts = dGeom.n === sGeom.n;

    const status = sameGeom && sameArea && sameNPts ? "✓" : "✗";
    if (sameGeom) nMatch++;
    else { nMismatch++; issues.push({ name, extId, d: dGeom, s: sGeom }); }

    console.log(`  ${status} ${name.padEnd(20)} docker: ${dGeom.n}pts/${dGeom.area}m²  supabase: ${sGeom.n}pts/${sGeom.area}m²  source: ${srcVerts ?? "?"}pts`);
  }

  console.log(`\n=== Resumen ===`);
  console.log(`  Match exacto (WKT byte-a-byte):    ${nMatch}/${samples.length}`);
  console.log(`  Mismatch:                          ${nMismatch}/${samples.length}`);
  console.log(`  Errors (missing):                  ${nError}/${samples.length}`);

  if (issues.length > 0) {
    console.log(`\n=== Detalles mismatch ===`);
    for (const i of issues) {
      console.log(`  ${i.name} (${i.extId.slice(-20)}):`);
      console.log(`    docker:    ${i.d.n}pts, area ${i.d.area}m²`);
      console.log(`    supabase:  ${i.s.n}pts, area ${i.s.area}m²`);
      // Show first diff in WKT
      const dLines = i.d.g.split("\n").slice(0, 3);
      const sLines = i.s.g.split("\n").slice(0, 3);
      console.log(`    docker WKT[:3]:   ${dLines.join(" ").slice(0, 80)}`);
      console.log(`    supabase WKT[:3]: ${sLines.join(" ").slice(0, 80)}`);
    }
  }

  await docker2.end();
  await supabase.end();
}

main().catch((e) => { console.error("ERR:", e); process.exit(1); });
