// Insertar las primeras 3 rows de history en Supabase para ver el error exacto
const { Pool } = require("pg");
const fs = require("fs");
fs.readFileSync(".env.local", "utf-8").split(/\r?\n/).forEach((l) => {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
});

(async () => {
  const docker = new (require("pg").Client)({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
  await docker.connect();
  const sb = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const dest = await sb.connect();

  await dest.query("BEGIN");
  // Truncate history solo
  await dest.query("TRUNCATE dji_fumigation_schedule_history RESTART IDENTITY CASCADE");
  console.log("History truncada");

  // Fetch first 5 rows de docker
  const r = await docker.query("SELECT * FROM dji_fumigation_schedule_history ORDER BY id LIMIT 5");
  console.log("\nPrimeras 5 rows de docker:");
  r.rows.forEach((row) => console.log(" ", row.id, "parcel_id:", row.parcel_id));

  // Try insert one by one
  for (const row of r.rows) {
    console.log(`\nIntentando insert id=${row.id}...`);
    try {
      const cols = Object.keys(row);
      const colList = cols.map((c) => `"${c}"`).join(", ");
      const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
      const values = cols.map((c) => row[c]);
      await dest.query(`INSERT INTO dji_fumigation_schedule_history (${colList}) VALUES (${ph})`, values);
      console.log("  ✓ OK");
    } catch (e) {
      console.log("  ✗ ERROR:", e.message);
      break;
    }
  }

  await dest.query("ROLLBACK");
  await docker.end();
  dest.release();
  await sb.end();
})();
