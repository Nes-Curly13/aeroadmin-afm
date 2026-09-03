/**
 * app/(auth)/layout.tsx
 *
 * S10.5 (2026-09-02) — route group para páginas autenticadas.
 *
 * Antes (S10.4): el root layout en `app/layout.tsx` envolvía TODO con
 * `<AppShell>`, incluyendo las páginas públicas. Para evitar que /login
 * mostrara el sidebar, se usó un workaround con `proxy.ts` que setea
 * `x-pathname` y un check de `PUBLIC_PATHS` en el root layout. Funcionaba
 * pero no era idiomático.
 *
 * Fix idiomático (Next.js 16): route group `(auth)`. Las páginas
 * autenticadas viven en `app/(auth)/...` y heredan este layout que
 * wrappea con `<AppShell>`. Las páginas públicas (en `app/(public)/...`,
 * ej: /login) NO heredan este layout porque están en un sibling group.
 *
 * El root layout `app/layout.tsx` queda mínimo: solo `<html><body>`.
 *
 * Ver `tests/app-layout-login-routing.test.ts` para el fixture de regresión.
 */
import { AppShell } from "@/components/app-shell"

export default function AuthLayout({
  children
}: {
  children: React.ReactNode
}) {
  return <AppShell>{children}</AppShell>
}
