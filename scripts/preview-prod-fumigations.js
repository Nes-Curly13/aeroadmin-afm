#!/usr/bin/env node
// scripts/preview-prod-fumigations.js
//
// Genera un HTML para revisar el RESULTADO en prod: las fumigaciones
// reagrupadas (dia + DBSCAN) con su cobertura real. Lee de Supabase
// (read-only) y escribe tmp-prod-fumigations.html.
//
// Uso: node scripts/preview-prod-fumigations.js

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}

async function main() {
  loadLocalEnv();
  const c = new Client({
    connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT,
    ssl: (process.env.DATABASE_SSL || "false") === "true" ? { rejectUnauthorized: false } : undefined,
  });
  await c.connect();
  await c.query("SET statement_timeout = '15min'");
  const res = await c.query(`
    SELECT f.id, f.fumigation_date::text AS d, f.flight_count,
           f.area_m2_total::float8 AS area_m2, f.spray_usage_total::float8 AS spray_ml,
           f.needs_parcel_assignment AS orphan, f.parcel_id,
           p.land_name, p.farm_name, p.municipality,
           agg.drone_nickname AS drone,
           ST_AsGeoJSON(f.coverage, 5)::json AS cov
      FROM dji_fumigations f
      LEFT JOIN dji_parcels p ON p.id = f.parcel_id
      LEFT JOIN mv_fumigation_flights_agg agg ON agg.fumigation_id = f.id
     WHERE f.deleted_at IS NULL AND f.source = 'import' AND f.session_key IS NOT NULL
     ORDER BY f.fumigation_date DESC, f.id DESC`);
  await c.end();
  const fums = res.rows;
  console.log(`[prod] ${fums.length} fumigaciones`);

  const withCov = fums.filter((f) => f.cov);
  const stats = {
    total: fums.length,
    orphans: fums.filter((f) => f.orphan).length,
    areaHa: fums.reduce((s, f) => s + Number(f.area_m2 || 0), 0) / 10000,
    sprayL: fums.reduce((s, f) => s + Number(f.spray_ml || 0), 0) / 1000,
    d0: fums.length ? fums[fums.length - 1].d : "",
    d1: fums.length ? fums[0].d : "",
  };
  const top = [...fums].sort((a, b) => (b.flight_count || 0) - (a.flight_count || 0)).slice(0, 40);

  const payload = {
    fums: withCov.map((f) => ({
      cov: f.cov, id: f.id, d: f.d, n: f.flight_count,
      area: Number(f.area_m2 || 0), spray: Number(f.spray_ml || 0),
      orphan: !!f.orphan, land: f.land_name, farm: f.farm_name, mun: f.municipality, drone: f.drone,
    })),
    stats,
    top: top.map((f) => ({ id: f.id, d: f.d, n: f.flight_count, area: Number(f.area_m2 || 0), spray: Number(f.spray_ml || 0), orphan: f.orphan, land: f.land_name })),
  };
  const html = buildHtml(payload);
  fs.writeFileSync("tmp-prod-fumigations.html", html, "utf8");
  console.log(`[prod] OK -> ${path.resolve("tmp-prod-fumigations.html")} (${(html.length / 1048576).toFixed(1)} MB)`);
  console.log(`  total ${stats.total} · huérfanas ${stats.orphans} · ${stats.areaHa.toFixed(0)} ha · ${stats.sprayL.toFixed(0)} L · ${stats.d0}..${stats.d1}`);
}

function buildHtml(d) {
  const payload = JSON.stringify(d);
  const rows = d.top
    .map((f) => `<tr title="${f.land || "sin parcela"}"><td>${f.d}</td><td>${f.n}</td><td>${(f.area / 10000).toFixed(1)}</td><td>${(f.spray / 1000).toFixed(0)}</td><td>${f.orphan ? "sí" : ""}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Fumigaciones en prod — cobertura</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
 body{margin:0;font:13px system-ui;background:#111;color:#eee}
 #map{position:absolute;inset:0 340px 0 0}
 #side{position:absolute;top:0;right:0;bottom:0;width:340px;overflow:auto;background:#1b1b1b;border-left:1px solid #333;padding:10px;box-sizing:border-box}
 h1{font-size:14px;margin:0 0 8px}
 .box{background:#242424;border:1px solid #333;border-radius:6px;padding:8px;margin-bottom:8px}
 .box label{display:flex;gap:6px;align-items:center;margin:3px 0;cursor:pointer}
 .k{color:#9ae6b4;font-weight:700}
 table{width:100%;border-collapse:collapse;font-size:11px}
 td,th{border-bottom:1px solid #333;padding:2px 4px;text-align:right}
 th:first-child,td:first-child{text-align:left}
 .sw{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px}
 select{background:#111;color:#eee;border:1px solid #444;border-radius:4px;padding:2px}
</style></head><body>
<div id="map"></div>
<div id="side">
  <h1>Fumigaciones en prod</h1>
  <div class="box">
    Regla: <b>día + DBSCAN 330 m</b> · cobertura real (buffer 2 m)<br/>
    Total: <span class="k">${d.stats.total}</span> · huérfanas: <span class="k">${d.stats.orphans}</span><br/>
    ${d.stats.areaHa.toFixed(0)} ha · ${d.stats.sprayL.toFixed(0)} L<br/>
    ${d.stats.d0} → ${d.stats.d1}
  </div>
  <div class="box">
    <label><input type="checkbox" id="cMatched" checked/><span class="sw" style="background:#06b6d4"></span> Con parcela</label>
    <label><input type="checkbox" id="cOrphan" checked/><span class="sw" style="background:#a855f7"></span> Huérfanas (sin parcela)</label>
    <div style="margin-top:6px">Desde: <select id="fFrom">${["", ...uniqMonths(d)].map((m) => `<option value="${m}">${m || "(todas)"}</option>`).join("")}</select></div>
  </div>
  <div class="box"><b>Top 40 por nº de vuelos</b>
    <table><tr><th>fecha</th><th>vuelos</th><th>ha</th><th>L</th><th>huérf</th></tr>${rows}</table>
  </div>
  <div class="box" style="color:#aaa">Click un polígono → detalle. Fondo EOX Sentinel-2.</div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const D=${payload};
const map=L.map('map',{preferCanvas:true}).setView([3.6,-76.3],10);
L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',{maxZoom:16,attribution:'EOX'}).addTo(map);
const matched=L.layerGroup().addTo(map), orphan=L.layerGroup().addTo(map);
D.fums.forEach(f=>{
  const col=f.orphan?'#a855f7':'#06b6d4';
  const lyr=L.geoJSON(f.cov,{style:{color:col,weight:1.2,fillColor:col,fillOpacity:f.orphan?0.45:0.3}});
  const where=f.land?('<b>'+f.land+'</b><br/>'+(f.farm||'')+' · '+(f.mun||'')):'<b>Sin parcela asignada</b>';
  lyr.bindPopup(where+'<br/>'+f.d+' · '+f.n+' vuelos<br/>area '+(f.area/10000).toFixed(2)+' ha · '+(f.spray/1000).toFixed(1)+' L<br/>dron: '+(f.drone||'-')+'<br/><a target="_blank" href="/fumigaciones/'+f.id+'">ver fumigación →</a>');
  (f.orphan?orphan:matched).addLayer(lyr);
});
document.getElementById('cMatched').addEventListener('change',e=>{e.target.checked?map.addLayer(matched):map.removeLayer(matched)});
document.getElementById('cOrphan').addEventListener('change',e=>{e.target.checked?map.addLayer(orphan):map.removeLayer(orphan)});
</script></body></html>`;
}

function uniqMonths(d) {
  const s = new Set();
  for (const f of d.fums) if (f.d) s.add(f.d.slice(0, 7));
  return [...s].sort();
}

main().catch((e) => { console.error("[prod] ERROR:", e && e.message ? e.message : e); process.exit(1); });
