const { Client } = require("pg");
const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
(async () => {
  await c.connect();
  const r = await c.query(`
    SELECT id, count(*)::int AS n
    FROM dji_fumigation_schedule_history
    GROUP BY id
    HAVING count(*) > 1
  `);
  console.log("Duplicados de id en history:", r.rows);
  const r2 = await c.query("SELECT min(id) AS mn, max(id) AS mx, count(*)::int AS n FROM dji_fumigation_schedule_history");
  console.log("History stats:", r2.rows[0]);
  const r3 = await c.query("SELECT min(id) AS mn, max(id) AS mx, count(*)::int AS n FROM dji_fumigations");
  console.log("Fumigations stats:", r3.rows[0]);
  const r4 = await c.query("SELECT min(id) AS mn, max(id) AS mx, count(*)::int AS n FROM dji_fumigation_schedule");
  console.log("Schedule stats:", r4.rows[0]);
  // ID ranges overlap?
  const hIds = await c.query("SELECT id FROM dji_fumigation_schedule_history ORDER BY id");
  const fIds = await c.query("SELECT id FROM dji_fumigations ORDER BY id");
  const sIds = await c.query("SELECT id FROM dji_fumigation_schedule ORDER BY id");
  const hSet = new Set(hIds.rows.map((r) => r.id));
  const fSet = new Set(fIds.rows.map((r) => r.id));
  const sSet = new Set(sIds.rows.map((r) => r.id));
  let hfDupes = 0, hsDupes = 0, fsDupes = 0;
  for (const id of hSet) {
    if (fSet.has(id)) hfDupes++;
    if (sSet.has(id)) hsDupes++;
  }
  for (const id of fSet) if (sSet.has(id)) fsDupes++;
  console.log(`\nOverlap: history∩fumigations=${hfDupes}, history∩schedule=${hsDupes}, fumigations∩schedule=${fsDupes}`);
  await c.end();
})();
