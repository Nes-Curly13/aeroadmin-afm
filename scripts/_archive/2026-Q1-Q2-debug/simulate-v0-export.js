// scripts/simulate-v0-export.js
//
// Simula un export V0: crea un parcel con TODOS los campos V0 populados
// (client_name, farm_name, municipality, variety) + una fumigation con los
// nuevos campos ICA (human_notes, product_registered_ica, pilot_license).
// Inserta en docker y Supabase, verifica que ambos aceptan el payload sin errores.

const { Client, Pool } = require("pg");
const fs = require("fs");
fs.readFileSync(".env.local", "utf-8").split(/\r?\n/).forEach((l) => {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
});

// Identificador único para que no choque con datos existentes
const TEST_TAG = "V0SIM_" + Date.now();
const TEST_EXTERNAL_ID = `${TEST_TAG}-ext-1`;
const TEST_LAND_NAME = `${TEST_TAG} Parcel Test`;

// Payload del "V0 export" — un parcel completo con V0 fields
const V0_PARCEL = {
  external_id: TEST_EXTERNAL_ID,
  land_name: TEST_LAND_NAME,
  client_name: "Ingenio Manuelita S.A.",
  farm_name: "Hacienda La Cabaña",
  municipality: "Palmira",
  variety: "CC 85-92",
  total_area_mu: 12.5,
  work_area_mu: 11.0,
  is_orchard: false,
  // Operator notes
  supervisor_notes: "Parcela experimental con riego por goteo",
  crop_type: "Caña de azúcar",
  planting_date: "2024-03-15",
  owner_name: "Juan Pérez",
  owner_contact: "+57 311 555 1234",
  // Geometry (a small box near Cali for testing)
  position_wkt: "POINT(-76.3 3.5)",
  bbox_wkt: "POLYGON((-76.31 3.49, -76.29 3.49, -76.29 3.51, -76.31 3.51, -76.31 3.49))",
};

const V0_FUMIGATION = {
  // parcel_id se setea después del INSERT del parcel
  fumigation_date: "2026-07-30",
  product_used: "Roundup PowerMAX",
  dose_l_per_ha: 2.5,
  area_fumigated_m2: 11000,
  source: "manual",
  // V0 / ICA / human fields
  human_notes: "Aplicación realizada temprano por la mañana, antes de lluvia",
  product_registered_ica: "ICA-4321-PN",
  pilot_license: "PCA-12345",
};

async function runOn(label, connStr, useSsl) {
  const c = new Pool({ connectionString: connStr, max: 2, ssl: useSsl ? { rejectUnauthorized: false } : undefined });
  const client = await c.connect();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${label}`);
  console.log("=".repeat(70));

  try {
    // Empezar transacción
    await client.query("BEGIN");

    // 1. Crear batch de test
    const bRes = await client.query(
      "INSERT INTO dji_import_batches (source) VALUES ('v0-simulation') RETURNING id"
    );
    const batchId = bRes.rows[0].id;
    console.log(`  batch_id = ${batchId}`);

    // 2. Insertar el parcel con TODOS los campos V0
    const insertParcelSql = `
      INSERT INTO dji_parcels (
        batch_id, external_id, land_name,
        client_name, farm_name, municipality, variety,
        field_type, is_orchard,
        position, bbox,
        total_area_mu, work_area_mu,
        crop_type, planting_date, owner_name, owner_contact, supervisor_notes
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6, $7,
        'Farmland', $8,
        ST_GeomFromText($9, 4326), ST_GeomFromText($10, 4326),
        $11, $12,
        $13, $14, $15, $16, $17
      ) RETURNING id
    `;
    const pRes = await client.query(insertParcelSql, [
      batchId, V0_PARCEL.external_id, V0_PARCEL.land_name,
      V0_PARCEL.client_name, V0_PARCEL.farm_name, V0_PARCEL.municipality, V0_PARCEL.variety,
      V0_PARCEL.is_orchard,
      V0_PARCEL.position_wkt, V0_PARCEL.bbox_wkt,
      V0_PARCEL.total_area_mu, V0_PARCEL.work_area_mu,
      V0_PARCEL.crop_type, V0_PARCEL.planting_date, V0_PARCEL.owner_name, V0_PARCEL.owner_contact, V0_PARCEL.supervisor_notes,
    ]);
    const parcelId = pRes.rows[0].id;
    console.log(`  parcel_id = ${parcelId}`);

    // 3. Insertar la schedule
    const sRes = await client.query(
      `INSERT INTO dji_fumigation_schedule (parcel_id, crop_type, recommended_cadence_days, is_active)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [parcelId, "caña", 14]
    );
    console.log(`  schedule_id = ${sRes.rows[0].id}`);

    // 4. Insertar la fumigation con TODOS los campos ICA
    const fRes = await client.query(
      `INSERT INTO dji_fumigations (
        parcel_id, fumigation_date, product_used, dose_l_per_ha, area_fumigated_m2, source,
        human_notes, product_registered_ica, pilot_license
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        parcelId, V0_FUMIGATION.fumigation_date, V0_FUMIGATION.product_used,
        V0_FUMIGATION.dose_l_per_ha, V0_FUMIGATION.area_fumigated_m2, V0_FUMIGATION.source,
        V0_FUMIGATION.human_notes, V0_FUMIGATION.product_registered_ica, V0_FUMIGATION.pilot_license,
      ]
    );
    console.log(`  fumigation_id = ${fRes.rows[0].id}`);

    // COMMIT
    await client.query("COMMIT");

    // Verificar lectura (round-trip)
    console.log("\n  Round-trip check (SELECT):");
    const r1 = await client.query(
      `SELECT land_name, client_name, farm_name, municipality, variety,
              crop_type, planting_date, owner_name, owner_contact, supervisor_notes,
              ST_AsText(position) AS pos, ST_AsText(bbox) AS bbox
       FROM dji_parcels WHERE external_id = $1`,
      [TEST_EXTERNAL_ID]
    );
    const p = r1.rows[0];
    console.log(`    land_name:           ${p.land_name}`);
    console.log(`    client_name:         ${p.client_name}`);
    console.log(`    farm_name:           ${p.farm_name}`);
    console.log(`    municipality:        ${p.municipality}`);
    console.log(`    variety:             ${p.variety}`);
    console.log(`    crop_type:           ${p.crop_type}`);
    console.log(`    planting_date:       ${p.planting_date}`);
    console.log(`    owner_name:          ${p.owner_name}`);
    console.log(`    owner_contact:       ${p.owner_contact}`);
    console.log(`    supervisor_notes:    ${p.supervisor_notes}`);
    console.log(`    position:            ${p.pos}`);
    console.log(`    bbox:                ${p.bbox?.slice(0, 50)}...`);

    const r2 = await client.query(
      `SELECT parcel_id, human_notes, product_registered_ica, pilot_license
       FROM dji_fumigations WHERE parcel_id = $1`,
      [parcelId]
    );
    const f = r2.rows[0];
    console.log(`    fumigation.human_notes:           ${f?.human_notes}`);
    console.log(`    fumigation.product_registered_ica: ${f?.product_registered_ica}`);
    console.log(`    fumigation.pilot_license:         ${f?.pilot_license}`);

    return { ok: true, parcelId };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.log(`  ✗ ERROR: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    client.release();
    await c.end();
  }
}

async function cleanup(label, connStr, useSsl) {
  const c = new Pool({ connectionString: connStr, max: 2, ssl: useSsl ? { rejectUnauthorized: false } : undefined });
  const client = await c.connect();
  try {
    // Borrar fumigations primero (FK)
    const r1 = await client.query(
      `DELETE FROM dji_fumigations WHERE parcel_id IN (SELECT id FROM dji_parcels WHERE external_id = $1)`,
      [TEST_EXTERNAL_ID]
    );
    const r2 = await client.query(
      `DELETE FROM dji_fumigation_schedule WHERE parcel_id IN (SELECT id FROM dji_parcels WHERE external_id = $1)`,
      [TEST_EXTERNAL_ID]
    );
    const r3 = await client.query(
      `DELETE FROM dji_parcels WHERE external_id = $1`,
      [TEST_EXTERNAL_ID]
    );
    const r4 = await client.query(
      `DELETE FROM dji_import_batches WHERE source = 'v0-simulation'`
    );
    console.log(`  [cleanup ${label}] fumigations: ${r1.rowCount}, schedule: ${r2.rowCount}, parcels: ${r3.rowCount}, batches: ${r4.rowCount}`);
  } finally {
    client.release();
    await c.end();
  }
}

(async () => {
  console.log("=== Simulación V0 export — insertar payload completo ===");
  console.log(`TEST_EXTERNAL_ID = ${TEST_EXTERNAL_ID}`);

  // 1. Correr en docker
  const dockerResult = await runOn(
    "DOCKER LOCAL (postgis/postgis:16-3.4)",
    "postgresql://postgres:postgres@localhost:5432/afm_flights",
    false
  );

  // 2. Correr en Supabase
  const supabaseResult = await runOn(
    "SUPABASE (producción)",
    process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT,
    true
  );

  // Resumen
  console.log("\n\n=== Resumen ===");
  console.log(`Docker:    ${dockerResult.ok ? "✓ OK" : `✗ ${dockerResult.error}`}`);
  console.log(`Supabase:  ${supabaseResult.ok ? "✓ OK" : `✗ ${supabaseResult.error}`}`);

  // Pregunto al usuario si limpiar o no
  console.log("\n=== Cleanup ===");
  if (dockerResult.ok) await cleanup("docker", "postgresql://postgres:postgres@localhost:5432/afm_flights", false);
  if (supabaseResult.ok) await cleanup("supabase", process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT, true);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
