import type { NextConfig } from "next";

/**
 * Headers de seguridad para el panel admin.
 *
 * Decisiones (sprint Q4 / track C, 2026-07-20):
 *   - CSP explícita con `default-src 'self'`: defense in depth. La app no
 *     carga scripts externos más allá de lo que el navegador recibe en
 *     el bundle (Next.js). `'unsafe-inline'` y `'unsafe-eval'` siguen
 *     permitidos en `script-src` porque Next.js los necesita para
 *     hydration + dev HMR; endurecer esto requiere nonces por request
 *     (out of scope de esta mejora).
 *   - HSTS con `preload` (max-age=1 año, includeSubDomains): el repo se
 *     sirve siempre detrás de HTTPS en prod (Vercel). El comentario
 *     previo era conservador — ya verificamos que el dominio no tiene
 *     subdominios HTTP.
 *   - `X-Frame-Options: DENY`: la app nunca se embebe en otro panel.
 *     Refuerza `frame-ancestors 'none'` de la CSP.
 *   - `Permissions-Policy`: la app no usa geolocalización del usuario
 *     (Leaflet solo muestra parcelas, no la posición del operador), ni
 *     cámara ni micrófono. Se bloquean los tres.
 *
 * Próxima iteración (no en este commit): nonces en `script-src` para
 * eliminar 'unsafe-inline', y separar CSP para /api (más estricta) vs
 * /app (necesita Google Fonts).
 */
const securityHeaders = [
  {
    key: "X-DNS-Prefetch-Control",
    value: "on"
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload"
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff"
  },
  {
    key: "X-Frame-Options",
    value: "DENY"
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin"
  },
  {
    key: "Permissions-Policy",
    value: "geolocation=(), camera=(), microphone=()"
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://*.tile.openstreetmap.org https://server.arcgisonline.com https://tiles.maps.eox.at https://api.maptiler.com https://unpkg.com",
      // v2.5.2 (S8.5): MapLibre usa fetch() (no <img>) para cargar tiles,
      // asi que 'img-src' no alcanza. Hay que permitir los dominios de
      // tiles en 'connect-src' tambien. Si no, el browser loguea
      // "Refused to connect because it violates the document's Content
      // Security Policy" y los tiles no cargan (canvas queda vacio).
      // v2.6 (S8.7): anadido api.maptiler.com para MapTiler Satellite Hybrid
      // (30cm res, con labels). Key via NEXT_PUBLIC_MAPTILER_KEY.
      "connect-src 'self' https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://tiles.maps.eox.at https://server.arcgisonline.com https://demotiles.maplibre.org https://mt1.google.com https://api.maptiler.com",
      // v2.5.4 (S8.6): MapLibre 6.0+ usa un Web Worker (maplibre-gl-worker.mjs)
      // para procesar GeoJSON sources (geojson-vt). Sin worker-src/blob:,
      // el worker no carga, _data tiene los features pero querySourceFeatures
      // devuelve 0 (los poligonos no se renderizan). Sintoma: mapa muestra
      // el basemap satelital pero no las 1213 parcelas.
      "worker-src 'self' blob:",
      "child-src 'self' blob:",
      "frame-ancestors 'none'"
    ].join("; ")
  }
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders
      }
    ];
  },
  // Q1 (2026-07-19, audit §4.2): el sidebar item "HISTORIAL" apunta a
  // /task-history (Figma B) pero /history (legacy) seguía accesible
  // → doble entry point confuso. Redirect permanente para que cualquier
  // URL externa (bookmarks, links viejos, scrapers) aterrice en la
  // vista canónica sin perder SEO del histórico.
  async redirects() {
    return [
      {
        source: "/history",
        destination: "/task-history",
        permanent: true
      }
    ];
  }
};

export default nextConfig;
