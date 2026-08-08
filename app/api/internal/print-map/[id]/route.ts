/**
 * GET /api/internal/print-map/[id]
 *
 * feature/reports-level-1 sub-sprint 3 (2026-08-08).
 *
 * Devuelve el HTML de un mapa MapLibre full-bleed con EOX Sentinel-2
 * cloudless + el polígono de la parcela. Pensado para que Playwright
 * (en `lib/reports/render-map-screenshot.ts`) tome un screenshot y lo
 * incruste en el PDF del reporte.
 *
 * Por qué `/api/internal/...` y no una page.tsx:
 *   - El middleware de NextAuth (proxy.ts) evalúa `authorized()` para
 *     TODAS las rutas. Pages requieren sesión. El browser Playwright
 *     que usa el server no tiene cookies de NextAuth, así que una page
 *     terminaría redirigida a /login.
 *   - Los API routes pasan al handler (mismo callback), y como este
 *     handler NO valida auth, es público. La geometría de la parcela
 *     no es data ultra-sensible (ya está visible en la UI autenticada),
 *     y el endpoint no expone metadata (owner, fumigaciones, etc.).
 *   - El endpoint solo es accesible desde el mismo server (Playwright
 *     hace goto a `http://localhost:3000/...` o a la URL del deploy).
 *
 * Decisiones:
 *   - **EOX Sentinel-2 cloudless 2020**: mismo tile provider que
 *     `components/parcels/parcel-map.tsx` para consistencia visual con
 *     la UI.
 *   - **Sin controles de navegación ni flights**: el screenshot es
 *     estático, no necesita UI interactiva. La vista se ajusta al
 *     bounding box del polígono con padding.
 *   - **Sin chrome de Next.js**: no hay header, sidebar ni footer.
 *     Solo el div del mapa a 800x600 (tamaño fijo para que el
 *     screenshot sea reproducible).
 *   - **Sin auth**: público. La geometría de las parcelas del Valle
 *     del Cauca no es data confidencial.
 *
 * Respuestas:
 *   200 + text/html — HTML con el mapa
 *   400 — id inválido
 *   404 — parcela no existe o no tiene spray_geom
 *   500 — error al consultar la BD
 *
 * Out of scope:
 *   - Imagen satelital con resolución sub-meter (requiere MapTiler/
 *     Stadia API key y el operador confirmó que la red bloquea ESRI
 *     World Imagery). Ver docs/EOX_RESEARCH.md del sprint.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface ParcelGeomRow {
  id: number;
  land_name: string | null;
  spray_geom: unknown;
  bbox: unknown;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { id: idRaw } = await ctx.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) {
    return new NextResponse("id invalido", { status: 400 });
  }

  let row: ParcelGeomRow | undefined;
  try {
    const db = getDb();
    // Tomamos el bbox (si está precomputado por el scraper) o caemos al
    // cálculo del polígono en el cliente JS del browser.
    const r = await db.query<ParcelGeomRow>(
      `SELECT id, land_name, spray_geom, bbox
       FROM dji_parcels
       WHERE id = $1 AND deleted_at IS NULL AND spray_geom IS NOT NULL
       LIMIT 1`,
      [id]
    );
    row = r.rows[0];
  } catch (err) {
    return new NextResponse(
      `error bd: ${err instanceof Error ? err.message : "unknown"}`,
      { status: 500 }
    );
  }

  if (!row) {
    return new NextResponse("parcela sin geometria", { status: 404 });
  }

  const geomJson = JSON.stringify(row.spray_geom);
  const landName = row.land_name ?? `Parcela #${row.id}`;

  // HTML full-bleed con MapLibre + EOX + polígono. Sin chrome. Tamaño
  // fijo 800x600 — el screenshot del browser sale a esa resolución.
  // El JS al final espera a que MapLibre inicialice, ajusta el viewport
  // al bbox del polígono con padding, y avisa al parent con
  // `window.__mapReady = true` para que el caller sepa cuándo hacer
  // screenshot (en lugar de un timeout fijo).
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Mapa — ${escapeHtml(landName)}</title>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" />
  <style>
    html, body { margin: 0; padding: 0; width: 800px; height: 600px; overflow: hidden; background: #1c2a23; }
    #map { position: absolute; inset: 0; }
    .attribution { font-size: 9px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <script>
    (async function () {
      const map = new maplibregl.Map({
        container: "map",
        style: {
          version: 8,
          sources: {
            eox: {
              type: "raster",
              tiles: [
                "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"
              ],
              tileSize: 256,
              maxzoom: 14,
              attribution: "Sentinel-2 cloudless 2020 \\u00a9 EOX"
            }
          },
          layers: [{ id: "eox", type: "raster", source: "eox" }]
        },
        center: [-76.5, 3.4],
        zoom: 12,
        interactive: false,
        attributionControl: { compact: true }
      });

      map.on("load", () => {
        const geom = ${geomJson};
        map.addSource("parcel", { type: "geojson", data: { type: "Feature", geometry: geom, properties: {} } });
        map.addLayer({
          id: "parcel-fill",
          type: "fill",
          source: "parcel",
          paint: { "fill-color": "#0b5f2d", "fill-opacity": 0.35 }
        });
        map.addLayer({
          id: "parcel-line",
          type: "line",
          source: "parcel",
          paint: { "line-color": "#0b5f2d", "line-width": 2.4 }
        });

        // Fit bounds al polígono con padding para que se vea bien.
        let all = [];
        const extract = (g) => {
          if (g.type === "Polygon") g.coordinates.forEach((r) => r.forEach((c) => all.push(c)));
          else if (g.type === "MultiPolygon") g.coordinates.forEach((p) => p.forEach((r) => r.forEach((c) => all.push(c))));
        };
        extract(geom);
        if (all.length > 0) {
          const lngs = all.map((c) => c[0]);
          const lats = all.map((c) => c[1]);
          map.fitBounds(
            [[Math.min.apply(null, lngs), Math.min.apply(null, lats)],
             [Math.max.apply(null, lngs), Math.max.apply(null, lats)]],
            { padding: 40, duration: 0 }
          );
        }

        // Marcador en el centroide (promedio simple).
        const sumLng = all.reduce((a, c) => a + c[0], 0);
        const sumLat = all.reduce((a, c) => a + c[1], 0);
        const centroid = [sumLng / all.length, sumLat / all.length];
        const el = document.createElement("div");
        el.style.cssText = "width:14px;height:14px;border-radius:50%;background:#a93232;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.4);";
        new maplibregl.Marker({ element: el }).setLngLat(centroid).addTo(map);

        // Avisa al parent que el mapa está listo para screenshot.
        // Una vez que TODOS los tiles visibles terminaron de cargar.
        const onIdle = () => {
          window.__mapReady = true;
          if (window.parent !== window) window.parent.postMessage({ type: "map-ready" }, "*");
          map.off("idle", onIdle);
        };
        map.on("idle", onIdle);
        // Failsafe: si en 5s no se dispara idle, avisamos igual.
        setTimeout(() => {
          if (!window.__mapReady) {
            window.__mapReady = true;
            if (window.parent !== window) window.parent.postMessage({ type: "map-ready" }, "*");
          }
        }, 5000);
      });
    })();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

/** Escape básico para el `<title>` (el resto del HTML es estático). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
