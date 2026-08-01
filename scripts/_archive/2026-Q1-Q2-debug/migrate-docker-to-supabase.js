#!/usr/bin/env node
// scripts/migrate-docker-to-supabase.js
//
// Migración docker → Supabase. "docker como source of truth".
//
// Hace:
//   1. TRUNCATE dji_parcels CASCADE en Supabase (borra fumigations, schedules, history)
//   2. DELETE dji_flights (se reimporta desde docker con parcel_id remapeado)
//   3. INSERT dji_parcels desde docker con IDs nuevos
//   4. INSERT fumigations/schedules/history/daily_summaries/legacy_snapshot desde docker
//      con parcel_id remapeado
//   5. INSERT dji_flights desde docker con parcel_id remapeado
//   6. Verifica conteos
//
// Schema diffs manejados:
//   - dji_parcels: Supabase tiene 4 cols extra (client_name, farm_name, municipality,
//     variety) → quedan NULL
//   - dji_fumigations: Supabase tiene 3 cols extra (human_notes, product_registered_ica,
//     pilot_license) → quedan NULL
//
// Idempotente solo en el sentido que TRUNCATE + INSERT es repetible (mismos datos).
// El script NO es idempotente si lo corrés 2 veces: el segundo run intenta TRUNCATE
// un estado que ya fue migrado y va a generar nuevos IDs. NO LO CORRAS 2 VECES.

const fs = require("fs");
const path = require("path");
const { Client, Pool } = require("pg");

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envEnvPath = envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}

async function colsOf(c, table) {
  const r = await c.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return r.rows.map((row) => row.column_name);
}

async function tableCount(c, table) {
  try {
    const r = await c.query(`SELECT count(*)::int AS n FROM "${table}"`);
    return r.rows[0].n;
  } catch (e) {
    if (e.code === '42P01') return null; // relation does not exist
    throw e;
  }
}

async function fetchAllRows(src, table, colNames) {
  // Genera un SELECT explícito de las columnas comunes para evitar el caso
  // de columnas que existen solo en docker (e.g., dji_daily_summaries).
  const cols = colNames.map((c) => `"${c}"`).join(", ");
  const r = await src.query(`SELECT ${cols} FROM "${table}"`);
  return r.rows;
}

function buildInsertPlaceholders(nCols) {
  // $1, $2, ..., $N
  return Array.from({ length: nCols }, (_, i) => `$${i + 1}`).join(", ");
}

async function insertRows(dest, table, rows, colNames) {
  if (rows.length === 0) return 0;
  const cols = colNames.map((c) => `"${c}"`).join(", ");
  const ph = buildInsertPlaceholders(colNames.length);
  const sql = `INSERT INTO "${table}" (${cols}) VALUES (${ph})`;
  let inserted = 0;
  for (const row of rows) {
    const values = colNames.map((c) => row[c] === undefined ? null : row[c]);
    await dest.query(sql, values);
    inserted++;
  }
  return inserted;
}

async function main() {
  loadLocalEnv();

  // Conexión docker (source)
  const docker = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
  await docker.connect();
  // Conexión Supabase (destino)
  const sb = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const dest = await sb.connect();

  console.log("[migrate] Iniciando migración docker → Supabase\n");

  // Estado inicial
  console.log("=== Estado inicial ===");
  for (const t of ["dji_parcels", "dji_flights", "dji_fumigations", "dji_fumigation_schedule", "dji_fumigation_schedule_history", "dji_daily_summaries", "dji_legacy_snapshot"]) {
    const c = await tableCount(dest, t);
    console.log(`  supabase.${t}: ${c}`);
  }

  // Determinar columnas comunes para cada tabla
  console.log("\n=== Columnas comunes (docker ∩ supabase) ===");
  const tables = ["dji_parcels", "dji_flights", "dji_fumigations", "dji_fumigation_schedule", "dji_fumigation_schedule_history", "dji_daily_summaries", "dji_legacy_snapshot"];
  const commonCols = {};
  for (const t of tables) {
    const dcols = new Set(await colsOf(docker, t));
    const scols = new Set(await colsOf(dest, t));
    commonCols[t] = [...dcols].filter((c) => scols.has(c));
    console.log(`  ${t}: ${commonCols[t].length} cols`);
  }

  // 1. TRUNCATE multiple (incluye dependents, RESTART IDENTITY en todas)
  // - dji_parcels: la principal
  // - dji_fumigations, dji_fumigation_schedule, dji_fumigation_schedule_history: ON DELETE CASCADE
  //   se borran automáticamente, pero necesitamos RESTART IDENTITY para que sus
  //   sequences arranquen desde 1 (sino siguen en max+1 y colisionan con IDs de docker)
  // - dji_flights: ON DELETE SET NULL, la limpiamos con DELETE más adelante
  console.log("\n[1/6] TRUNCATE dji_parcels + dependents en Supabase (RESTART IDENTITY)...");
  await dest.query("BEGIN");
  try {
    await dest.query(
      "TRUNCATE dji_parcels, dji_fumigations, dji_fumigation_schedule, dji_fumigation_schedule_history RESTART IDENTITY CASCADE"
    );
    console.log("  ✓ Truncado (sequences reseteadas)");
  } catch (err) {
    await dest.query("ROLLBACK");
    throw err;
  }

  // 1b. Crear batch de migración (necesario para FK dji_parcels.batch_id)
  console.log("[1b] Creando batch de migración en dji_import_batches...");
  const batchRes = await dest.query(
    `INSERT INTO dji_import_batches (source) VALUES ('docker-migration') RETURNING id`
  );
  const migrationBatchId = batchRes.rows[0].id;
  console.log(`  ✓ batch_id = ${migrationBatchId}`);

  // 2. DELETE dji_flights (se reimporta desde docker)
  console.log("[2/6] DELETE dji_flights en Supabase...");
  await dest.query("DELETE FROM dji_flights");
  console.log("  ✓ Borrado");

  // 3. INSERT dji_parcels desde docker, capturar mapping
  console.log("[3/6] INSERT dji_parcels desde docker...");
  const dockerParcels = await fetchAllRows(docker, "dji_parcels", commonCols.dji_parcels);
  const parcelMap = new Map(); // docker_old_id → supabase_new_id
  for (const row of dockerParcels) {
    const oldId = row.id;
    // Forzar batch_id al batch de migración
    row.batch_id = migrationBatchId;
    const cols = commonCols.dji_parcels;
    const values = cols.map((c) => row[c] === undefined ? null : row[c]);
    const ph = buildInsertPlaceholders(cols.length);
    const colList = cols.map((c) => `"${c}"`).join(", ");
    const r = await dest.query(
      `INSERT INTO dji_parcels (${colList}) VALUES (${ph}) RETURNING id`,
      values
    );
    parcelMap.set(oldId, r.rows[0].id);
  }
  console.log(`  ✓ ${parcelMap.size} parcelas insertadas (batch_id=${migrationBatchId})`);

  // 4. INSERT fumigations + schedules + history desde docker con parcel_id remapeado
  console.log("[4/6] INSERT dji_fumigations, dji_fumigation_schedule, dji_fumigation_schedule_history...");
  for (const t of ["dji_fumigations", "dji_fumigation_schedule", "dji_fumigation_schedule_history"]) {
    // Resetear sequence al max(id) actual de Supabase, +1, antes de insert.
    // Necesario porque los IDs de docker pueden colisionar con la sequence.
    try {
      await dest.query(
        `SELECT setval(pg_get_serial_sequence('"${t}"', 'id'), GREATEST(1, COALESCE((SELECT max(id) FROM "${t}"), 0) + 1))`
      );
    } catch (e) {
      // Si no hay serial, skip
    }
    const rows = await fetchAllRows(docker, t, commonCols[t]);
    // Remap parcel_id si está en la lista de columnas
    if (commonCols[t].includes("parcel_id")) {
      for (const row of rows) {
        if (row.parcel_id !== null && row.parcel_id !== undefined) {
          const newId = parcelMap.get(row.parcel_id);
          if (newId === undefined) {
            // huérfano, dejar NULL
            row.parcel_id = null;
          } else {
            row.parcel_id = newId;
          }
        }
      }
    }
    const n = await insertRows(dest, t, rows, commonCols[t]);
    console.log(`  ✓ ${t}: ${n} insertadas`);
  }

  // 5. INSERT dji_daily_summaries, dji_legacy_snapshot
  console.log("[5/6] INSERT dji_daily_summaries, dji_legacy_snapshot...");
  for (const t of ["dji_daily_summaries", "dji_legacy_snapshot"]) {
    // Verificar que la tabla existe en Supabase antes de intentar
    const cols = await colsOf(dest, t);
    if (cols.length === 0) {
      console.log(`  ⊘ ${t}: no existe en Supabase, saltando`);
      continue;
    }
    // Recalcular commonCols en caso de que docker tenga cols que supabase no
    const dcols = new Set(await colsOf(docker, t));
    const scols = new Set(cols);
    const common = commonCols[t].filter((c) => scols.has(c));
    const rows = await fetchAllRows(docker, t, common);
    const n = await insertRows(dest, t, rows, common);
    console.log(`  ✓ ${t}: ${n} insertadas`);
  }

  // 6. INSERT dji_flights desde docker con parcel_id remapeado
  console.log("[6/6] INSERT dji_flights desde docker con parcel_id remapeado...");
  const dockerFlights = await fetchAllRows(docker, "dji_flights", commonCols.dji_flights);
  for (const row of dockerFlights) {
    if (row.parcel_id !== null && row.parcel_id !== undefined) {
      const newId = parcelMap.get(row.parcel_id);
      row.parcel_id = newId === undefined ? null : newId;
    }
  }
  const nFlights = await insertRows(dest, "dji_flights", dockerFlights, commonCols.dji_flights);
  console.log(`  ✓ dji_flights: ${nFlights} insertadas`);

  // COMMIT
  await dest.query("COMMIT");

  // Verificación
  console.log("\n=== Verificación post-migración ===");
  for (const t of ["dji_parcels", "dji_flights", "dji_fumigations", "dji_fumigation_schedule", "dji_fumigation_schedule_history", "dji_daily_summaries", "dji_legacy_snapshot"]) {
    const dc = await tableCount(docker, t);
    const sc = await tableCount(dest, t);
    const ok = dc === sc ? "✓" : (dc === null ? "—" : "✗");
    console.log(`  ${ok} ${t}: docker=${dc ?? "—"}, supabase=${sc ?? "—"}`);
  }

  // Reset de sequences
  console.log("\n[seq] Reseteando sequences...");
  for (const t of ["dji_parcels", "dji_flights", "dji_fumigations", "dji_fumigation_schedule", "dji_fumigation_schedule_history", "dji_daily_summaries", "dji_legacy_snapshot"]) {
    try {
      await dest.query(
        `SELECT setval(pg_get_serial_sequence('"${t}"', 'id'), COALESCE((SELECT max(id) FROM "${t}"), 1))`
      );
    } catch (e) {
      // Si no hay serial, skip
    }
  }
  console.log("  ✓ Sequences reseteadas");

  await docker.end();
  dest.release();
  await sb.end();
  console.log("\n[migrate] ✓ Migración completada");
}

main().catch((e) => {
  console.error("[migrate] ERROR:", e.message);
  console.error(e.stack);
  process.exit(1);
});
