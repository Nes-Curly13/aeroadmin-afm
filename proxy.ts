/**
 * proxy.ts (Next.js 16 — antes `middleware.ts`).
 *
 * Protege todas las rutas excepto /login + NextAuth handler via el
 * `authorized` callback de NextAuth (en `lib/auth.config.ts`).
 *
 * Ademas (S10.4 — 2026-09-02): setea el header `x-pathname` en la
 * request para que `app/layout.tsx` pueda decidir si wrappear la
 * pagina con AppShell o no. Sin este header, el root layout envuelve
 * TODO con AppShell — incluyendo /login, donde el operador veia el
 * sidebar con "Cerrar sesion" mientras intentaba loguearse
 * (clickear "Ingresar" accidentalmente llamaba a logoutAction).
 *
 * Por que importa de `auth.config` (no `auth`):
 *   - El proxy corre en Edge runtime. La lib `auth` usa bcryptjs
 *     (Node-only) para el Credentials provider. Si importamos `auth`
 *     aca, el bundle rompe con "edge runtime does not support crypto
 *     module".
 *   - `auth.config` no tiene providers (solo config + callbacks),
 *     asi que es seguro para Edge.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((request) => {
  // S10.4: inyectamos el pathname en los headers del request para
  // que el root layout lo lea via `headers().get("x-pathname")` y
  // decida si envolver con AppShell o no. Usamos `request: { headers }`
  // para reescribir los headers que ve el resto del request handling.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
});

export const config = {
  /**
   * Matcher: todo excepto assets estaticos y Next.js internals.
   * Dejamos `/login` y `/api/auth/*` pasar — el `authorized` callback
   * se encarga de aceptar/rechazar.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public|api/auth).*)"]
};
