#!/usr/bin/env node
// scripts/check-flight-ids-integrity.js
//
// Auditoría #52 (propuesta A+): monitor READ-ONLY de integridad de
// `dji_fumigations.flight_ids`. El array guarda `dji_flights.flight_id`
// (externo DJI) pero no puede tener FK, así que puede haber referencias
// huérfanas (a un flight que no existe).
//
// No escribe nada. Exit code:
//   0 → sin huérfanos
//   2 → hay huérfanos (útil para CI / watchdog)
//   1 → error de configuración/conexión
//
// Uso: node scripts/check-flight-ids-integrity.js

const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

function loadEnv() {
  if (process.env.DATABASE_URL) return;
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

async function main() {
  loadEnv();
  const url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!url) {
    console.error("[check-flight-ids] falta DATABASE_URL (o .env.local)");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: url,
    max: 2,
    connectionTimeoutMillis: 10_000,
    ssl:
      process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: false }
        : undefined
  });

  try {
    const summary = await pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE flight_ids IS NOT NULL AND array_length(flight_ids, 1) > 0
        )::int AS with_flight_ids,
        COUNT(*) FILTER (
          WHERE EXISTS (SELECT 1 FROM unnest(flight_ids) x WHERE x IS NULL)
        )::int AS with_null_entries
      FROM dji_fumigations
      WHERE deleted_at IS NULL
    `);

    const orphans = await pool.query(`
      SELECT f.id AS fumigation_id, fid AS orphan_flight_id
        FROM dji_fumigations f
        CROSS JOIN LATERAL unnest(f.flight_ids) AS fid
       WHERE f.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM dji_flights fl WHERE fl.flight_id = fid
         )
       ORDER BY f.id
       LIMIT 200
    `);

    const s = summary.rows[0] ?? { with_flight_ids: 0, with_null_entries: 0 };
    console.log("== Integridad de dji_fumigations.flight_ids (#52) ==");
    console.log(`Fumigaciones con flight_ids : ${s.with_flight_ids}`);
    console.log(`Fumigaciones con null en arr : ${s.with_null_entries}`);
    console.log(
      `Pares huérfanos (fum, flight): ${
        orphans.rows.length >= 200 ? ">=200" : orphans.rows.length
      }`
    );
    for (const r of orphans.rows.slice(0, 20)) {
      console.log(`  - fumigación #${r.fumigation_id} → flight_id ${r.orphan_flight_id}`);
    }
    if (orphans.rows.length === 0 && s.with_null_entries === 0) {
      console.log("OK: sin huérfanos ni nulls.");
    }
    process.exitCode = orphans.rows.length > 0 || s.with_null_entries > 0 ? 2 : 0;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[check-flight-ids] error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
