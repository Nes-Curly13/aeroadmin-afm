#!/usr/bin/env node
// scripts/backfill-lands-metadata.js
//
// Backfill de los campos API (lands-normalized.json) sobre dji_parcels.
// NO toca los polígonos (spray_geom) ni los campos exclusivos del legacy
// import (parameter.json).
//
// Por qué existe:
//   El import API de `lib/djiag-lands-to-parcels.js` nunca se ejecutó sobre
//   las 1213 filas que dejó el legacy import (2026-07-11). Las columnas
//   `land_name`, `position`, `bbox`, `total_area_mu`, etc. quedaron todas
//   en NULL. Además, 288 parcelas (24%) tenían `is_orchard=true` por un
//   mal mapeo legacy (`parameter.tree_spray_selector=1` se interpretaba
//   como "es orchard" cuando significa "este vuelo usó modo tree-spray").
//
// Modo dry-run (default): muestra qué cambiaría sin escribir a la BD.
// Modo --apply: aplica los cambios en una sola transacción.
//
// Uso:
//   node scripts/backfill-lands-metadata.js
//   node scripts/backfill-lands-metadata.js --apply
//   node scripts/backfill-lands-metadata.js --in djiag_exports/lands.json

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const {
  landToParcelParams,
  paramsToPgArray,
  UPSERT_SQL,
} = require("../lib/djiag-lands-to-parcels");

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

function createPool(connectionString) {
  // Si el caller pasa una URL explícita (--db), usamos ESA y auto-detectamos SSL.
  // Si no, usamos la del .env.local con su DATABASE_SSL flag.
  let url;
  let useSsl;
  if (connectionString) {
    url = connectionString;
    // Auto-detect: URLs de Supabase/managed siempre requieren SSL
    useSsl = url.includes("sslmode=require") || /supabase|aliyuncs|aws-/i.test(url);
  } else {
    url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
    useSsl = process.env.DATABASE_SSL === "true";
  }
  if (!url) throw new Error("DATABASE_URL no está en .env.local y no se pasó --db");
  return new Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 30_000,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
}

async function fetchExisting(client) {
  const r = await client.query(`
    SELECT external_id, land_name, field_type, is_orchard,
           position::text AS pos_text, total_area_mu
    FROM dji_parcels
  `);
  const map = new Map();
  for (const row of r.rows) {
    map.set(row.external_id, row);
  }
  return map;
}

function diffRow(existing, p) {
  const diffs = [];
  if (existing.land_name === null && p.landName !== null) {
    diffs.push({ field: "land_name", from: null, to: p.landName });
  }
  if (existing.is_orchard !== p.isOrchard) {
    diffs.push({ field: "is_orchard", from: existing.is_orchard, to: p.isOrchard });
  }
  if (existing.field_type !== p.fieldType) {
    diffs.push({ field: "field_type", from: existing.field_type, to: p.fieldType });
  }
  if (existing.total_area_mu === null && p.totalAreaMu !== null) {
    diffs.push({ field: "total_area_mu", from: null, to: p.totalAreaMu });
  }
  if (existing.pos_text === null && p.positionWkt !== null) {
    diffs.push({ field: "position", from: null, to: p.positionWkt });
  }
  return diffs;
}

async function main() {
  loadLocalEnv();

  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const inIdx = args.indexOf("--in");
  const inPath = inIdx >= 0
    ? path.resolve(args[inIdx + 1])
    : path.join(process.cwd(), "djiag_exports", "lands-normalized.json");
  const dbIdx = args.indexOf("--db");
  const dbUrl = dbIdx >= 0 ? args[dbIdx + 1] : null;

  if (!fs.existsSync(inPath)) throw new Error(`No existe: ${inPath}`);

  const data = JSON.parse(fs.readFileSync(inPath, "utf-8"));
  const lands = data.lands || [];
  if (lands.length === 0) throw new Error(`${inPath} no tiene lands`);

  const pool = createPool(dbUrl);
  const client = await pool.connect();
  try {
    const existing = await fetchExisting(client);
    console.log(`[backfill] ${lands.length} lands en ${path.basename(inPath)}`);
    console.log(`[backfill] ${existing.size} filas existentes en dji_parcels`);

    let nWillChange = 0;
    const diffsByField = { land_name: 0, is_orchard: 0, field_type: 0, total_area_mu: 0, position: 0 };
    const sampleChanges = [];
    let nSkipped = 0;

    for (const land of lands) {
      if (!land.externalId) {
        nSkipped++;
        continue;
      }
      const ex = existing.get(land.externalId);
      if (!ex) {
        nSkipped++;
        continue;
      }
      const p = landToParcelParams(land);
      const diffs = diffRow(ex, p);
      if (diffs.length > 0) {
        nWillChange++;
        diffs.forEach((d) => {
          diffsByField[d.field] = (diffsByField[d.field] || 0) + 1;
        });
        if (sampleChanges.length < 8) {
          sampleChanges.push({ extId: land.externalId, name: land.name, diffs });
        }
      }
    }

    console.log(`\n[backfill] ${nWillChange} parcelas cambiarían datos`);
    console.log(`[backfill] ${nSkipped} skipped (sin externalId o no en BD)`);
    console.log(`\n[backfill] Diffs por campo:`);
    Object.entries(diffsByField).forEach(([k, v]) =>
      console.log(`  ${k.padEnd(20)} ${v}`)
    );

    console.log(`\n[backfill] Muestra de cambios (8):`);
    sampleChanges.forEach((s) => {
      console.log(`  ${s.extId.slice(-20)} "${s.name}":`);
      s.diffs.forEach((d) =>
        console.log(`    ${d.field}: ${d.from === null ? "NULL" : d.from} → ${d.to}`)
      );
    });

    if (!apply) {
      console.log(`\n[backfill] DRY RUN — sin cambios en BD. Pasá --apply para aplicar.`);
      return;
    }

    console.log(`\n[backfill] APLICANDO cambios en transacción...`);
    await client.query("BEGIN");

    const batchResult = await client.query(
      "INSERT INTO dji_import_batches (source) VALUES ('backfill-lands-metadata') RETURNING id"
    );
    const batchId = batchResult.rows[0].id;
    console.log(`[backfill] batch_id = ${batchId}`);

    let nUpdated = 0;
    let nErrors = 0;
    for (const land of lands) {
      if (!land.externalId) continue;
      if (!existing.has(land.externalId)) continue;
      try {
        const p = landToParcelParams(land);
        const result = await client.query(UPSERT_SQL, paramsToPgArray(batchId, p));
        if (result.rowCount > 0) nUpdated++;
      } catch (err) {
        nErrors++;
        console.error(`  [error] ${land.externalId}: ${err.message.slice(0, 120)}`);
      }
    }

    await client.query("COMMIT");
    console.log(`[backfill] OK: ${nUpdated} upserts, ${nErrors} errors`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[backfill] ERROR:", err);
    process.exit(1);
  });
}

module.exports = { main };
