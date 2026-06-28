/**
 * Auth.js v5 — config edge-safe para middleware.
 *
 * Por que este archivo existe separado de `lib/auth.ts`:
 *   - El middleware de Next.js corre en Edge runtime (no Node).
 *   - Edge runtime no soporta modulos nativos de Node (incluido `bcryptjs`,
 *     que termina requiriendo `crypto.subtle` en algunos bundlers y rompe).
 *   - Para mantener el middleware funcional, separamos:
 *       * `lib/auth.config.ts` (ESTE): config edge-safe. Solo NextAuth +
 *         páginas + callbacks (incluido `authorized` para route protection).
 *       * `lib/auth.ts` (Node runtime): importa ESTE + el Credentials provider
 *         con bcrypt, y arma el `handlers`/`auth`/`signIn`/`signOut` final.
 *
 * El middleware importa SOLO de este archivo. El resto del codigo importa
 * del `lib/auth.ts` original.
 */

import type { NextAuthConfig } from "next-auth";

export const AUTH_COOKIE_NAME = "afm.session";

export type AppRole = "admin" | "viewer";

const authSecret = process.env.AUTH_SECRET;
if (!authSecret && process.env.NODE_ENV === "production") {
  throw new Error(
    "AUTH_SECRET must be set in production. Generate with `openssl rand -base64 32`."
  );
}

/**
 * Config edge-safe: NO incluye providers bcrypt ni acceso a la BD.
 * El unico callback operativo aca es `authorized` (route protection).
 * Los callbacks `jwt` + `session` viven SOLO en `lib/auth.ts` porque
 * necesitan ejecutar codigo Node (bcrypt compare).
 */
export const authConfig: NextAuthConfig = {
  secret: authSecret ?? "dev-only-insecure-secret-do-not-use-in-prod",
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 12
  },
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login"
  },
  cookies: {
    sessionToken: {
      name: AUTH_COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/"
      }
    }
  },
  providers: [
    // Empty providers array OK en middleware (solo se valida la sesion,
    // nunca se intenta autenticar). El provider real vive en lib/auth.ts.
  ],
  callbacks: {
    /**
     * Autorizacion por ruta — edge-safe porque NO toca la BD ni bcrypt.
     * Solo lee `auth?.user.role` que ya viene en el JWT firmado.
     */
    async authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isLoggedIn = !!auth?.user;

      const PUBLIC = [
        "/login",
        "/api/auth", // NextAuth handler
        "/api/health"
      ];
      if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
        return true;
      }

      if (!isLoggedIn) return false;

      if (pathname.startsWith("/admin/")) {
        return (auth?.user as { role?: AppRole } | undefined)?.role === "admin";
      }
      return true;
    }
  }
};
