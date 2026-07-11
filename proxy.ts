/**
 * Middleware — protege todas las rutas excepto login + NextAuth handler.
 *
 * Sprint 3 (2026-06-28): este middleware es la primera linea de defensa.
 * Usa el `authorized` callback de NextAuth (definido en `lib/auth.config.ts`)
 * para evaluar cada request en el Edge runtime.
 *
 * Por que importa de `auth.config` (no `auth`):
 *   - El middleware corre en Edge runtime. La lib `auth` usa bcryptjs
 *     (Node-only) para el Credentials provider. Si importamos `auth` aca,
 *     el bundle del middleware rompe con "edge runtime does not support
 *     crypto module".
 *   - `auth.config` no tiene providers (solo config + callbacks), asi que
 *     es seguro para Edge.
 *   - NextAuth v5: importar NextAuth(authConfig) en edge es soportado
 *     oficialmente por el README del proyecto.
 */

import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  /**
   * Matcher: todo excepto assets estaticos y Next.js internals.
   * Dejamos `/login` y `/api/auth/*` pasar — el `authorized` callback
   * se encarga de aceptar/rechazar.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public|api/auth).*)"]
};
