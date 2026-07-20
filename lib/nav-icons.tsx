/**
 * nav-icons.ts
 *
 * Track B (mobile) v1.2 — iconos compartidos del sidebar.
 *
 * Antes vivían inline en `components/app-shell.tsx`. Para soportar el
 * `MobileSidebarDrawer` sin duplicar el mapa, lo movimos a `lib/`.
 * Single source of truth para los paths SVG de los items de navegación.
 *
 * Convenciones:
 *   - Mismo set de iconos que usaba el sidebar desktop.
 *   - El componente `NavIcon` se renderiza server-side (no usa hooks),
 *     lo que permite importarlo desde Server Components también.
 *
 * No agregar dependencias: el SVG es inline y el currentColor se
 * resuelve por CSS (text-* classes de Tailwind).
 */

const NAV_ICON_PATHS: Record<string, string> = {
  dashboard: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
  map: "M1 6v16l7-3 8 3 7-3V3l-7 3-8-3-7 3zm7-2.5L16 6.5l6-2.5v12.5l-6 2.5-8-2.5V3.5z",
  history:
    "M13 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7V1l4 4-4 4V6a6 6 0 1 0 6 6h2a9 9 0 0 0-9-9zm-1 5v5l4 2 .7-1.2-3.2-1.6V8H12z",
  // parcels: grilla 2x2 de parcelas — la unidad mínima del producto.
  parcels: "M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z",
  // faltan: reloj con punto de alerta — la cadencia vencida.
  faltan:
    "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm.5-13H11v6l5 3 .8-1.3-4.3-2.6V7z",
  devices: "M4 6h18V4H4v2zm0 4h18V8H4v2zm0 4h14v-2H4v2zm0 4h14v-2H4v2zM20 14v8h2v-8h-2z"
};

export function getNavIconPath(icon: string): string {
  return NAV_ICON_PATHS[icon] ?? NAV_ICON_PATHS.dashboard;
}

export function NavIcon({ icon }: { icon: string }) {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
      <path d={getNavIconPath(icon)} />
    </svg>
  );
}
