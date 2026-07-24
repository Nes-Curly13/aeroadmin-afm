// scripts/generate-icons.cjs
//
// Genera los iconos PNG del proyecto a partir de `app/icon.svg`:
//   - app/apple-icon.png          (180×180, cuadrado, fondo blanco)
//   - app/opengraph-image.png     (1200×630, fondo verde cañero con logo)
//
// Usa `sharp` (viene con Next.js, no agrega deps). Para el
// opengraph, primero genera el logo como PNG, lo tinta a blanco
// con sharp, después lo compone con el fondo verde + texto.
//
// Uso:
//   node scripts/generate-icons.cjs
//
// Output (sobrescribe sin confirmación):
//   - app/apple-icon.png
//   - app/opengraph-image.png

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const SVG_PATH = path.join(ROOT, "app", "icon.svg");
const APPLE_ICON_PATH = path.join(ROOT, "app", "apple-icon.png");
const OPENGRAPH_PATH = path.join(ROOT, "app", "opengraph-image.png");
const LOGO_TMP = path.join(ROOT, "scripts", ".logo-white.png");

// Colores oficiales del logo AeroAdmin AFM (de afm_png.svg).
// Verde cañero es el primario (la caña que fumigan los drones DJI).
const COLOR_VERDE_CANIERO = "#3f8f5d";
const COLOR_VERDE_CLARO = "#56b171";
const COLOR_AMARILLO = "#f5e839";
const COLOR_FONDO_CLARO = "#fdfeff";

function readSvg() {
  return fs.readFileSync(SVG_PATH, "utf8");
}

/**
 * El SVG original trae un rect blanco de fondo
 * (`<rect x="0" y="0" width="485" height="695" fill="#fdfeff"/>`) y el
 * path principal también arranca con `fill="#fdfeff"`. Para el OG
 * image queremos el logo transparente sobre el fondo verde, así que
 * removemos ambos. Para el apple icon SÍ queremos el fondo blanco
 * (que se logra con `background: COLOR_FONDO_CLARO` en sharp).
 */
function stripWhiteBackground(svg) {
  return svg
    .replace(/<rect[^>]*fill="#fdfeff"[^>]*\/>/g, "") // primer rect blanco
    .replace(/fill="#fdfeff"/g, 'fill="none"'); // cualquier path con fill blanco
}

/**
 * Apple icon 180×180. El SVG original es 485×695 (vertical).
 * Lo centramos en un canvas cuadrado 180×180 con fondo blanco.
 * `fit: "contain"` preserva el aspect ratio (no estira).
 */
async function generateAppleIcon(svg) {
  await sharp(Buffer.from(svg))
    .resize(180, 180, {
      fit: "contain",
      background: COLOR_FONDO_CLARO
    })
    .png()
    .toFile(APPLE_ICON_PATH);
  const bytes = fs.statSync(APPLE_ICON_PATH).size;
  console.log(`[icons] OK apple-icon.png  (180×180, ${bytes} bytes)`);
}

/**
 * OpenGraph 1200×630 (ratio 1.9:1, estándar FB/Twitter/LinkedIn).
 * Fondo con gradiente verde cañero + logo AFM blanco al centro-izquierda
 * + texto + acento amarillo.
 *
 * Estrategia (porque sharp + librsvg no soporta CSS overrides ni
 * filtros feFlood/feComposite para teñir SVG):
 *   1. Renderizar el logo a PNG con fondo transparente
 *   2. Aplicar `tint: "white"` a ese PNG (sharp.tint reemplaza RGB por
 *      blanco, preserva alpha)
 *   3. Componer el opengraph con el logo blanco + texto sobre el fondo
 *      verde como SVG puro (sharp lo rasteriza)
 */
async function generateOpengraph(svg) {
  // 1. Generar el logo en PNG transparente (sin fondo blanco, así
  //    se compone limpio sobre el verde del OG).
  const LOGO_HEIGHT = 360;
  const LOGO_WIDTH = Math.round(LOGO_HEIGHT * (485 / 695));
  const logoNoBg = stripWhiteBackground(svg);
  await sharp(Buffer.from(logoNoBg))
    .resize(LOGO_WIDTH, LOGO_HEIGHT, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(LOGO_TMP);

  // 2. Aplicar tinte blanco (preserva alpha).
  const whiteLogo = await sharp(LOGO_TMP).tint("white").png().toBuffer();
  // Guardar el logo blanco temporalmente para debug.
  fs.writeFileSync(LOGO_TMP, whiteLogo);
  console.log(`[icons] OK logo white PNG (${LOGO_WIDTH}×${LOGO_HEIGHT})`);

  // 3. Componer el opengraph como SVG puro, embebiendo el logo
  //    blanco como data URL. Sharp rasteriza todo en una sola pasada.
  const dataUrl = `data:image/png;base64,${whiteLogo.toString("base64")}`;
  const composed = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${COLOR_VERDE_CANIERO}"/>
      <stop offset="100%" stop-color="${COLOR_VERDE_CLARO}"/>
    </linearGradient>
  </defs>
  <!-- Fondo gradiente -->
  <rect width="1200" height="630" fill="url(#bg)"/>
  <!-- Acento superior derecho -->
  <text x="1120" y="70" font-family="-apple-system, Segoe UI, Roboto, sans-serif"
        font-size="20" font-weight="700" letter-spacing="2.5" text-anchor="end"
        fill="${COLOR_AMARILLO}">COLOMBIA · VALLE DEL CAUCA</text>
  <!-- Logo blanco al centro-izquierda -->
  <image href="${dataUrl}" x="100" y="135" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}"/>
  <!-- Texto principal -->
  <text x="${100 + LOGO_WIDTH + 60}" y="290" font-family="-apple-system, Segoe UI, Roboto, sans-serif"
        font-size="80" font-weight="800" letter-spacing="-1.5" fill="white">AeroAdmin</text>
  <text x="${100 + LOGO_WIDTH + 60}" y="370" font-family="-apple-system, Segoe UI, Roboto, sans-serif"
        font-size="30" font-weight="500" fill="white" opacity="0.94">
    <tspan x="${100 + LOGO_WIDTH + 60}" dy="0">Gestión operativa de fumigación</tspan>
    <tspan x="${100 + LOGO_WIDTH + 60}" dy="40">con drones DJI Agras</tspan>
  </text>
  <!-- Footer URL -->
  <text x="${100 + LOGO_WIDTH + 60}" y="500" font-family="-apple-system, Segoe UI, Roboto, sans-serif"
        font-size="20" font-weight="500" letter-spacing="0.5" fill="white" opacity="0.7">aeroadmin-afm.vercel.app</text>
</svg>`;

  await sharp(Buffer.from(composed))
    .png()
    .toFile(OPENGRAPH_PATH);

  const bytes = fs.statSync(OPENGRAPH_PATH).size;
  console.log(`[icons] OK opengraph-image.png (1200×630, ${bytes} bytes)`);

  // Cleanup del PNG temporal.
  if (fs.existsSync(LOGO_TMP)) fs.unlinkSync(LOGO_TMP);
}

async function main() {
  if (!fs.existsSync(SVG_PATH)) {
    throw new Error(`No se encontró el SVG en ${SVG_PATH}`);
  }
  const svg = readSvg();
  await generateAppleIcon(svg);
  await generateOpengraph(svg);
  console.log("[icons] DONE");
}

main().catch((err) => {
  console.error("[icons] ERROR:", err);
  process.exit(1);
});
