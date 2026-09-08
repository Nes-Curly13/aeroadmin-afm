/**
 * proxy.ts (Next.js 16 — antes `middleware.ts`).
 *
 * Protege todas las rutas excepto /login + NextAuth handler via el
 * `authorized` callback de NextAuth (en `lib/auth.config.ts`).
 *
 * S10.5 (2026-09-02): se removió la inyección del header `x-pathname`.
 * En S10.4 ese header se usaba en `app/layout.tsx` (root) para decidir
 * si wrappear con AppShell o no (workaround porque el root layout
 * envolvía TODO). Con el refactor a `app/(auth)/` route group, el
 * AppShell vive en `app/(auth)/layout.tsx` y las páginas públicas
 * (`app/(public)/login/`) no lo heredan — el pathname ya no se
 * necesita en el root layout.
 *
 * Bug 2 fix (2026-09-08): el default export es ahora `auth` (la función
 * cruda de NextAuth) en vez de `auth((_request) => NextResponse.next())`.
 * Cuando wrappeás `auth` con un handler propio, el callback `authorized`
 * SE IGNORA — el handler siempre corre y deja pasar la request. Eso
 * hacía que `/geovisor` (y todas las pages autenticadas) fueran
 * accesibles sin login. La guía de Auth.js v5 lo dice explícito:
 * "When using `auth` without a handler, it returns a request handler
 * that will use the `authorized` callback to determine if a request
 * is authorized. If not, it will redirect to the signIn page." Ver
 * `docs/BUG-2-AUTH-DIAGNOSTIC.md` para el detalle del diagnóstico.
 *
 * Por qué importa de `auth.config` (no `auth`):
 *   - El proxy corre en Edge runtime. La lib `auth` usa bcryptjs
 *     (Node-only) para el Credentials provider. Si importamos `auth`
 *     aca, el bundle rompe con "edge runtime does not support crypto
 *     module".
 *   - `auth.config` no tiene providers (solo config + callbacks),
 *     asi que es seguro para Edge.
 */

import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

const { auth } = NextAuth(authConfig);

// CRITICO: exportamos `auth` directo, SIN wrappear con un handler.
// Si wrappeamos, el `authorized` callback se bypasea y la auth
// gate deja de funcionar. Ver comment del header.
export default auth;

export const config = {
  /**
   * Matcher: todo excepto assets estaticos y Next.js internals.
   * Dejamos `/login` y `/api/auth/*` pasar — el `authorized` callback
   * se encarga de aceptar/rechazar.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public|api/auth).*)"]
};
