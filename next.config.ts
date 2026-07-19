import type { NextConfig } from "next";

/**
 * Headers de seguridad básicos para el panel admin.
 *
 * Decisiones:
 *   - CSP permisivo (no usamos fuentes/scripts de terceros más allá de Google Fonts).
 *     Si en el futuro agregamos un CDN o un script externo, ajustar `script-src` y `connect-src`.
 *   - HSTS condicional (`max-age=31536000; includeSubDomains`) — no `preload` todavía hasta
 *     confirmar que TODOS los subdominios sirven HTTPS.
 *   - Sin `X-Frame-Options: DENY` porque `/map` podría embeberse en el futuro en otro panel.
 *     Usamos `SAMEORIGIN` como balance.
 *   - `Referrer-Policy: strict-origin-when-cross-origin` — estándar moderno, suficiente
 *     para analytics internos sin filtrar paths completos a terceros.
 *
 * Próxima iteración: añadir CSP estricta y `Permissions-Policy` cuando tengamos
 * auth (S3) — hoy bloquea poco porque no hay login, pero el header sienta la base.
 */
const securityHeaders = [
  {
    key: "X-DNS-Prefetch-Control",
    value: "on"
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains"
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff"
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN"
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin"
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()"
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
