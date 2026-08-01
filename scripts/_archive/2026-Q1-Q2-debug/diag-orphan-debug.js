// Debug: check orphan rows specifically in history
const { Client } = require("pg");
const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
(async () => {
  await c.connect();
  // For history, find rows where parcel_id doesn't exist in parcels
  const r = await c.query(`
    SELECT h.parcel_id, count(*)::int AS n
    FROM dji_fumigation_schedule_history h
    LEFT JOIN dji_parcels p ON p.id = h.parcel_id
    WHERE p.id IS NULL
    GROUP BY h.parcel_id
    ORDER BY n DESC
  `);
  console.log("Huérfanos en history (parcel_id sin parcel):", r.rows);
  if (r.rows.length === 0) {
    // Show a few history rows
    const r2 = await c.query("SELECT * FROM dji_fumigation_schedule_history LIMIT 3");
    console.log("\nSample history rows:");
    r2.rows.forEach((row) => console.log(" ", row));
    // Check min/max parcel_id
    const r3 = await c.query("SELECT min(parcel_id) AS mn, max(parcel_id) AS mx FROM dji_fumigation_schedule_history");
    console.log("\nMin/max parcel_id en history:", r3.rows[0]);
  }
  // Verificar que parcel_id 2420 existe en parcels
  const r4 = await c.query("SELECT id FROM dji_parcels WHERE id IN (2420, 2421, 2500, 3632, 1)");
  console.log("\nParcels con esos IDs:", r4.rows);
  await c.end();
})();
