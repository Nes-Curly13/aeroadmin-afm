const { Client } = require("pg");
const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
(async () => {
  await c.connect();
  const r = await c.query("SELECT id, source, imported_at FROM dji_import_batches ORDER BY id");
  console.log("Batches en docker:");
  r.rows.forEach((row) => console.log(`  id=${row.id} source=${row.source}`));
  console.log("\nMax id:", r.rows[r.rows.length - 1]?.id);
  const r2 = await c.query("SELECT last_value, is_called FROM dji_import_batches_id_seq");
  console.log("\nSequence state:", r2.rows[0]);
  await c.end();
})();
