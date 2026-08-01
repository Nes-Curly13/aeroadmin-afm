// Quick: counts of NULLs in the API-imported columns
const { Pool } = require("pg");
const p = new Pool({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
(async () => {
  const c = await p.connect();
  const r = await c.query(`
    SELECT
      count(*)::int AS total,
      count(land_name)::int AS with_land_name,
      count(position)::int AS with_position,
      count(bbox)::int AS with_bbox,
      count(total_area_mu)::int AS with_total_area_mu,
      count(dji_land_uuid)::int AS with_uuid,
      count(serial_number)::int AS with_serial,
      count(spray_geom)::int AS with_geom,
      count(tags)::int AS with_tags
    FROM dji_parcels
  `);
  console.log(JSON.stringify(r.rows[0], null, 2));
  c.release();
  await p.end();
})();
