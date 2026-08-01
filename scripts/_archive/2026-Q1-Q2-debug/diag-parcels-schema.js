#!/usr/bin/env node
// scripts/diag-parcels-schema.js
// Inspecciona el schema real de dji_parcels y una fila de muestra.

const { Client } = require("pg");

async function main() {
  const c = new Client({
    connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights",
  });
  await c.connect();

  console.log("=== Columnas de dji_parcels ===");
  const cols = await c.query(`
    SELECT column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dji_parcels'
    ORDER BY ordinal_position
  `);
  console.log("Total columnas:", cols.rows.length);
  cols.rows.forEach((c) =>
    console.log(`  ${c.column_name.padEnd(30)} ${c.data_type.padEnd(25)} nullable=${c.is_nullable}`)
  );

  console.log("\n=== Fila de muestra (1 parcela farmland con geom) ===");
  const sample = await c.query(`
    SELECT *
    FROM dji_parcels
    WHERE field_type = 'Farmland' AND spray_geom IS NOT NULL
    LIMIT 1
  `);
  if (sample.rows.length === 0) {
    console.log("(sin filas)");
  } else {
    const row = sample.rows[0];
    console.log("id:", row.id);
    console.log("land_name:", row.land_name);
    console.log("field_type:", row.field_type);
    console.log("external_id:", row.external_id);
    console.log("--- columnas con valores (no null) ---");
    Object.entries(row).forEach(([k, v]) => {
      if (v !== null && v !== undefined) {
        let s = String(v);
        if (s.length > 80) s = s.slice(0, 80) + "...";
        console.log(`  ${k.padEnd(28)} = ${s}`);
      }
    });
    console.log("--- columnas NULL ---");
    Object.entries(row).forEach(([k, v]) => {
      if (v === null) {
        console.log(`  ${k}`);
      }
    });
  }

  await c.end();
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
