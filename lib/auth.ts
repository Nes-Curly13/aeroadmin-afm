/**
 * NextAuth v5 (Auth.js) — configuración central del panel.
 *
 * Sprint 3 (2026-06-28). Opcion A: single-tenant, credentials provider
 * contra la tabla `app_users` + JWT session strategy.
 *
 * Por qué Credentials + JWT (no OIDC / DB session adapter):
 *   - Single-tenant para herramienta interna del operador. No hay OAuth
 *     provider externo (no hay tenant de Google Workspace / Auth0 asignado).
 *   - `Credentials` con bcrypt evita el adapter de Postgres que para Auth.js
 *     es `@auth/pg-adapter`, con su migration de tablas extra (`accounts`,
 *     `sessions`, `verification_tokens`). Demasiada superficie para Opcion A.
 *   - JWT (no DB session): cada request valida el JWT firmado y no pega a la
 *     BD. Compatible con serverless + cache de Next sin riesgo de sesi\u00f3n
 *     zombie si la BD cae.
 *
 * Decisiones de seguridad:
 *   - `pages.signIn = '/login'` redirige a una ruta owned por nosotros.
 *   - `pages.error = '/login'` también.
 *   - El `secret` se lee de `AUTH_SECRET` env, falla si no está seteado
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

export type AppRole = "admin" | "viewer";

export const AUTH_COOKIE_NAME = "afm.session";

const authSecret = process.env.AUTH_SECRET;
if (!authSecret && process.env.NODE_ENV === "production") {
  throw new Error(
    "AUTH_SECRET must be set in production. Generate with `openssl rand -base64 32`."
  );
}

export const authConfig: NextAuthConfig = {
  // Si AUTH_SECRET no esta set en dev, usamos uno fijo temporal para no
  // romper boot. NextAuth v5 no permite undefined.
  secret: authSecret ?? "dev-only-insecure-secret-do-not-use-in-prod",
  session: {
    strategy: "jwt",
    // 12h: turno de fumigacion. No mas largo para no exponer sesion
    // indefinida si un laptop queda logueado.
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
       * NextAuth v5 pasa `credentials` como `{ email: { value, label }, ... }`
       * cuando viene del form parsing, o como `{ email: '...', password: '...' }`
       * cuando se llama desde `signIn("credentials", { email, password })`.
       * Aceptamos ambas formas para que server actions + tests funcionen.
       */
      async authorize(credentials) {
        const rawEmail = credentials?.email;
        const rawPassword = credentials?.password;
        const extract = (v: unknown): string => {
          if (typeof v === "string") return v;
          if (v && typeof v === "object" && "value" in v && typeof (v as { value: unknown }).value === "string") {
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
          role: AppRole;
          is_active: boolean;
        } | null = null;
        try {
          const db = getDb();
          const r = await db.query<{
            id: number;
            email: string;
            password_hash: string;
            role: AppRole;
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
          // BD no disponible en runtime: fallar la auth pero NO propagar
          // el error a Auth.js (filtraría detalles al cliente).
          return null;
        }
        if (!user || !user.is_active) return null;

        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return null;

        // Update last_login_at (fire-and-forget; si falla, no bloquea el
        // login del usuario — solo perdés la métrica de uso).
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
     * Cada vez que Auth.js crea o refresca el JWT metemos `role` + `uid`
     * desde el `user` que devolvió `authorize`.
     */
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: AppRole }).role ?? "viewer";
        token.uid = (user as { id?: string }).id ?? "";
      }
      return token;
    },
    /**
     * Cuando armamos la `session` para pasarla al server/client, copiamos
     * `role` + `uid` del JWT. La firma de Session es extendida abajo via
     * module-augmentation.
     */
    async session({ session, token }) {
      if (session.user) {
        (session.user as { role?: AppRole }).role =
          (token as { role?: AppRole }).role ?? "viewer";
        (session.user as { id?: string }).id =
          (token as { uid?: string }).uid ?? "";
      }
      return session;
    },
    /**
     * Autorización por rol: si la ruta es `/admin/*`, el usuario DEBE ser
     * `admin`. Para todo lo demás solo requiere estar autenticado.
     * Middleware usa esto indirectamente via `auth()` que consulta session.
     */
    async authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isLoggedIn = !!auth?.user;

      // Las rutas publicas van siempre OK
      const PUBLIC = [
        "/login",
        "/api/auth", // NextAuth handler
        "/api/health"
      ];
      if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
        return true;
      }

      // Resto: requiere login
      if (!isLoggedIn) return false;

      // Ruta admin requiere role=admin
      if (pathname.startsWith("/admin/")) {
        return (auth?.user as { role?: AppRole } | undefined)?.role === "admin";
      }
      return true;
    }
  }
};

// Re-exports canónicos de NextAuth v5.
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/**
 * Helpers para usar en server components / api routes. Lanza redirect a
 * `/login` si no hay sesión, o 403 si la sesión no tiene el rol pedido.
 */
export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    // Lanzar un error específico que el caller o Next.js puede convertir
    // en redirect. Aquí lo dejamos como Error con code = "UNAUTHENTICATED"
    // para que un wrapper superior lo mapee.
    const err = new Error("UNAUTHENTICATED") as Error & { code?: string; status?: number };
    err.code = "UNAUTHENTICATED";
    err.status = 401;
    throw err;
  }
  return session;
}

export async function requireRole(role: AppRole) {
  const session = await requireAuth();
  const actual = (session.user as { role?: AppRole }).role;
  if (actual !== role) {
    const err = new Error("FORBIDDEN") as Error & { code?: string; status?: number };
    err.code = "FORBIDDEN";
    err.status = 403;
    throw err;
  }
  return session;
}
