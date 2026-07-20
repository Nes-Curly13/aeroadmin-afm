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
      "img-src 'self' data: https://*.tile.openstreetmap.org https://server.arcgisonline.com https://unpkg.com",
      "connect-src 'self'",
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
