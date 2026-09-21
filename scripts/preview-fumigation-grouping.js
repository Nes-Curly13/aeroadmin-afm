#!/usr/bin/env node
// scripts/preview-fumigation-grouping.js
//
// Genera un HTML autocontenido (Leaflet + satelite EOX) para COMPARAR
// estrategias de agrupacion de vuelos -> fumigaciones, usando los datos
// reales de prod. Pensado para decidir el criterio de import (ver
// screenshot con las franjas violetas de hulls huerfanos).
//
// Capas:
//   - Vuelos (puntos)
//   - Hulls ACTUALES (mv_fumigation_hulls): lo que hoy se dibuja.
//   - Hulls alternativa ESPACIAL: huerfanos clusterizados por proximidad.
//   - Parcelas dji (contorno tenue)
// Tabla con los grupos actuales mas "estirados" (dispersion).
//
// Uso:
//   node scripts/preview-fumigation-grouping.js [--eps 300] [--gap 30]
// Salida: tmp-fumigation-preview.html (abrir en el browser).

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

function parseArgs(argv) {
  const a = { eps: 300, gap: 30, out: "tmp-fumigation-preview.html" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--eps" && argv[i + 1]) a.eps = Number(argv[++i]);
    else if (argv[i] === "--gap" && argv[i + 1]) a.gap = Number(argv[++i]);
    else if (argv[i] === "--out" && argv[i + 1]) a.out = argv[++i];
  }
  return a;
}

const R = 111320; // m por grado
function distM(aLng, aLat, bLng, bLat) {
  const dx = (bLng - aLng) * R * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  const dy = (bLat - aLat) * R;
  return Math.sqrt(dx * dx + dy * dy);
}

// Convex hull (monotone chain) de [[lng,lat],...]
function convexHull(points) {
  if (points.length < 3) return null;
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  const hull = lower.concat(upper);
  return hull.length >= 3 ? [...hull, hull[0]] : null;
}

function dayBogota(iso) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

// Convierte un geometry GeoJSON (objeto o string) a un anillo [[lng,lat]].
function geoJsonToPoints(h) {
  let g = h;
  if (typeof g === "string") {
    try { g = JSON.parse(g); } catch { return null; }
  }
  if (!g || !g.coordinates) return null;
  try {
    if (g.type === "Polygon") return g.coordinates[0].map((p) => [p[0], p[1]]);
    if (g.type === "LineString") return g.coordinates.map((p) => [p[0], p[1]]);
    if (g.type === "MultiPolygon") return g.coordinates[0][0].map((p) => [p[0], p[1]]);
  } catch { return null; }
  return null;
}

function bboxDiagonalM(flights) {
  if (flights.length < 2) return 0;
  const lngs = flights.map((f) => f.lng);
  const lats = flights.map((f) => f.lat);
  const dLng = (Math.max(...lngs) - Math.min(...lngs)) * R * Math.cos((Math.min(...lats) * Math.PI) / 180);
  const dLat = (Math.max(...lats) - Math.min(...lats)) * R;
  return Math.sqrt(dLng * dLng + dLat * dLat);
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const client = new Client({
    connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT,
    ssl: (process.env.DATABASE_SSL || "false") === "true" ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  await client.query("SET statement_timeout = '15min'");

  console.log("[preview] cargando vuelos...");
  const flightsRes = await client.query(`
    SELECT flight_id::text AS id, lng::float8 AS lng, lat::float8 AS lat,
           drone_nickname, pilot_name, start_at, parcel_id,
           COALESCE(area_m2,0)::float8 AS area_m2, COALESCE(spray_usage_ml,0)::int AS spray_ml
      FROM dji_flights
     WHERE lng IS NOT NULL AND lat IS NOT NULL`);
  const flights = flightsRes.rows;
  const flightById = new Map(flights.map((f) => [String(f.id), f]));
  console.log(`  ${flights.length} vuelos`);

  console.log("[preview] cargando fumigaciones + hulls...");
  const fums = (await client.query(`
    SELECT f.id::text AS id, f.parcel_id, f.needs_parcel_assignment, f.session_key,
           f.flight_ids, h.hull AS hull
      FROM dji_fumigations f
      LEFT JOIN (SELECT fumigation_id, ST_AsGeoJSON(geom)::json AS hull FROM mv_fumigation_hulls) h
        ON h.fumigation_id = f.id
     WHERE f.deleted_at IS NULL AND f.source = 'import' AND f.session_key IS NOT NULL`)).rows;
  console.log(`  ${fums.length} fumigaciones`);

  console.log("[preview] parcelas dji (contornos)...");
  const parcels = (await client.query(`
    SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(spray_geom, 0.00004))::json AS geom
      FROM dji_parcels
     WHERE deleted_at IS NULL AND source = 'dji' AND spray_geom IS NOT NULL`)).rows;
  console.log(`  ${parcels.length} parcelas`);
  await client.end();

  // --- hulls actuales (por fumigacion, desde flight_ids) ---
  const current = fums.map((f) => {
    const ids = f.flight_ids || [];
    const fl = ids.map((id) => flightById.get(String(id))).filter(Boolean);
    const pts = fl.map((x) => [x.lng, x.lat]);
    // Hull "actual" = el que dibuja el geovisor (mv_fumigation_hulls, con
    // ST_ConvexHull). Fallback a convex hull en JS si la MV no lo trae.
    const dbHull = geoJsonToPoints(f.hull);
    return {
      id: String(f.id),
      orphan: !!f.needs_parcel_assignment,
      parcel_id: f.parcel_id,
      n: pts.length,
      diag: Math.round(bboxDiagonalM(fl)),
      hull: dbHull ?? (pts.length >= 3 ? convexHull(pts) : null),
      pts,
      flightIds: ids,
    };
  });

  // --- alternativa ESPACIAL: clusterizar los vuelos huerfanos por proximidad ---
  const orphanFlightIds = new Set();
  for (const f of fums) if (f.needs_parcel_assignment) (f.flight_ids || []).forEach((id) => orphanFlightIds.add(String(id)));
  const orphanFlights = flights
    .filter((f) => orphanFlightIds.has(String(f.id)))
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
  const gapMs = args.gap * 60 * 1000;
  const spatialGroups = [];
  let cur = null;
  for (const f of orphanFlights) {
    const day = dayBogota(f.start_at);
    let isNew = true;
    if (cur && cur.day === day) {
      const gapOk = new Date(f.start_at).getTime() - new Date(cur.lastEnd).getTime() <= gapMs;
      const near = cur.pts.some((p) => distM(p[0], p[1], f.lng, f.lat) <= args.eps);
      if (gapOk && near) isNew = false;
    }
    if (isNew) {
      cur = { day, lastEnd: f.start_at, pts: [[f.lng, f.lat]], flights: [f] };
      spatialGroups.push(cur);
    } else {
      cur.pts.push([f.lng, f.lat]);
      cur.flights.push(f);
      cur.lastEnd = f.start_at;
    }
  }
  const spatialHulls = spatialGroups.map((g) => ({
    n: g.flights.length,
    diag: Math.round(bboxDiagonalM(g.flights)),
    hull: convexHull(g.pts),
  }));

  // Cobertura APROXIMADA (proxy del buffer de tracks): linea por los puntos
  // ordenados por tiempo, por grupo. Matched = fumigacion actual; huerfanos =
  // cluster espacial. Se dibuja con stroke ancho en el HTML.
  const coverageLines = [];
  for (const g of current) {
    if (g.orphan) continue;
    const fl = (g.flightIds || []).map((id) => flightById.get(String(id))).filter(Boolean)
      .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    if (fl.length >= 2) coverageLines.push(fl.map((x) => [x.lng, x.lat]));
  }
  for (const g of spatialGroups) {
    const fl = [...g.flights].sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    if (fl.length >= 2) coverageLines.push(fl.map((x) => [x.lng, x.lat]));
  }
  console.log(`[preview] actual: ${current.length} grupos | espacial(${args.eps}m,${args.gap}min): ${spatialGroups.length} grupos huerfanos`);

  // top peores actuales (mayor dispersion, >=2 vuelos)
  const worst = current
    .filter((g) => g.n >= 2)
    .sort((a, b) => b.diag - a.diag)
    .slice(0, 25)
    .map((g) => ({ id: g.id, n: g.n, diag_m: g.diag, orphan: g.orphan ? "si" : "" }));

  const data = {
    flights: flights.map((f) => [f.lng, f.lat, f.drone_nickname || "", f.parcel_id ? 1 : 0]),
    currentHulls: current.filter((g) => g.hull && g.hull.length >= 3).map((g) => ({ h: g.hull, orphan: g.orphan, diag: g.diag, n: g.n })),
    spatialHulls: spatialHulls.filter((g) => g.hull && g.hull.length >= 3).map((g) => ({ h: g.hull, diag: g.diag, n: g.n })),
    coverageLines,
    parcels: parcels.map((p) => p.geom),
    worst,
    stats: {
      totalFlights: flights.length,
      currentGroups: current.length,
      currentOrphanGroups: current.filter((g) => g.orphan).length,
      currentOrphanMaxDiag: Math.max(0, ...current.filter((g) => g.orphan).map((g) => g.diag)),
      spatialGroups: spatialGroups.length,
      spatialMaxDiag: Math.max(0, ...spatialHulls.map((g) => g.diag)),
      eps: args.eps,
      gap: args.gap,
    },
  };

  const html = buildHtml(data);
  fs.writeFileSync(args.out, html, "utf8");
  console.log(`[preview] OK -> ${path.resolve(args.out)}`);
  console.log(`  peor grupo actual huérfano: ${data.stats.currentOrphanMaxDiag} m de diagonal`);
  console.log(`  peor grupo espacial:        ${data.stats.spatialMaxDiag} m`);
}

function buildHtml(d) {
  const payload = JSON.stringify(d);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Preview agrupación de fumigaciones</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
 body{margin:0;font:13px system-ui;background:#111;color:#eee}
 #map{position:absolute;inset:0 320px 0 0}
 #side{position:absolute;top:0;right:0;bottom:0;width:320px;overflow:auto;background:#1b1b1b;border-left:1px solid #333;padding:10px;box-sizing:border-box}
 h1{font-size:14px;margin:0 0 8px}
 .box{background:#242424;border:1px solid #333;border-radius:6px;padding:8px;margin-bottom:8px}
 .box label{display:flex;gap:6px;align-items:center;margin:3px 0;cursor:pointer}
 .k{color:#9ae6b4;font-weight:700}
 table{width:100%;border-collapse:collapse;font-size:11px}
 td,th{border-bottom:1px solid #333;padding:2px 4px;text-align:right}
 th:first-child,td:first-child{text-align:left}
 .sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}
</style></head><body>
<div id="map"></div>
<div id="side">
  <h1>Fumigaciones — comparar agrupación</h1>
  <div class="box">
    Vuelos: <span class="k">${d.stats.totalFlights}</span><br/>
    Grupos actuales: <span class="k">${d.stats.currentGroups}</span> (huérfanos ${d.stats.currentOrphanGroups})<br/>
    Peor diagonal actual: <span class="k">${d.stats.currentOrphanMaxDiag} m</span><br/>
    Grupos espaciales: <span class="k">${d.stats.spatialGroups}</span> · eps ${d.stats.eps} m · gap ${d.stats.gap} min<br/>
    Peor diagonal espacial: <span class="k">${d.stats.spatialMaxDiag} m</span>
  </div>
  <div class="box">
    <label><input type="checkbox" id="cFlights"/> Vuelos (puntos)</label>
    <label><input type="checkbox" id="cParcels"/> Parcelas DJI</label>
    <label><input type="checkbox" id="cCurrent" checked/><span class="sw" style="background:#a855f7"></span> Hulls ACTUALES</label>
    <label><input type="checkbox" id="cSpatial" checked/><span class="sw" style="background:#22d3ee"></span> Hulls ALTERNATIVA espacial</label>
    <label><input type="checkbox" id="cCov" checked/><span class="sw" style="background:#fb923c"></span> Cobertura aprox (líneas)</label>
    <label><input type="checkbox" id="cWorst"/> Resaltar peores ACTUALES</label>
  </div>
  <div class="box">
    <b>Top grupos ACTUALES más estirados</b>
    <table id="tbl"><tr><th>id</th><th>vuelos</th><th>diag m</th><th>huérf</th></tr></table>
  </div>
  <div class="box" style="color:#aaa">Click en una fila para centrar en ese grupo.</div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const D=${payload};
const map=L.map('map').setView([3.5,-76.3],10);
L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',{maxZoom:16,attribution:'EOX Sentinel-2'}).addTo(map);
function poly(h,color,weight,fill){return L.polygon(h.map(p=>[p[1],p[0]]),{color,weight,fillColor:color,fillOpacity:fill??0.25});}
const gFlights=L.layerGroup();
D.flights.forEach(f=>L.circleMarker([f[1],f[0]],{radius:2,color:f[3]?'#f59e0b':'#a855f7',weight:1,fillOpacity:0.8}).addTo(gFlights));
const gParcels=L.layerGroup();
D.parcels.forEach(geom=>{try{const g=L.geoJSON(geom,{style:{color:'#fde047',weight:1,fill:false}});g.addTo(gParcels);}catch(e){}});
const gCurrent=L.layerGroup();
D.currentHulls.forEach(h=>poly(h.h,'#a855f7',1.5,h.orphan?0.22:0.18).bindPopup('actual · n='+h.n+' · diag '+h.diag+'m'+(h.orphan?' · huérfano':'')).addTo(gCurrent));
const gSpatial=L.layerGroup();
D.spatialHulls.forEach(h=>poly(h.h,'#22d3ee',1.5,0.22).bindPopup('espacial · n='+h.n+' · diag '+h.diag+'m').addTo(gSpatial));
const gCov=L.layerGroup();
D.coverageLines.forEach(line=>L.polyline(line.map(p=>[p[1],p[0]]),{color:'#fb923c',weight:9,opacity:0.45}).addTo(gCov));
const gWorst=L.layerGroup();
D.currentHulls.filter(h=>h.orphan).forEach(h=>{ if(h.diag>500) poly(h.h,'#ef4444',3,0.35).addTo(gWorst); });
function on(id,l){ document.getElementById(id).checked?map.addLayer(l):map.removeLayer(l); }
['cFlights','cParcels','cCurrent','cSpatial','cCov','cWorst'].forEach(id=>document.getElementById(id).addEventListener('change',()=>{
  on('cFlights',gFlights);on('cParcels',gParcels);on('cCurrent',gCurrent);on('cSpatial',gSpatial);on('cCov',gCov);on('cWorst',gWorst);
}));
on('cCurrent',gCurrent);on('cSpatial',gSpatial);on('cCov',gCov);
const tbl=document.getElementById('tbl');
const byId={}; D.currentHulls.forEach(h=>byId[h.h[0].join(',')]=h);
D.worst.forEach(w=>{const tr=document.createElement('tr');
 tr.innerHTML='<td>'+w.id+'</td><td>'+w.n+'</td><td>'+w.diag_m+'</td><td>'+w.orphan+'</td>';
 tbl.appendChild(tr);});
</script></body></html>`;
}

main().catch((e) => { console.error("[preview] ERROR:", e.message); process.exit(1); });
