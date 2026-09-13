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

import type { AppRole } from "@/lib/auth/role";

export const AUTH_COOKIE_NAME = "afm.session";

/**
 * Re-export del AppRole canonico (v1.4 Track A).
 *
 * El type vive en `lib/auth/role.ts` (single source of truth) y
 * este modulo lo re-exporta para mantener compat con:
 *   - `types/next-auth.d.ts` que hace `import type { AppRole } from "@/lib/auth"`
 *   - cualquier caller historico que importaba `AppRole` desde
 *     `lib/auth.config` directamente.
 *
 * Antes (v1.3): exportaba `"admin" | "viewer"`.
 * Ahora (v1.4): re-exporta `"admin" | "supervisor"` desde role.ts.
 * El rename semantico viewer->supervisor refleja que el operario
 * ahora puede REGISTRAR fumigaciones, no solo mirar. Ver migration
 * 20260721000000_add_app_users_role.sql.
 */

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
  // 2026-09-13 (MT-01, #33): trustHost condicional. true incondicional
  // habilita host-header injection si se despliega fuera de un proxy
  // de confianza. En Vercel es necesario (`VERCEL` env). Self-host en
  // prod sin proxy: setear `AUTH_TRUST_HOST=true`. Dev (NODE_ENV!=production):
  // tambien true para no romper localhost.
  trustHost:
    process.env.AUTH_TRUST_HOST === "true" ||
    Boolean(process.env.VERCEL) ||
    process.env.NODE_ENV !== "production",
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
     * JWT callback — corre cuando Auth.js crea o refresca un JWT.
     *
     * Edge-safe: solo copia `role` y `uid` del `user` (que el
     * Credentials provider de `lib/auth.ts` devuelve con `authorize`)
     * al token. NO toca bcrypt ni la BD.
     *
     * v2.1 (S7.2 hotfix): movido ACÁ desde `lib/auth.ts` para que
     * el middleware (Edge runtime) también propague `role` al objeto
     * `auth` que recibe el callback `authorized`. Si vive solo en
     * `lib/auth.ts`, el middleware ve `auth.user.role = undefined`
     * porque su `authorized` se evalúa contra la config edge-safe,
     * no contra la full.
     */
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: AppRole }).role ?? "supervisor";
        token.uid = (user as { id?: string }).id ?? "";
      }
      return token;
    },
    /**
     * Session callback — corre cuando Auth.js construye la Session
     * expuesta a la app (e.g. `auth()` server-side, `useSession`
     * client-side, y el `auth` que recibe `authorized`).
     *
     * Edge-safe: solo copia `role` y `uid` del JWT a `session.user`.
     * Por eso DEBE estar en `authConfig` (edge-safe), no solo en
     * `auth.ts` (Node-only) — el middleware necesita ver el `role`
     * para gatear `/admin/*`. Ver S7.2 hotfix.
     *
     * Default 'supervisor' (no 'admin') para que un JWT emitido
     * por un bug/edge-case (sin role explicito) NO quede con
     * permisos de admin. v1.4: el sistema es admin | supervisor.
     */
    async session({ session, token }) {
      if (session.user) {
        (session.user as { role?: AppRole }).role =
          (token as { role?: AppRole }).role ?? "supervisor";
        (session.user as { id?: string }).id =
          (token as { uid?: string }).uid ?? "";
      }
      return session;
    },
    /**
     * Autorizacion por ruta — edge-safe porque NO toca la BD ni bcrypt.
     * Solo lee `auth?.user.role` que ya viene en el JWT firmado.
     *
     * Comportamiento por tipo de path:
     *   - Paths PUBLIC: siempre pasan (no necesitan sesion)
     *   - `/api/*` (no PUBLIC): SIEMPRE pasan al route handler. Cada
     *     route handler hace su propia auth via `requireAuth()` o
     *     `requireRole()` y devuelve 401/403 JSON. Razon: cuando un
     *     script CLI llama al endpoint con Bearer token (sin sesion
     *     NextAuth), queremos que el handler valide el bearer y
     *     ejecute, no que el middleware lo redirija a /login.
     *   - `/admin/*` (UI admin): requiere sesion + role=admin. Si no,
     *     el middleware redirige a /login (comportamiento UI standard).
     *   - Otros paths: requieren sesion. Si no, redirect a /login.
     *
     * Bug 2 fix (2026-09-08): el agujero de seguridad reportado por
     * un dev nuevo ("/geovisor accesible sin login") era el wrapper
     * `auth((req) => NextResponse.next())` en proxy.ts que bypaseaba
     * este callback. El log temporal de S10.5.2 se removió — el fix
     * definitivo está en proxy.ts: `export default auth` (sin wrappear).
     * Ver `docs/BUG-2-AUTH-DIAGNOSTIC.md`.
     */
    async authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isLoggedIn = !!auth?.user;

      // Rutas que NO requieren sesion (NextAuth handler, login page).
      // Cualquier /api/* que NO este aca debe estar gateado por
      // requireAuth/requireRole en su handler.
      const PUBLIC = [
        "/login",
        "/api/auth" // NextAuth handler (signin, signout, callback, session)
      ];
      if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
        return true;
      }

      // /api/internal/* son endpoints token-gated (ej. print-map con
      // INTERNAL_MAP_TOKEN). El handler valida el token; authorized
      // deja pasar para que el handler pueda devolver su propio 401
      // con un mensaje claro.
      if (pathname.startsWith("/api/internal/")) {
        return true;
      }

      // 2026-09-10 (issue #25): deny-by-default para /api/*. Antes
      // pasabamos TODOS los handlers y la seguridad dependia 100% de
      // que cada handler llamara requireRole. Si un dev nuevo
      // agregaba un handler y se olvidaba del requireRole, el
      // endpoint quedaba publico silenciosamente. Ahora, authorized
      // exige sesion; si el handler quiere exponer algo sin sesion,
      // tiene que hacer su propia auth y devolver un NextResponse
      // manualmente (NextAuth no bypasea el authorized, asi que el
      // redirect a /login aplica).
      if (pathname.startsWith("/api/")) {
        return isLoggedIn;
      }

      if (!isLoggedIn) return false;

      if (pathname.startsWith("/admin/")) {
        return (auth?.user as { role?: AppRole } | undefined)?.role === "admin";
      }
      return true;
    }
  }
};
