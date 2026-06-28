/**
 * NextAuth v5 (Auth.js) — configuracion central del panel + helpers.
 *
 * Sprint 3 (2026-06-28) Opcion A: single-tenant, credentials provider
 * contra la tabla `app_users` + JWT session strategy.
 *
 * Estructura separada del `authConfig` (edge-safe) en `lib/auth.config.ts`:
 *   - `auth.config.ts` solo define config + callbacks (incluido `authorized`
 *     que usa el middleware Edge runtime).
 *   - Este archivo agrega el Credentials provider (con bcryptjs) y exporta
 *     `handlers`, `auth`, `signIn`, `signOut` para uso en API routes /
 *     server components (Node runtime).
 *
 * Por que Credentials + JWT (no OIDC / DB session adapter):
 *   - Single-tenant para herramienta interna del operador. No hay OAuth
 *     provider externo (no hay tenant de Google Workspace / Auth0 asignado).
 *   - `Credentials` con bcrypt evita el adapter de Postgres que para Auth.js
 *     es `@auth/pg-adapter`, con su migration de tablas extra (`accounts`,
 *     `sessions`, `verification_tokens`). Demasiada superficie para Opcion A.
 *   - JWT (no DB session): cada request valida el JWT firmado y no pega a la
 *     BD. Compatible con serverless + cache de Next sin riesgo de sesion
 *     zombie si la BD cae.
 *
 * Decisiones de seguridad:
 *   - `pages.signIn = '/login'` redirige a una ruta owned por nosotros.
 *   - `pages.error = '/login'` tambien.
 *   - El `secret` se lee de `AUTH_SECRET` env, falla si no esta seteado
 *     (NextAuth no permite sesiones inseguras).
 *   - Roles via `session.user.role` y `session.user.id` para que UI y
 *     middleware los lean sin re-query a la BD.
 *   - `bcrypt.compare` con cost 10 (default) — suficiente para auth admin
 *     con password escrita a mano. Para 100k+ users subir a 12.
 */

import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { getDb } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";

// Re-export del app-role type y cookie name para callers que no quieren
// importar auth.config directo.
export type { AppRole } from "@/lib/auth.config";
export { AUTH_COOKIE_NAME } from "@/lib/auth.config";

/**
 * Extender el config edge-safe con el Credentials provider (Node runtime,
 * toca la BD + bcryptjs).
 */
const fullAuthConfig: NextAuthConfig = {
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      /**
       * Valida email/password contra `app_users`. Devuelve el objeto user
       * que Auth.js mete en el JWT. Devolvemos `null` para fallo (Auth.js
       * nos protege de timing-attack de "user existe vs password mal").
       *
       * NextAuth v5 pasa `credentials` como `{ email: '...', password: '...' }`
       * desde `signIn(...)` server action, o `{ email: { value, label }, ... }`
       * desde el form parseado. Aceptamos ambas formas.
       */
      async authorize(credentials) {
        const rawEmail = credentials?.email;
        const rawPassword = credentials?.password;
        const extract = (v: unknown): string => {
          if (typeof v === "string") return v;
          if (
            v &&
            typeof v === "object" &&
            "value" in v &&
            typeof (v as { value: unknown }).value === "string"
          ) {
            return (v as { value: string }).value;
          }
          return "";
        };
        const email = extract(rawEmail).trim().toLowerCase();
        const password = extract(rawPassword);
        if (!email || !password) return null;

        let user: {
          id: number;
          email: string;
          password_hash: string;
          role: "admin" | "viewer";
          is_active: boolean;
        } | null = null;
        try {
          const db = getDb();
          const r = await db.query<{
            id: number;
            email: string;
            password_hash: string;
            role: "admin" | "viewer";
            is_active: boolean;
          }>(
            `SELECT id, email, password_hash, role, is_active
               FROM app_users
              WHERE email = $1
              LIMIT 1`,
            [email]
          );
          user = r.rows[0] ?? null;
        } catch {
          return null;
        }
        if (!user || !user.is_active) return null;

        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return null;

        // Update last_login_at (fire-and-forget; si falla, no bloquea el login).
        try {
          const db = getDb();
          await db.query(
            "UPDATE app_users SET last_login_at = now() WHERE id = $1",
            [user.id]
          );
        } catch {
          /* intentional no-op */
        }

        return {
          id: String(user.id),
          email: user.email,
          role: user.role
        };
      }
    })
  ],
  callbacks: {
    /**
     * Reusa el `authorized` del edge-safe. El `authorized` corre en
     * middleware Edge (no recibe user-password), asi que es seguro.
     */
    ...authConfig.callbacks,
    /**
     * Cada vez que Auth.js crea o refresca el JWT metemos `role` + `uid`
     * desde el `user` que devolvio `authorize`.
     */
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: "admin" | "viewer" }).role ?? "viewer";
        token.uid = (user as { id?: string }).id ?? "";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { role?: "admin" | "viewer" }).role =
          (token as { role?: "admin" | "viewer" }).role ?? "viewer";
        (session.user as { id?: string }).id =
          (token as { uid?: string }).uid ?? "";
      }
      return session;
    }
  }
};

export const { handlers, auth, signIn, signOut } = NextAuth(fullAuthConfig);

/**
 * Helpers para usar en server components / api routes. Lanza error tipado
 * con `code = 'UNAUTHENTICATED' | 'FORBIDDEN'` que el caller o Next.js
 * puede convertir en redirect / 401 / 403.
 */
export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    const err = new Error("UNAUTHENTICATED") as Error & {
      code?: string;
      status?: number;
    };
    err.code = "UNAUTHENTICATED";
    err.status = 401;
    throw err;
  }
  return session;
}

export async function requireRole(role: "admin" | "viewer") {
  const session = await requireAuth();
  const actual = (session.user as { role?: "admin" | "viewer" }).role;
  if (actual !== role) {
    const err = new Error("FORBIDDEN") as Error & {
      code?: string;
      status?: number;
    };
    err.code = "FORBIDDEN";
    err.status = 403;
    throw err;
  }
  return session;
}
