// scripts/diag-orphans.js
// Busca huérfanos: filas de fumigations/schedules/history cuyo parcel_id
// no existe en dji_parcels.

const { Client } = require("pg");
const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
(async () => {
  await c.connect();
  for (const t of ["dji_fumigations", "dji_fumigation_schedule", "dji_fumigation_schedule_history"]) {
    const r = await c.query(`
      SELECT count(*)::int AS n, MIN(parcel_id) AS min_p, MAX(parcel_id) AS max_p,
             (SELECT count(*)::int FROM ${t} WHERE parcel_id IS NULL) AS n_null
      FROM ${t}
    `);
    console.log(`${t}:`, r.rows[0]);
    const orphan = await c.query(`
      SELECT parcel_id, count(*)::int AS n
      FROM ${t}
      WHERE parcel_id IS NOT NULL
        AND parcel_id NOT IN (SELECT id FROM dji_parcels)
      GROUP BY parcel_id
      ORDER BY n DESC
      LIMIT 5
    `);
    if (orphan.rows.length) {
      console.log(`  Huérfanos (parcel_id sin parcela):`);
      orphan.rows.forEach((r) => console.log(`    parcel_id=${r.parcel_id} count=${r.n}`));
    }
  }
  // Max parcel_id in docker
  const r2 = await c.query("SELECT max(id) AS m FROM dji_parcels");
  console.log(`\nMax parcel_id en docker: ${r2.rows[0].m}`);
  await c.end();
})();
