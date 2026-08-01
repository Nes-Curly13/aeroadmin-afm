// scripts/diag-history-full-flow.js
// Test completo: truncar todo, simular la migración paso a paso
const fs = require("fs");
const envContent = fs.readFileSync(".env.local", "utf8");
for (const line of envContent.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { Client, Pool } = require("pg");

async function colsOf(c, table) {
  const r = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table]
  );
  return r.rows.map((r) => r.column_name);
}

(async () => {
  const docker = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
  await docker.connect();
  const sb = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const dest = await sb.connect();

  await dest.query("BEGIN");

  // 1. TRUNCATE
  console.log("[1] TRUNCATE");
  await dest.query("TRUNCATE dji_parcels, dji_fumigations, dji_fumigation_schedule, dji_fumigation_schedule_history RESTART IDENTITY CASCADE");

  // 2. Insert 1213 parcels y construir parcelMap
  console.log("[2] Insertar 1213 parcels");
  const parcelCols = await colsOf(docker, "dji_parcels");
  const scols = await colsOf(dest, "dji_parcels");
  const commonParcels = parcelCols.filter((c) => scols.includes(c));
  console.log(`  common parcels cols: ${commonParcels.length}`);

  const r = await dest.query(
    "INSERT INTO dji_import_batches (source) VALUES ('diag-test') RETURNING id"
  );
  const batchId = r.rows[0].id;
  console.log(`  batch_id = ${batchId}`);

  const dParcels = await docker.query(`SELECT ${commonParcels.map((c) => `"${c}"`).join(", ")} FROM dji_parcels ORDER BY id`);
  const parcelMap = new Map();
  for (const row of dParcels.rows) {
    row.batch_id = batchId;
    const cols = commonParcels;
    const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
    const colList = cols.map((c) => `"${c}"`).join(", ");
    const values = cols.map((c) => row[c] === undefined ? null : row[c]);
    const ins = await dest.query(`INSERT INTO dji_parcels (${colList}) VALUES (${ph}) RETURNING id`, values);
    const newId = ins.rows[0].id;
    parcelMap.set(String(row.id), newId);
    parcelMap.set(Number(row.id), newId);
  }
  console.log(`  parcels insertadas: ${parcelMap.size / 2}`);

  // 3. Insert history con remap
  console.log("[3] Insertar history con remap");
  const historyCols = (await colsOf(docker, "dji_fumigation_schedule_history")).filter((c) => scols.includes(c));
  console.log(`  history cols: ${historyCols.join(", ")}`);
  const dHist = await docker.query(`SELECT ${historyCols.map((c) => `"${c}"`).join(", ")} FROM dji_fumigation_schedule_history ORDER BY id`);

  // Aplicar remap
  for (const row of dHist.rows) {
    if (row.parcel_id !== null && row.parcel_id !== undefined) {
      const orig = row.parcel_id;
      row.parcel_id = parcelMap.get(String(row.parcel_id)) ?? parcelMap.get(Number(row.parcel_id));
      if (row.parcel_id === undefined) {
        console.log(`  ⚠️  parcel_id=${orig} no tiene mapping!`);
        row.parcel_id = null;
      }
    }
  }

  // Insertar las primeras 5
  const colList = historyCols.map((c) => `"${c}"`).join(", ");
  const ph = historyCols.map((_, i) => `$${i + 1}`).join(", ");
  for (let i = 0; i < 5; i++) {
    const row = dHist.rows[i];
    const values = historyCols.map((c) => row[c] === undefined ? null : row[c]);
    console.log(`  Insert #${i + 1}:`);
    console.log(`    row.id=${row.id} (${typeof row.id}) row.parcel_id=${row.parcel_id}`);
    console.log(`    values[0]=${values[0]} (${typeof values[0]})`);
    try {
      const ins = await dest.query(`INSERT INTO dji_fumigation_schedule_history (${colList}) VALUES (${ph}) RETURNING id`, values);
      console.log(`    ✓ inserted id=${ins.rows[0].id}`);
    } catch (e) {
      console.log(`    ✗ ERROR: ${e.message}`);
      await dest.query("ROLLBACK");
      dest.release();
      await sb.end();
      await docker.end();
      return;
    }
  }

  // Verificar
  const r2 = await dest.query("SELECT id, parcel_id FROM dji_fumigation_schedule_history ORDER BY id");
  console.log("\nEstado después de 5 inserts:");
  r2.rows.forEach((r) => console.log(`  id=${r.id} parcel_id=${r.parcel_id}`));

  await dest.query("ROLLBACK");
  dest.release();
  await sb.end();
  await docker.end();
})();
