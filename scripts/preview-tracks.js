#!/usr/bin/env node
// scripts/preview-tracks.js
//
// Genera un HTML autocontenido para REVISAR los tracks KML
// (djiag_exports/tracks.geojson) sobre satelite, antes de importarlos a
// prod. Simplifica cada LineString (Douglas-Peucker) para que el HTML
// pese poco, y colorea por mes o por dron. Incluye stats por mes.
//
// Uso:
//   node scripts/preview-tracks.js [--in djiag_exports/tracks.geojson] [--tol 0.00004]

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const a = { inPath: "djiag_exports/tracks.geojson", tol: 0.00004, out: "tmp-tracks-preview.html" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in" && argv[i + 1]) a.inPath = argv[++i];
    else if (argv[i] === "--tol" && argv[i + 1]) a.tol = Number(argv[++i]);
    else if (argv[i] === "--out" && argv[i + 1]) a.out = argv[++i];
  }
  return a;
}

// Douglas-Peucker sobre [[lng,lat],...]
function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const sqTol = tol * tol;
  const sqSegDist = (p, a, b) => {
    let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p[0] - x; dy = p[1] - y;
    return dx * dx + dy * dy;
  };
  const simplifyStep = (first, last, out) => {
    let maxSq = sqTol, idx = 0;
    for (let i = first + 1; i < last; i++) {
      const sq = sqSegDist(pts[i], pts[first], pts[last]);
      if (sq > maxSq) { idx = i; maxSq = sq; }
    }
    if (idx > 0) {
      if (idx - first > 1) simplifyStep(first, idx, out);
      out.push(pts[idx]);
      if (last - idx > 1) simplifyStep(idx, last, out);
    }
  };
  const out = [pts[0]];
  simplifyStep(0, pts.length - 1, out);
  out.push(pts[pts.length - 1]);
  return out;
}

function bogotaDay(epochSec) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(epochSec * 1000));
  const g = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(fs.readFileSync(args.inPath, "utf8"));
  const feats = raw.features || [];
  console.log(`[tracks-preview] ${feats.length} features · tol ${args.tol}`);

  const palette = ["#22d3ee", "#f59e0b", "#a855f7", "#22c55e", "#ef4444", "#eab308", "#3b82f6", "#ec4899", "#14b8a6", "#f97316", "#8b5cf6", "#84cc16"];
  const byMonth = new Map();
  const lines = [];
  let totalPts = 0;
  for (const f of feats) {
    const g = f.geometry;
    if (!g || g.type !== "LineString") continue;
    const pts = simplify(g.coordinates.map((c) => [c[0], c[1]]), args.tol);
    const p = f.properties || {};
    const ts = p.start_timestamp;
    const month = ts ? bogotaDay(ts).slice(0, 7) : "?";
    lines.push([pts, p.flight_id ?? p.id ?? 0, month, p.drone ?? "", p.team ?? "", p.area_m2 ?? 0, p.spray_usage ?? 0]);
    totalPts += pts.length;
    const m = byMonth.get(month) || { month, n: 0, area: 0, spray: 0 };
    m.n += 1; m.area += Number(p.area_m2 || 0); m.spray += Number(p.spray_usage || 0);
    byMonth.set(month, m);
  }
  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  const monthColors = {};
  months.forEach((m, i) => { monthColors[m.month] = palette[i % palette.length]; });
  const drones = [...new Set(lines.map((l) => l[3]).filter(Boolean))].sort();

  const data = {
    lines,
    months: months.map((m) => ({ ...m, color: monthColors[m.month] })),
    monthColors,
    drones,
    totalPts,
    tol: args.tol,
  };
  const html = buildHtml(data);
  fs.writeFileSync(args.out, html, "utf8");
  console.log(`[tracks-preview] OK -> ${path.resolve(args.out)} (${(html.length / 1048576).toFixed(1)} MB, ${totalPts} puntos simplificados)`);
  console.log(`  meses: ${months.map((m) => `${m.month}:${m.n}`).join("  ")}`);
}

function buildHtml(d) {
  const payload = JSON.stringify(d);
  const monthRows = d.months
    .map((m) => `<tr><td><span class="sw" style="background:${m.color}"></span>${m.month}</td><td>${m.n}</td><td>${(m.area / 10000).toFixed(1)}</td><td>${(m.spray / 1000).toFixed(0)}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Tracks KML — revisión</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
 body{margin:0;font:13px system-ui;background:#111;color:#eee}
 #map{position:absolute;inset:0 330px 0 0}
 #side{position:absolute;top:0;right:0;bottom:0;width:330px;overflow:auto;background:#1b1b1b;border-left:1px solid #333;padding:10px;box-sizing:border-box}
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
  <h1>Tracks KML — revisión</h1>
  <div class="box">
    Vuelos: <span class="k">${d.lines.length}</span> · puntos simplificados: <span class="k">${d.totalPts}</span><br/>
    Tolerancia simplif.: ${d.tol}°
  </div>
  <div class="box">
    <label><input type="checkbox" id="cRaw"/> Tracks crudos (línea fina)</label>
    <label><input type="checkbox" id="cCov" checked/> Cobertura aprox (trazo ancho)</label>
    <label><input type="checkbox" id="cByMonth" checked/> Colorear por mes</label>
    <div style="margin-top:6px">Mes: <select id="fMonth"><option value="">(todos)</option>
      ${d.months.map((m) => `<option value="${m.month}">${m.month}</option>`).join("")}
    </select></div>
    <div>Dron: <select id="fDrone"><option value="">(todos)</option>
      ${d.drones.map((x) => `<option value="${x}">${x}</option>`).join("")}
    </select></div>
  </div>
  <div class="box">
    <b>Por mes</b>
    <table><tr><th>mes</th><th>vuelos</th><th>ha</th><th>L</th></tr>${monthRows}</table>
  </div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const D=${payload};
const map=L.map('map',{preferCanvas:true}).setView([3.6,-76.3],10);
L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',{maxZoom:16,attribution:'EOX Sentinel-2'}).addTo(map);
const cov=L.layerGroup().addTo(map), raw=L.layerGroup();
const monthColor=D.monthColors;
function draw(){
  cov.clearLayers(); raw.clearLayers();
  const fm=document.getElementById('fMonth').value;
  const fd=document.getElementById('fDrone').value;
  const byMonth=document.getElementById('cByMonth').checked;
  const showCov=document.getElementById('cCov').checked;
  const showRaw=document.getElementById('cRaw').checked;
  for(const [pts,id,month,drone,team,area,spray] of D.lines){
    if(fm && month!==fm) continue;
    if(fd && drone!==fd) continue;
    const col=byMonth?(monthColor[month]||'#22d3ee'):'#22d3ee';
    const ll=pts.map(p=>[p[1],p[0]]);
    if(showCov) cov.addLayer(L.polyline(ll,{color:'#06b6d4',weight:5,opacity:0.35}));
    if(showRaw){const pl=L.polyline(ll,{color:col,weight:1.4,opacity:0.9});
      pl.bindPopup('<b>vuelo '+id+'</b><br/>'+month+' · '+drone+'<br/>'+team+'<br/>area '+(area/10000).toFixed(2)+' ha · '+(spray/1000).toFixed(1)+' L');
      raw.addLayer(pl);}
  }
}
['cRaw','cCov','cByMonth'].forEach(x=>document.getElementById(x).addEventListener('change',draw));
['fMonth','fDrone'].forEach(x=>document.getElementById(x).addEventListener('change',draw));
document.getElementById('cRaw').checked=true;
draw(); raw.addTo(map);
</script></body></html>`;
}

main();
