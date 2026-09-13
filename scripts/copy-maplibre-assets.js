// scripts/copy-maplibre-assets.js
//
// Copia los assets de MapLibre (JS + CSS) desde node_modules a
// `public/maplibre/` para que el HTML de `/api/internal/print-map/[id]`
// los sirva same-origin.
//
// Auditoría 2026-09-10 (#46): el HTML de print-map cargaba MapLibre desde
// `https://unpkg.com`, pero la CSP catch-all (`script-src 'self' ...`)
// bloqueaba el script → MapLibre no inicializaba → el screenshot del mapa
// fallaba en silencio y el PDF caía al SVG. Servir los assets same-origin
// respeta la CSP sin relajarla.
//
// Se corre en `predev` y `prebuild`. `public/maplibre/` está gitignored
// (es un artefacto derivado de node_modules).

const fs = require("node:fs");
const path = require("node:path");

const distDir = path.dirname(require.resolve("maplibre-gl"));
const outDir = path.join(__dirname, "..", "public", "maplibre");

const FILES = ["maplibre-gl.js", "maplibre-gl.css"];

fs.mkdirSync(outDir, { recursive: true });

for (const file of FILES) {
  const src = path.join(distDir, file);
  const dest = path.join(outDir, file);
  if (!fs.existsSync(src)) {
    console.error(`[copy-maplibre] falta ${src} — ¿maplibre-gl instalado?`);
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
}

console.log(`[copy-maplibre] copiados ${FILES.length} assets a public/maplibre/`);
