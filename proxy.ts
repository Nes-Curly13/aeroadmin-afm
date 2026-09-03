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
 * Por qué importa de `auth.config` (no `auth`):
 *   - El proxy corre en Edge runtime. La lib `auth` usa bcryptjs
 *     (Node-only) para el Credentials provider. Si importamos `auth`
 *     aca, el bundle rompe con "edge runtime does not support crypto
 *     module".
 *   - `auth.config` no tiene providers (solo config + callbacks),
 *     asi que es seguro para Edge.
 */

import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((_request) => {
  // S10.5: ya no inyectamos headers — el AppShell vive en (auth)/layout.tsx
  // y el root layout no necesita saber el pathname.
  return NextResponse.next();
});

export const config = {
  /**
   * Matcher: todo excepto assets estaticos y Next.js internals.
   * Dejamos `/login` y `/api/auth/*` pasar — el `authorized` callback
   * se encarga de aceptar/rechazar.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public|api/auth).*)"]
};
