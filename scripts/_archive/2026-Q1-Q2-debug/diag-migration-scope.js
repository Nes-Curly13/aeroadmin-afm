// scripts/diag-migration-scope.js
// Inventario de las dos BD para planear la migración docker → Supabase.
// Lista todas las tablas con conteos y muestra las FKs que apuntan a dji_parcels.

const { Client, Pool } = require("pg");
const fs = require("fs");
fs.readFileSync(".env.local", "utf-8").split(/\r?\n/).forEach((l) => {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
});

async function getStats(c, label) {
  console.log(`\n=== ${label} ===`);
  // Tables in public schema
  const tables = await c.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  console.log(`Tablas: ${tables.rows.length}`);
  for (const { table_name } of tables.rows) {
    try {
      const r = await c.query(`SELECT count(*)::int AS n FROM "${table_name}"`);
      console.log(`  ${table_name.padEnd(40)} ${r.rows[0].n}`);
    } catch (e) {
      console.log(`  ${table_name.padEnd(40)} (error: ${e.message.slice(0, 80)})`);
    }
  }
  // FKs apuntando a dji_parcels
  console.log(`\nFKs que apuntan a dji_parcels:`);
  const fks = await c.query(`
    SELECT
      tc.table_name AS from_table,
      kcu.column_name AS from_column,
      ccu.table_name AS to_table,
      ccu.column_name AS to_column,
      rc.delete_rule,
      rc.update_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'dji_parcels'
  `);
  fks.rows.forEach((r) =>
    console.log(`  ${r.from_table}.${r.from_column} → dji_parcels.${r.to_column}  ON DELETE ${r.delete_rule}`)
  );
}

(async () => {
  const docker = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
  await docker.connect();
  await getStats(docker, "DOCKER (source)");
  await docker.end();

  const sb = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const c = await sb.connect();
  await getStats(c, "SUPABASE (destino)");
  c.release();
  await sb.end();
})();
