// Lista FKs de docker para saber qué dropear antes del ALTER TYPE.
const { Client } = require("pg");
const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
(async () => {
  await c.connect();
  const r = await c.query(`
    SELECT
      tc.constraint_name,
      tc.table_name AS from_table,
      kcu.column_name AS from_column,
      ccu.table_name AS to_table,
      ccu.column_name AS to_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name
  `);
  console.log(`Total FKs en docker: ${r.rows.length}`);
  r.rows.forEach((row) => console.log(`  ${row.constraint_name}: ${row.from_table}.${row.from_column} → ${row.to_table}.${row.to_column}`));
  await c.end();
})();
