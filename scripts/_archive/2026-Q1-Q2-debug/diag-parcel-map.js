const { Client, Pool } = require("pg");
const fs = require("fs");
fs.readFileSync(".env.local", "utf-8").split(/\r?\n/).forEach((l) => {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
});

(async () => {
  const docker = new (require("pg").Client)({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
  await docker.connect();

  // docker parcels
  const r = await docker.query("SELECT id FROM dji_parcels ORDER BY id");
  console.log(`docker parcels: ${r.rows.length}`);
  const dParcelIds = new Set(r.rows.map((row) => row.id));
  // Verificar si 2420 está
  console.log(`parcel 2420 en docker dji_parcels: ${dParcelIds.has(2420)}`);
  console.log(`parcel 2420 como string: ${dParcelIds.has("2420")}`);
  // docker history parcel_ids únicos
  const r2 = await docker.query("SELECT DISTINCT parcel_id FROM dji_fumigation_schedule_history");
  const hIds = new Set(r2.rows.map((row) => row.parcel_id));
  console.log(`history parcel_ids distintos: ${hIds.size}`);
  // Huérfanos reales
  const orphans = [...hIds].filter((id) => !dParcelIds.has(id) && !dParcelIds.has(String(id)));
  console.log(`Huérfanos (parcel_id sin parcel en docker): ${orphans.length}`);
  if (orphans.length > 0) {
    console.log("  Ejemplos:", orphans.slice(0, 10));
  }
  await docker.end();
})();
