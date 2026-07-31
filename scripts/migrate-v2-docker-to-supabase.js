#!/usr/bin/env node
// scripts/migrate-v2-docker-to-supabase.js
//
// Migración docker → Supabase. v3 con fixes:
//   - Multi-row INSERT en batches de 200 (vs 1-by-1 del v2) → ~10min → ~10s
//   - TRUNCATE dji_parcels + dependents RESTART IDENTITY CASCADE
//   - DELETE dji_flights, dji_daily_summaries, dji_legacy_snapshot
//   - NO toca djiag_health (preservado por no tener FKs)
//   - Remap parcel_id para fumigations, schedule, history, flights
//   - Las tablas dji_daily_summaries y dji_legacy_snapshot deben existir
//     previamente con el schema correcto.
//
// Pre-requisitos:
//   1. Haber corrido `scripts/reset-supabase-pre-migrate.js` (Supabase limpio)
//   2. dji_daily_summaries y dji_legacy_snapshot existen en Supabase con PK
//   3. Docker corriendo y accesible en localhost:5432
//
// NO es idempotente: corre 2 veces = 2da TRUNCATE+INSERT con docker ids.

const fs = require("fs");
const path = require("path");
const { Client, Pool } = require("pg");

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}

const BATCH_SIZE = 200;

async function colsOf(c, table) {
  const r = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table]
  );
  return r.rows.map((r) => r.column_name);
}

async function tableCount(c, table) {
  try {
    const r = await c.query(`SELECT count(*)::int AS n FROM "${table}"`);
    return r.rows[0].n;
  } catch (e) {
    return null;
  }
}

async function fetchAllRows(src, table, colNames) {
  const cols = colNames.map((c) => `"${c}"`).join(", ");
  const orderBy = colNames.includes("id") ? "ORDER BY id NULLS FIRST" : "";
  const r = await src.query(`SELECT ${cols} FROM "${table}" ${orderBy}`);
  return r.rows;
}

async function insertRowsBatched(dest, table, rows, colNames, opts = {}) {
  const { applyRemap } = opts;
  if (rows.length === 0) return 0;
  if (applyRemap) applyRemap(rows);

  const cols = colNames.map((c) => `"${c}"`).join(", ");
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = [];
    const placeholders = [];
    for (let j = 0; j < batch.length; j++) {
      const row = batch[j];
      const ph = colNames.map((_, k) => `$${j * colNames.length + k + 1}`);
      placeholders.push(`(${ph.join(", ")})`);
      colNames.forEach((c) => values.push(row[c] === undefined ? null : row[c]));
    }
    const sql = `INSERT INTO "${table}" (${cols}) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`;
    const r = await dest.query(sql, values);
    total += r.rowCount;
  }
  return total;
}

async function resetSeq(c, table) {
  const seqName = `${table}_id_seq`;
  try {
    const r = await c.query(`SELECT max(id) AS m FROM "${table}"`);
    const max = Number(r.rows[0].m ?? 0);
    const newVal = max + 1;
    await c.query(`SELECT setval('${seqName}', ${newVal}, false)`);
    return newVal;
  } catch (e) {
    return null;
  }
}

async function main() {
  loadLocalEnv();

  const docker = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
  await docker.connect();
  const sb = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const dest = await sb.connect();

  console.log("[migrate-v2] Iniciando migración docker → Supabase\n");

  console.log("=== Estado inicial ===");
  for (const t of ["dji_parcels", "dji_flights", "dji_fumigations", "dji_fumigation_schedule", "dji_fumigation_schedule_history", "dji_daily_summaries", "dji_legacy_snapshot", "djiag_health"]) {
    const c = await tableCount(dest, t);
    console.log(`  supabase.${t}: ${c ?? "(no existe)"}`);
  }

  const tables = ["dji_parcels", "dji_flights", "dji_fumigations", "dji_fumigation_schedule", "dji_fumigation_schedule_history", "dji_daily_summaries", "dji_legacy_snapshot"];
  const commonCols = {};
  for (const t of tables) {
    const dcols = new Set(await colsOf(docker, t));
    const scols = new Set(await colsOf(dest, t));
    commonCols[t] = [...dcols].filter((c) => scols.has(c));
    console.log(`  ${t}: ${commonCols[t].length} cols comunes`);
  }

  console.log("\n[1/7] TRUNCATE dji_parcels + dependents (RESTART IDENTITY CASCADE)...");
  await dest.query("TRUNCATE dji_parcels, dji_fumigations, dji_fumigation_schedule, dji_fumigation_schedule_history RESTART IDENTITY CASCADE");
  console.log("  ✓");

  console.log("[1b/7] DISABLE trigger trg_dji_fumigation_schedule_change (auto-inserts history rows)...");
  await dest.query("ALTER TABLE dji_fumigation_schedule DISABLE TRIGGER trg_dji_fumigation_schedule_change");
  console.log("  ✓");

  console.log("[2/7] DELETE dji_flights...");
  await dest.query("DELETE FROM dji_flights");
  console.log("  ✓");

  console.log("[3/7] DELETE dji_daily_summaries y dji_legacy_snapshot...");
  await dest.query("DELETE FROM dji_daily_summaries");
  await dest.query("DELETE FROM dji_legacy_snapshot");
  console.log("  ✓");

  console.log("[4/7] Creando batch de migración...");
  const batchRes = await dest.query(
    "INSERT INTO dji_import_batches (source) VALUES ('docker-migration-v3') RETURNING id"
  );
  const migrationBatchId = batchRes.rows[0].id;
  console.log(`  ✓ batch_id = ${migrationBatchId}`);

  console.log("[5/7] INSERT dji_parcels desde docker...");
  const dockerParcels = await fetchAllRows(docker, "dji_parcels", commonCols.dji_parcels);
  for (const row of dockerParcels) {
    row.batch_id = migrationBatchId;
  }
  // dji_parcels usa el id de docker directamente (no reasignamos IDs)
  // parcelMap queda como identity mapping (docker_id → mismo id en supabase)
  const parcelMap = new Map();
  for (const row of dockerParcels) {
    const id = row.id;
    parcelMap.set(String(id), id);
    parcelMap.set(Number(id), id);
  }
  const nParcels = await insertRowsBatched(dest, "dji_parcels", dockerParcels, commonCols.dji_parcels);
  console.log(`  ✓ ${nParcels} parcelas insertadas (batch_id=${migrationBatchId})`);

  function remapParcelId(val) {
    if (val === null || val === undefined) return val;
    const newId = parcelMap.get(String(val)) ?? parcelMap.get(Number(val));
    return newId === undefined ? null : newId;
  }

  console.log("[6/7] INSERT dji_fumigations, schedule, history con parcel_id remapeado...");
  for (const t of ["dji_fumigations", "dji_fumigation_schedule", "dji_fumigation_schedule_history"]) {
    const rows = await fetchAllRows(docker, t, commonCols[t]);
    const applyRemap = (rs) => {
      if (!commonCols[t].includes("parcel_id")) return;
      for (const row of rs) {
        if (row.parcel_id !== null && row.parcel_id !== undefined) {
          row.parcel_id = remapParcelId(row.parcel_id);
        }
      }
    };
    const n = await insertRowsBatched(dest, t, rows, commonCols[t], { applyRemap });
    const newVal = await resetSeq(dest, t);
    console.log(`  ✓ ${t}: ${n} insertadas, seq reset → ${newVal}`);
  }

  console.log("[7/7] INSERT dji_daily_summaries, dji_legacy_snapshot, dji_flights...");
  for (const t of ["dji_daily_summaries", "dji_legacy_snapshot"]) {
    const rows = await fetchAllRows(docker, t, commonCols[t]);
    const n = await insertRowsBatched(dest, t, rows, commonCols[t]);
    const newVal = await resetSeq(dest, t);
    console.log(`  ✓ ${t}: ${n} insertadas, seq reset → ${newVal}`);
  }

  const dockerFlights = await fetchAllRows(docker, "dji_flights", commonCols.dji_flights);
  const applyFlightRemap = (rows) => {
    if (!commonCols.dji_flights.includes("parcel_id")) return;
    for (const row of rows) {
      if (row.parcel_id !== null && row.parcel_id !== undefined) {
        row.parcel_id = remapParcelId(row.parcel_id);
      }
    }
  };
  const nFlights = await insertRowsBatched(dest, "dji_flights", dockerFlights, commonCols.dji_flights, { applyRemap: applyFlightRemap });
  const flightSeq = await resetSeq(dest, "dji_flights");
  console.log(`  ✓ dji_flights: ${nFlights} insertadas, seq reset → ${flightSeq}`);

  const parcelSeq = await resetSeq(dest, "dji_parcels");
  console.log(`  ✓ dji_parcels seq reset → ${parcelSeq}`);

  console.log("\n[7b/7] ENABLE trigger trg_dji_fumigation_schedule_change...");
  await dest.query("ALTER TABLE dji_fumigation_schedule ENABLE TRIGGER trg_dji_fumigation_schedule_change");
  console.log("  ✓");

  console.log("\n=== Verificación post-migración ===");
  let allOk = true;
  for (const t of [...tables, "djiag_health"]) {
    const dc = await tableCount(docker, t);
    const sc = await tableCount(dest, t);
    const ok = dc === sc ? "✓" : (dc === null || sc === null ? "—" : "✗");
    if (ok === "✗") allOk = false;
    console.log(`  ${ok} ${t}: docker=${dc ?? "—"}, supabase=${sc ?? "—"}`);
  }

  await docker.end();
  dest.release();
  await sb.end();
  console.log(`\n[migrate-v2] ${allOk ? "✓ Migración exitosa" : "✗ Counts no coinciden"}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error("[migrate-v2] ERROR:", e.message);
  console.error(e.stack);
  process.exit(1);
});
