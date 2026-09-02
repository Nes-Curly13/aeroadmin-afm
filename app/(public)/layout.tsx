/**
 * app/(public)/layout.tsx
 *
 * S10.4 (2026-09-01) — layout mínimo para páginas públicas.
 *
 * Antes: `app/layout.tsx` (root) envolvía TODO con `<AppShell>{children}</AppShell>`,
 * así que `/login` mostraba el sidebar con "AFM Geovisor", nav links, y
 * "Cerrar sesión" — el operador veía el panel mientras intentaba loguearse.
 *
 * Fix: route group `(public)`. Next.js 16 trata `(public)` como un
 * agrupador de rutas que NO afecta el path (sigue siendo `/login`), pero
 * SÍ permite que `(public)/login/page.tsx` herede layouts de `(public)`
 * en vez de `app/`. Este layout retorna solo `{children}` (sin AppShell),
 * así que las páginas públicas se renderizan limpias.
 *
 * Las páginas autenticadas (en `app/page.tsx`, `app/fumigaciones/`, etc.)
 * siguen heredando el root layout de `app/layout.tsx` con AppShell, porque
 * no están dentro de `(public)`.
 *
 * Ver `tests/app-layout-login-routing.test.ts` para el fixture de regresión.
 */
export default function PublicLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return children;
}
