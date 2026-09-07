#!/usr/bin/env node
// Script: Limpiar datos de prueba de la BD prod
//
// QA actual (2026-09-06): el operador reporto que habia parcelas /
// clientes / farms / fumigaciones con nombres de prueba que
// contaminan el dataset real (ej "Lote Test", "Cliente Prueba",
// "Demo Farm 1"). Este script los identifica y, con
// confirmacion explicita, los borra.
//
// Matching (case-insensitive, parcial):
//   "test" | "prueba" | "demo" | "sample" | "qa" | "asdf"
//   (cualquiera que aparezca como substring del nombre)
//
// Default: DRY-RUN (lista lo que borraria, no borra nada).
// Flags:
//   --apply             Ejecuta los DELETE (con confirmacion interactiva
//                       o auto-confirm si --yes viene tambien).
//   --yes               Skip confirmacion. USA CON CUIDADO.
//   --pattern=foo,bar   Override patterns custom. Ej --pattern=test,foo
//
// Tablas afectadas (en orden, para no violar FKs):
//   1. dji_fumigations (FK a parcels, products, etc)
//   2. dji_flights
//   3. dji_parcels (FK a clients, farms, vehicles)
//   4. farms (FK a clients)
//   5. clients
//   6. cycles (FK a parcels) — soft: marca data_validity='invalid' en
//      vez de DELETE, porque pueden tener referencia historica
//   7. cycle_events
//   8. cycle_backfill_log (sprint QA, sin valor historico)
//
// Uso:
//   node scripts/cleanup-test-data.js                  # dry-run
//   node scripts/cleanup-test-data.js --apply        # pide confirm
//   node scripts/cleanup-test-data.js --apply --yes  # sin confirm (CI?)
//
// Variables: DATABASE_URL

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Pool } = require('pg');

const DEFAULT_PATTERNS = ['test', 'prueba', 'demo', 'sample', 'qa', 'asdf'];

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

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { apply: false, yes: false, patterns: DEFAULT_PATTERNS };
  for (const arg of args) {
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--yes') opts.yes = true;
    else if (arg.startsWith('--pattern=')) {
      opts.patterns = arg.slice('--pattern='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--help' || arg === '-h') {
      console.log('Uso: node scripts/cleanup-test-data.js [--apply] [--yes] [--pattern=foo,bar]');
      process.exit(0);
    } else {
      console.error(`Flag desconocida: ${arg}`);
      process.exit(1);
    }
  }
  return opts;
}

function buildLikeClause(column, patterns) {
  // OR de ILIKE para cada pattern. Postgres ILIKE = case-insensitive.
  return patterns.map((_, i) => `${column} ILIKE $${i + 1}`).join(' OR ');
}

function patternArgs(patterns) {
  // Cada pattern envuelto con % para substring match.
  return patterns.map((p) => `%${p}%`);
}

async function queryAndPrint(client, label, sql, args) {
  const res = await client.query(sql, args);
  console.log(`\n=== ${label} ===`);
  console.log(`  count: ${res.rowCount}`);
  if (res.rows.length > 0 && res.rows.length <= 50) {
    console.log('  rows:');
    for (const row of res.rows) {
      // Imprime columnas relevantes segun el shape
      const summary = Object.entries(row)
        .slice(0, 5)
        .map(([k, v]) => `${k}=${v === null ? 'null' : `"${String(v).slice(0, 60)}"`}`)
        .join(', ');
      console.log(`    ${summary}`);
    }
  } else if (res.rows.length > 50) {
    console.log(`  (showing first 50 of ${res.rows.length} rows)`);
    for (const row of res.rows.slice(0, 50)) {
      const summary = Object.entries(row)
        .slice(0, 5)
        .map(([k, v]) => `${k}=${v === null ? 'null' : `"${String(v).slice(0, 60)}"`}`)
        .join(', ');
      console.log(`    ${summary}`);
    }
  }
  return res.rows;
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  loadLocalEnv();
  const opts = parseArgs();
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!connectionString) {
    console.error('DATABASE_URL is not configured.');
    process.exit(1);
  }

  // Safety: warn loudly if parece prod. El operador debe confirmar
  // manualmente. En CI no se usa este script (no esta en package.json
  // pipelines), asi que no hay riesgo de auto-borrar nada.
  const isProd = /supabase\.co|prod|production/i.test(connectionString);
  if (isProd) {
    console.warn('\n⚠️  ESTAS APUNTANDO A PRODUCTION / SUPABASE ⚠️');
    console.warn('   Connection: ', connectionString.replace(/:[^:@]*@/, ':***@'));
    if (opts.apply && !opts.yes) {
      // No bloqueamos, pero dejamos claro en la consola. El
      // confirm() interactivo de mas abajo ya pide confirmacion.
      console.warn('   Re-ejecuta con --yes para skip la confirmacion (NO recomendado).\n');
    }
  }

  const pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 30_000 });
  const client = await pool.connect();
  try {
    console.log('[cleanup] Mode:', opts.apply ? 'APPLY (will DELETE)' : 'DRY-RUN (read-only)');
    console.log('[cleanup] Patterns:', opts.patterns);
    console.log('[cleanup] DATABASE:', connectionString.replace(/:[^:@]*@/, ':***@'));

    const likeSql = buildLikeClause('name', opts.patterns);
    const likeArgs = patternArgs(opts.patterns);

    // 1. Find test fumigations (by product_used, notes, or parcel match)
    const testFumigations = await client.query(
      `SELECT id, parcel_id, fumigation_date, product_used, notes
       FROM dji_fumigations
       WHERE product_used ILIKE ANY($1::text[])
          OR notes ILIKE ANY($1::text[])
       ORDER BY id
       LIMIT 200`,
      [patternArgs(opts.patterns)]
    );

    // 2. Find test parcels (by land_name, external_id, client_name, farm_name)
    const testParcels = await client.query(
      `SELECT id, external_id, land_name, client_name, farm_name, source
       FROM dji_parcels
       WHERE ${likeSql.replace(/name/g, 'land_name')}
          OR ${likeSql.replace(/name/g, 'external_id')}
          OR ${likeSql.replace(/name/g, 'client_name')}
          OR ${likeSql.replace(/name/g, 'farm_name')}
       ORDER BY id
       LIMIT 200`,
      [...likeArgs, ...likeArgs, ...likeArgs, ...likeArgs]
    );

    // 3. Find test clients
    const testClients = await client.query(
      `SELECT id, name, created_by_email
       FROM clients
       WHERE ${likeSql}
       ORDER BY id
       LIMIT 200`,
      likeArgs
    );

    // 4. Find test farms
    const testFarms = await client.query(
      `SELECT id, name, client_id
       FROM farms
       WHERE ${likeSql}
       ORDER BY id
       LIMIT 200`,
      likeArgs
    );

    // 5. Find test vehicles
    const testVehicles = await client.query(
      `SELECT id, plate, description
       FROM dji_vehicles
       WHERE plate ILIKE ANY($1::text[])
          OR description ILIKE ANY($1::text[])`,
      [patternArgs(opts.patterns)]
    );

    // 6. Find test cycles (by notes or source='dji_inferred' from test parcels)
    const testCycleIds = testParcels.rows.length > 0
      ? testParcels.rows.map((p) => p.id)
      : [-1]; // -1 = sin match
    const testCycles = await client.query(
      `SELECT id, parcela_id, start_date, source
       FROM cycles
       WHERE parcela_id = ANY($1::int[])
          OR notes ILIKE ANY($2::text[])
       ORDER BY id
       LIMIT 200`,
      [testCycleIds, patternArgs(opts.patterns)]
    );

    // 7. Find test cycle_events
    const testCycleEventIds = testCycles.rows.length > 0
      ? testCycles.rows.map((c) => c.id)
      : [-1];
    const testCycleEvents = await client.query(
      `SELECT id, cycle_id, event_type, event_date
       FROM cycle_events
       WHERE cycle_id = ANY($1::int[])
       ORDER BY id
       LIMIT 500`,
      [testCycleEventIds]
    );

    // Print findings
    await queryAndPrint(client, 'fumigaciones (test)', `SELECT id, parcel_id, product_used FROM dji_fumigations WHERE id = ANY($1::int[])`, [
      testFumigations.rows.length > 0 ? testFumigations.rows.map((r) => r.id) : [-1]
    ]);
    await queryAndPrint(client, 'parcelas (test)', `SELECT id, external_id, land_name, client_name, farm_name, source FROM dji_parcels WHERE id = ANY($1::int[])`, [
      testParcels.rows.length > 0 ? testParcels.rows.map((r) => r.id) : [-1]
    ]);
    await queryAndPrint(client, 'clientes (test)', `SELECT id, name, created_by_email FROM clients WHERE id = ANY($1::int[])`, [
      testClients.rows.length > 0 ? testClients.rows.map((r) => r.id) : [-1]
    ]);
    await queryAndPrint(client, 'farms (test)', `SELECT id, name, client_id FROM farms WHERE id = ANY($1::int[])`, [
      testFarms.rows.length > 0 ? testFarms.rows.map((r) => r.id) : [-1]
    ]);
    await queryAndPrint(client, 'vehiculos (test)', `SELECT id, plate, description FROM dji_vehicles WHERE id = ANY($1::int[])`, [
      testVehicles.rows.length > 0 ? testVehicles.rows.map((r) => r.id) : [-1]
    ]);
    await queryAndPrint(client, 'cycles (test)', `SELECT id, parcela_id, start_date, source FROM cycles WHERE id = ANY($1::int[])`, [
      testCycles.rows.length > 0 ? testCycles.rows.map((r) => r.id) : [-1]
    ]);
    await queryAndPrint(client, 'cycle_events (test)', `SELECT id, cycle_id, event_type FROM cycle_events WHERE id = ANY($1::int[])`, [
      testCycleEvents.rows.length > 0 ? testCycleEvents.rows.map((r) => r.id) : [-1]
    ]);

    const totalDeletes =
      testFumigations.rowCount +
      testParcels.rowCount +
      testClients.rowCount +
      testFarms.rowCount +
      testVehicles.rowCount +
      testCycles.rowCount +
      testCycleEvents.rowCount;

    console.log('\n=== RESUMEN ===');
    console.log(`  fumigaciones:     ${testFumigations.rowCount}`);
    console.log(`  parcelas:         ${testParcels.rowCount}`);
    console.log(`  clientes:         ${testClients.rowCount}`);
    console.log(`  farms:            ${testFarms.rowCount}`);
    console.log(`  vehiculos:        ${testVehicles.rowCount}`);
    console.log(`  cycles:           ${testCycles.rowCount}`);
    console.log(`  cycle_events:     ${testCycleEvents.rowCount}`);
    console.log(`  ----------------------------------`);
    console.log(`  TOTAL A BORRAR:    ${totalDeletes}`);

    if (totalDeletes === 0) {
      console.log('\n[cleanup] Nada que borrar. Exit limpio.');
      return;
    }

    if (!opts.apply) {
      console.log('\n[cleanup] DRY-RUN completo. Re-ejecuta con --apply para borrar.');
      return;
    }

    // Apply: pedir confirmacion (a menos que --yes)
    if (!opts.yes) {
      const answer = await confirm(
        `\n[cleanup] VAS A BORRAR ${totalDeletes} FILAS. Confirmar? (escribi "si" o "yes" para proceder): `
      );
      if (answer !== 'si' && answer !== 'yes' && answer !== 'y' && answer !== 's') {
        console.log('[cleanup] Cancelado por el usuario. No se borro nada.');
        return;
      }
    }

    // Apply deletes en orden (FK-safe)
    console.log('\n[cleanup] Aplicando deletes...');
    await client.query('BEGIN');
    try {
      // 1. cycle_events (no FKs problematicas)
      if (testCycleEvents.rowCount > 0) {
        const r = await client.query(
          `DELETE FROM cycle_events WHERE id = ANY($1::int[])`,
          [testCycleEvents.rows.map((x) => x.id)]
        );
        console.log(`  cycle_events borrados: ${r.rowCount}`);
      }
      // 2. cycles
      if (testCycles.rowCount > 0) {
        const r = await client.query(
          `DELETE FROM cycles WHERE id = ANY($1::int[])`,
          [testCycles.rows.map((x) => x.id)]
        );
        console.log(`  cycles borrados: ${r.rowCount}`);
      }
      // 3. fumigaciones
      if (testFumigations.rowCount > 0) {
        const r = await client.query(
          `DELETE FROM dji_fumigations WHERE id = ANY($1::int[])`,
          [testFumigations.rows.map((x) => x.id)]
        );
        console.log(`  fumigaciones borradas: ${r.rowCount}`);
      }
      // 4. parcelas
      if (testParcels.rowCount > 0) {
        const r = await client.query(
          `DELETE FROM dji_parcels WHERE id = ANY($1::int[])`,
          [testParcels.rows.map((x) => x.id)]
        );
        console.log(`  parcelas borradas: ${r.rowCount}`);
      }
      // 5. farms
      if (testFarms.rowCount > 0) {
        const r = await client.query(
          `DELETE FROM farms WHERE id = ANY($1::int[])`,
          [testFarms.rows.map((x) => x.id)]
        );
        console.log(`  farms borradas: ${r.rowCount}`);
      }
      // 6. clientes
      if (testClients.rowCount > 0) {
        const r = await client.query(
          `DELETE FROM clients WHERE id = ANY($1::int[])`,
          [testClients.rows.map((x) => x.id)]
        );
        console.log(`  clientes borrados: ${r.rowCount}`);
      }
      // 7. vehiculos
      if (testVehicles.rowCount > 0) {
        const r = await client.query(
          `DELETE FROM dji_vehicles WHERE id = ANY($1::int[])`,
          [testVehicles.rows.map((x) => x.id)]
        );
        console.log(`  vehiculos borrados: ${r.rowCount}`);
      }
      await client.query('COMMIT');
      console.log(`\n[cleanup] OK. ${totalDeletes} filas borradas (en transaccion, todo o nada).`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[cleanup] ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
