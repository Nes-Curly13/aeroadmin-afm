const { Client } = require("pg");
const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
(async () => {
  await c.connect();
  const r = await c.query(`
    SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type,
           pg_get_serial_sequence(quote_ident(c.relname), a.attname) AS seq
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE c.relname IN ('dji_parcels', 'dji_flights', 'dji_fumigations', 'dji_fumigation_schedule', 'dji_fumigation_schedule_history', 'dji_import_batches')
      AND a.attname IN ('id', 'parcel_id', 'batch_id')
      AND n.nspname = 'public'
      AND a.attnum > 0
    ORDER BY tbl, col
  `);
  console.log("Columnas id/parcel_id/batch_id en docker:");
  r.rows.forEach((row) => console.log(`  ${row.tbl}.${row.col} ${row.type}  seq=${row.seq ?? "—"}`));

  const r2 = await c.query(`
    SELECT c.relname AS seq
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE c.relkind = 'S' AND n.nspname = 'public'
    ORDER BY c.relname
  `);
  console.log("\nSequences en docker:");
  r2.rows.forEach((row) => console.log(`  ${row.seq}`));
  await c.end();
})();
