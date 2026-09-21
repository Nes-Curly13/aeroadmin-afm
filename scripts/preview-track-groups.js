#!/usr/bin/env node
// scripts/preview-track-groups.js
//
// Revisa la AGRUPACION de tracks: agrupa por dia + DBSCAN espacial
// (eps configurable) y calcula la cobertura real de cada grupo
// (buffer 2 m + union, como el pipeline viejo). Exporta un HTML con los
// poligonos de cobertura + stats, usando el Postgres local.
//
// Uso:
//   node scripts/preview-track-groups.js [--eps 0.003] [--out tmp-track-groups.html]

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function parseArgs(argv) {
  const a = { eps: 0.003, out: "tmp-track-groups.html", conn: "postgresql://postgres:postgres@localhost:5433/afm" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--eps" && argv[i + 1]) a.eps = Number(argv[++i]);
    else if (argv[i] === "--out" && argv[i + 1]) a.out = argv[++i];
    else if (argv[i] === "--conn" && argv[i + 1]) a.conn = argv[++i];
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const c = new Client({ connectionString: args.conn });
  await c.connect();
  await c.query("SET statement_timeout = 0");
  console.log(`[groups] agrupando eps=${args.eps} (~${Math.round(args.eps * 111320)} m) + día ...`);

  const sql = `
    WITH t AS (
      SELECT flight_id, ST_Force2D(geom) AS geom, drone, team, location,
             COALESCE(area_m2,0)::numeric AS area_m2, COALESCE(spray_usage,0)::numeric AS spray_usage,
             to_char(to_timestamp(start_timestamp) AT TIME ZONE 'America/Bogota','YYYY-MM-DD') AS day
        FROM dji_flight_tracks
       WHERE geom IS NOT NULL AND start_timestamp IS NOT NULL
    ),
    cl AS (
      SELECT *, ST_ClusterDBSCAN(geom, eps := ${args.eps}, minpoints := 1) OVER () AS cid FROM t
    ),
    g AS (
      SELECT cid, day,
             count(*)::int n,
             sum(area_m2)::numeric area,
             sum(spray_usage)::numeric spray,
             (array_agg(DISTINCT drone))[1:4] drones,
             (array_agg(DISTINCT team))[1:4] teams,
             mode() WITHIN GROUP (ORDER BY location) loc,
             sum(ST_Length(geom::geography))::numeric length_m,
             ST_SimplifyPreserveTopology(
               ST_Multi(ST_CollectionExtract(ST_MakeValid(
                 ST_UnaryUnion(ST_Collect(ST_Buffer(geom::geography, 2.0)::geometry))
               ),3)), 0.0001) AS cov
        FROM cl GROUP BY cid, day
    )
    SELECT cid, day, n, area, spray, drones, teams, loc, round(length_m)::bigint length_m,
           ST_AsGeoJSON(cov, 5)::json AS cov
      FROM g`;

  const res = await c.query(sql);
  await c.end();
  const groups = res.rows.map((r) => ({
    ...r,
    n: Number(r.n),
    area: Number(r.area),
    spray: Number(r.spray),
    length_m: Number(r.length_m),
  }));
  console.log(`[groups] ${groups.length} grupos`);

  const totalFlights = groups.reduce((s, g) => s + g.n, 0);
  const dist = {};
  for (const g of groups) {
    const b = g.n === 1 ? "1" : g.n <= 3 ? "2-3" : g.n <= 10 ? "4-10" : g.n <= 25 ? "11-25" : "26+";
    dist[b] = (dist[b] || 0) + 1;
  }
  const top = [...groups].sort((a, b) => b.n - a.n).slice(0, 30);

  const payload = {
    groups: groups.map((g) => ({ cov: g.cov, n: g.n, day: g.day, area: g.area, spray: g.spray, drones: g.drones, loc: g.loc })),
    stats: { eps: args.eps, epsM: Math.round(args.eps * 111320), groups: groups.length, totalFlights, dist },
    top: top.map((g) => ({ day: g.day, n: g.n, area: g.area, spray: g.spray, dron: (g.drones || [])[0], loc: g.loc })),
  };
  const html = buildHtml(payload);
  fs.writeFileSync(args.out, html, "utf8");
  console.log(`[groups] OK -> ${path.resolve(args.out)} (${(html.length / 1048576).toFixed(1)} MB)`);
  console.log("  distribución n:", JSON.stringify(dist));
}

function buildHtml(d) {
  const payload = JSON.stringify(d);
  const rows = d.top
    .map((g) => `<tr><td>${g.day}</td><td>${g.n}</td><td>${(g.area / 10000).toFixed(1)}</td><td>${(g.spray / 1000).toFixed(0)}</td><td>${g.dron || ""}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Cobertura por grupo (día + DBSCAN)</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
 body{margin:0;font:13px system-ui;background:#111;color:#eee}
 #map{position:absolute;inset:0 340px 0 0}
 #side{position:absolute;top:0;right:0;bottom:0;width:340px;overflow:auto;background:#1b1b1b;border-left:1px solid #333;padding:10px;box-sizing:border-box}
 h1{font-size:14px;margin:0 0 8px}
 .box{background:#242424;border:1px solid #333;border-radius:6px;padding:8px;margin-bottom:8px}
 .k{color:#9ae6b4;font-weight:700}
 table{width:100%;border-collapse:collapse;font-size:11px}
 td,th{border-bottom:1px solid #333;padding:2px 4px;text-align:right}
 th:first-child,td:first-child{text-align:left}
 .sw{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px}
</style></head><body>
<div id="map"></div>
<div id="side">
  <h1>Cobertura por grupo</h1>
  <div class="box">
    Regla: <b>día + DBSCAN ${d.stats.epsM} m</b><br/>
    Grupos: <span class="k">${d.stats.groups}</span> · vuelos: <span class="k">${d.stats.totalFlights}</span><br/>
    Distribución n: ${Object.entries(d.stats.dist).map(([k, v]) => `${k}:${v}`).join(" · ")}
  </div>
  <div class="box">
    <b>Top 30 grupos (más vuelos)</b>
    <table><tr><th>día</th><th>vuelos</th><th>ha</th><th>L</th><th>dron</th></tr>${rows}</table>
  </div>
  <div class="box" style="color:#aaa">Click un polígono → detalle. Fondo satélite EOX.</div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const D=${payload};
const map=L.map('map',{preferCanvas:true}).setView([3.6,-76.3],10);
L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',{maxZoom:16,attribution:'EOX'}).addTo(map);
const layer=L.layerGroup().addTo(map);
const cols=['#22d3ee','#f59e0b','#a855f7','#22c55e','#ef4444','#eab308','#3b82f6','#ec4899'];
let i=0;
D.groups.forEach(g=>{
  if(!g.cov) return;
  const col=cols[(i++)%cols.length];
  const lyr=L.geoJSON(g.cov,{style:{color:col,weight:1,fillColor:col,fillOpacity:0.35}});
  lyr.bindPopup('<b>'+g.day+'</b><br/>vuelos: '+g.n+'<br/>area: '+(g.area/10000).toFixed(2)+' ha<br/>vol: '+(g.spray/1000).toFixed(1)+' L<br/>drones: '+(g.drones||[]).join(', ')+'<br/>'+(g.loc||''));
  layer.addLayer(lyr);
});
</script></body></html>`;
}

main().catch((e) => { console.error("[groups] ERROR:", e && e.message ? e.message : e); process.exit(1); });
