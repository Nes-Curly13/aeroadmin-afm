#!/usr/bin/env node
// Script: Backfill clients + farms desde dji_parcels denormalizado
//
// Sprint: S11+ / PLAN-FUMIGACIONES-V2 / Fase 3.B
// Purpose: Crea entradas en `clients` y `farms` a partir de los valores
//   denormalizados de `dji_parcels.client_name` y `dji_parcels.farm_name`.
//
// Por que es un script separado y no parte de la migration:
//   El INSERT dentro del archivo de migration
//   (20260905000000_add_clients_farms_tables.sql) fallaba con
//   "column created_by_email of relation clients does not exist"
//   a pesar de que el CREATE TABLE estaba en el mismo archivo. El
//   bug parece ser de como pg >= 8 + node-postgres manejan catalog
//   snapshots entre statements en el mismo connection. Este script
//   corre DESPUES de que la migration commiteo, asi que ve el
//   catalog actualizado.
//
// Idempotente: usa NOT EXISTS guards. Re-correr no produce duplicados.
//
// Uso:
//   node scripts/backfill-clients-farms.js
//
// Variables: DATABASE_URL

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}

async function main() {
  loadLocalEnv();
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');

  const pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 30_000 });
  const client = await pool.connect();
  try {
    console.log('[backfill] Start: clients + farms from dji_parcels denormalized');

    // 1) Clientes unicos (lower-trim) que aparecen en al menos 1 parcela
    const clientsRes = await client.query({
      text: `INSERT INTO clients (name, created_by_email, data_validity)
             SELECT DISTINCT
               p.client_name,
               'system@backfill',
               'needs_review'
             FROM dji_parcels p
             WHERE p.client_name IS NOT NULL
               AND TRIM(p.client_name) <> ''
               AND NOT EXISTS (
                 SELECT 1 FROM clients c WHERE LOWER(TRIM(c.name)) = LOWER(TRIM(p.client_name))
               )`,
      noPrepare: true,
    });
    console.log(`[backfill] Inserted ${clientsRes.rowCount} new clients`);

    // 2) Cliente "Sin asignar" para fincas sin client_name
    await client.query({
      text: `INSERT INTO clients (name, created_by_email, data_validity)
             VALUES ('(Sin asignar)', 'system@backfill', 'needs_review')
             ON CONFLICT (LOWER(TRIM(name))) DO NOTHING`,
      noPrepare: true,
    });

    // 3) Farms unicas por (client_id, name) — farms sin client_name
    //    caen bajo "(Sin asignar)" para no perderlas.
    const farmsRes = await client.query({
      text: `INSERT INTO farms (client_id, name, municipality, created_by_email, data_validity)
             SELECT DISTINCT
               COALESCE(
                 (SELECT id FROM clients WHERE LOWER(TRIM(name)) = LOWER(TRIM(p.client_name))),
                 (SELECT id FROM clients WHERE name = '(Sin asignar)')
               ),
               p.farm_name,
               p.municipality,
               'system@backfill',
               'needs_review'
             FROM dji_parcels p
             WHERE p.farm_name IS NOT NULL
               AND TRIM(p.farm_name) <> ''
               AND NOT EXISTS (
                 SELECT 1 FROM farms f
                 WHERE f.client_id = COALESCE(
                         (SELECT id FROM clients WHERE LOWER(TRIM(name)) = LOWER(TRIM(p.client_name))),
                         (SELECT id FROM clients WHERE name = '(Sin asignar)')
                       )
                   AND LOWER(TRIM(f.name)) = LOWER(TRIM(p.farm_name))
               )`,
      noPrepare: true,
    });
    console.log(`[backfill] Inserted ${farmsRes.rowCount} new farms`);

    // 4) Resumen
    const summary = await client.query({
      text: `SELECT
               (SELECT COUNT(*) FROM clients WHERE data_validity = 'needs_review') AS clients_to_review,
               (SELECT COUNT(*) FROM farms WHERE data_validity = 'needs_review') AS farms_to_review,
               (SELECT COUNT(*) FROM dji_parcels WHERE client_id IS NULL) AS parcels_unassigned`,
      noPrepare: true,
    });
    console.log('[backfill] Summary:', summary.rows[0]);
    console.log('[backfill] Done. Operator should review data_validity=needs_review rows in the UI.');
  } catch (err) {
    console.error('[backfill] ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main();
}
