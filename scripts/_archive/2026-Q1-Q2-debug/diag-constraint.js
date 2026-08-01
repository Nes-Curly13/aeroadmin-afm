#!/usr/bin/env node
// scripts/diag-constraint.js
// Verifica constraints reales de dji_parcels en la BD.

const { Client } = require("pg");

const c = new Client({
  connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights",
});

(async () => {
  await c.connect();

  console.log("=== UNIQUE constraints en dji_parcels ===");
  const u = await c.query(`
    SELECT con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'dji_parcels' AND con.contype = 'u'
  `);
  u.rows.forEach((r) => console.log(`  ${r.conname}: ${r.def}`));

  console.log("\n=== Índices ===");
  const idx = await c.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'dji_parcels'
    ORDER BY indexname
  `);
  idx.rows.forEach((r) => console.log(`  ${r.indexname}\n    ${r.indexdef}`));

  console.log("\n=== Distribución de batch_id en dji_parcels ===");
  const b = await c.query(`
    SELECT batch_id, count(*)::int AS n,
           min(fetched_at) AS first,
           max(fetched_at) AS last
    FROM dji_parcels
    GROUP BY batch_id
    ORDER BY batch_id
  `);
  b.rows.forEach((r) =>
    console.log(`  batch ${r.batch_id}: ${r.n} filas (${r.first?.toISOString()} → ${r.last?.toISOString()})`)
  );

  await c.end();
})();
