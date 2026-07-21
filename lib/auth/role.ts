/**
 * RBAC helpers (v1.4 Track A — 2026-07-21).
 *
 * Sistema single-tenant para el operador canero. Dos roles:
 *   - admin:      CRUD completo, gestion de usuarios, edicion de
 *                 cadencias, etc.
 *   - supervisor: operario con permisos para registrar fumigaciones
 *                 propias, leer mapas / history / dashboard, y
 *                 supervisar la operacion del resto.
 *
 * Decision de diseno (PO 2026-07-21): el "viewer" del sistema
 * anterior se renombro a "supervisor" porque la operacion necesitaba
 * que el operario pudiera REGISTRAR fumigaciones (no solo mirar).
 * Ver migration `20260721000000_add_app_users_role.sql` para el
 * backfill viewer -> supervisor.
 *
 * Por que existe un archivo aparte de `lib/auth.ts`:
 *   - `lib/auth.ts` vive en Node runtime y depende de bcrypt + la BD
 *     (el `Credentials` provider). No se puede importar desde el
 *     middleware Edge.
 *   - Este archivo solo depende de `lib/auth` (la `auth()` re-export)
 *     + `lib/db`. Es seguro de importar desde route handlers (Node
 *     runtime) pero NO desde el middleware Edge — el `getDb()` rompe
 *     el bundle de Edge. Si en el futuro se necesita el guard en
 *     middleware, se hace un `unauthorized()` de Next.js en lugar
 *     de `requireRole` (ver `lib/auth.config.ts` para el patron
 *     edge-safe equivalente).
 *
 * Por que `getCurrentUserRole` NO usa cache (`unstable_cache`):
 *   - El role puede cambiar (promocion de supervisor a admin). Si
 *     cacheamos, el usuario ve el rol viejo hasta el TTL o hasta
 *     que se invalide el tag. La invalidacion es fragil (quien la
 *     dispara? el script de seed? una UI de admin?).
 *   - La query es 1 lookup por email (PK unico), <2ms con el indice
 *     de email. El costo del cache (complejidad + riesgo de stale)
 *     no se justifica para esta operacion.
 *   - El JWT ya tiene el role (vence en 12h max). El unico caso
 *     donde `getCurrentUserRole()` es necesario es cuando el caller
 *     NO confia en el JWT (ej: endpoint critico de admin que exige
 *     la verdad de la BD al momento del request).
 *
 * Por que `requireRole` consulta el role de la sesion (no de la BD):
 *   - El role vive en el JWT firmado por NextAuth. Validar contra
 *     el JWT es O(1) y atomico con la sesion (mismo lifetime).
 *   - Si el caller quiere la verdad mas fresca posible, debe usar
 *     `getCurrentUserRole()` explicitamente y comparar a mano.
 *   - Caso de uso tipico del helper: API route que necesita
 *     autorizar rapido sin un SELECT extra a la BD por cada request.
 */

import { getDb } from "@/lib/db";
import { auth } from "@/lib/auth";
import { normalizeRole } from "@/lib/auth/role-display";

/**
 * Roles validos en el sistema (v1.4). El type literal existe en
 * este archivo como fuente unica de verdad; `lib/auth.config.ts`
 * lo re-exporta para mantener compatibilidad con `types/next-auth.d.ts`
 * (que importa `AppRole` desde `@/lib/auth`).
 */
export type AppRole = "admin" | "supervisor";

/**
 * Helper puro: compara el role actual contra un role o lista de
 * roles requeridos. No consulta BD ni sesion — solo opera sobre
 * los argumentos. Util para callers que ya tienen el role en mano
 * y quieren evitar el overhead de `requireRole`.
 */
export function hasRole(
  actual: AppRole | null | undefined,
  required: AppRole | readonly AppRole[]
): boolean {
  if (!actual) return false;
  if (typeof required === "string") return actual === required;
  return required.includes(actual);
}

/**
 * Lee el role del usuario actual desde `app_users`, usando el email
 * de la sesion JWT de NextAuth. Devuelve `null` si:
 *   - no hay sesion activa
 *   - la sesion no tiene email
 *   - el email no existe en app_users
 *   - la query a la BD falla (no propaga el error — el caller decide
 *     si quiere un 401/403 o si el rol es opcional para su flujo)
 *
 * Decisión: leemos de la BD (no del JWT) para que cambios recientes
 * de rol sean visibles inmediatamente. Ver doc del archivo para el
 * trade-off completo.
 */
export async function getCurrentUserRole(): Promise<AppRole | null> {
  const session = await auth();
  const rawEmail = session?.user?.email;
  if (typeof rawEmail !== "string" || rawEmail.trim() === "") return null;

  const email = rawEmail.trim().toLowerCase();

  try {
    const db = getDb();
    const r = await db.query<{ role: AppRole }>(
      `SELECT role FROM app_users WHERE email = $1 LIMIT 1`,
      [email]
    );
    const role = r.rows[0]?.role;
    if (role === "admin" || role === "supervisor") return role;
    return null;
  } catch {
    // BD caida / no reachable. No propagamos: el caller que
    // necesita auth deberia usar `requireRole` (que mira JWT, no
    // BD) y tolerar este helper fallando. Ver tests.
    return null;
  }
}

/**
 * Lee el role del viewer ACTUAL desde la sesion JWT (sin tocar la BD).
 *
 * v1.5 — sidebar gate. Pensado para uso en server components que
 * renderizan UI condicional al role (ej. ocultar /devices del sidebar
 * para supervisores). Para gates de seguridad reales (endpoints
 * críticos) usar `requireRole` o `getCurrentUserRole` (BD-fresh).
 *
 * Diferencia con `getCurrentUserRole`:
 *   - Este helper: lee del JWT, sin DB hit. Rápido. Puede tener hasta
 *     ~12h de stale-ness si el role cambió en la BD.
 *   - `getCurrentUserRole`: lee de la BD. Stale-ness = 0 ms (truth
 *     instantánea). Más lento. Usar solo cuando el caller NO confía
 *     en el JWT.
 *
 * Diferencia con `requireRole`:
 *   - `requireRole` lanza 401/403 si el role no match. Es para
 *     autorización (gates de seguridad).
 *   - Este helper solo lee el role. Es para render condicional
 *     (gates de UI).
 *
 * Devuelve `null` si no hay sesión. `normalizeRole` (en role-display)
 * se aplica internamente para que el caller reciba el dominio
 * `admin | supervisor` sin tener que pensar en `viewer` legacy.
 */
export async function getViewerRole(): Promise<AppRole | null> {
  const session = await auth();
  if (!session?.user) return null;
  const user = session.user as { role?: string | null } | undefined;
  return normalizeRole(user?.role);
}

/**
 * Guard reusable para API routes. Lanza errores tipados
 * (con `code` + `status`) que el caller puede capturar o dejar
 * propagar al `try/catch` del route handler para devolver
 * NextResponse 401/403.
 *
 * Acepta un role o un array de roles. Match = sesion.user.role
 * esta en la lista.
 *
 * Ejemplo:
 *   await requireRole(["admin", "supervisor"]);
 *
 * Diferencia con el `requireRole` de `lib/auth.ts` (el viejo):
 *   - El de auth.ts acepta solo un role. Este acepta string o array.
 *   - Este es el canonico a partir de v1.4. El de auth.ts sigue
 *     existiendo por compat con callers existentes
 *     (app/api/auth/change-password/route.ts usa el viejo).
 *   - Si el caller quiere evitar la confusion, que importe de aca.
 */
export async function requireRole(
  required: AppRole | readonly AppRole[]
): Promise<void> {
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
  const actual = (session.user as { role?: AppRole }).role;
  if (!hasRole(actual, required)) {
    const err = new Error("FORBIDDEN") as Error & {
      code?: string;
      status?: number;
    };
    err.code = "FORBIDDEN";
    err.status = 403;
    throw err;
  }
}
