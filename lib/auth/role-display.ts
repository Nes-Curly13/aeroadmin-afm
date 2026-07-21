/**
 * Display helpers para roles (v1.5 — consolidación).
 *
 * Por qué existe este archivo separado de `lib/auth/role.ts`:
 *   - `lib/auth/role.ts` define la lógica de auth (AppRole, getCurrentUserRole,
 *     requireRole, hasRole). Es la fuente de verdad del DOMINIO.
 *   - Este archivo define la CAPA DE PRESENTACIÓN de los roles: labels
 *     user-facing en español, clases CSS de badges, y el helper de
 *     normalización retrocompatible (`viewer -> supervisor`).
 *
 * Separar display de lógica permite:
 *   - Cambiar el copy sin tocar la lógica (o viceversa)
 *   - Reusar `AppRole` y `requireRole` desde middleware/edge sin importar
 *     dependencias client-side (este archivo es puro, sin deps)
 *   - Testear cada capa en aislamiento
 *
 * Track B v1.4 había definido estos helpers en `components/auth/types.ts`
 * con un `AppRole` local. v1.5 consolida a UNA fuente de verdad del tipo
 * (`lib/auth/role.ts`); este archivo es el nuevo hogar del display, y
 * `components/auth/types.ts` queda como un shim de re-export para
 * back-compat con callers que importaban de ahí.
 */

export type { AppRole } from "@/lib/auth/role";
import type { AppRole } from "@/lib/auth/role";

/**
 * Etiquetas visibles al usuario (español). Separadas del identificador
 * para que un cambio de copy no toque los filtros de los gates.
 */
export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrador",
  supervisor: "Supervisor"
};

/**
 * Paleta por role. La task pide admin = verde olivo, supervisor = gris.
 * Los hex están alineados con `lib/ui-tokens.ts` (paleta del proyecto).
 */
export const ROLE_BADGE_CLASS: Record<AppRole, string> = {
  admin: "bg-[#0b5f2d] text-white", // verde olivo
  supervisor: "bg-[#4a5b50] text-white" // gris
};

/**
 * Normaliza el role que viene de la sesion de NextAuth al dominio v1.4+.
 *
 * Por qué existe: la sesión histórica (pre-v1.4) exponía
 * `role: "admin" | "viewer"`. El dominio v1.4 lo renombra a
 * `"admin" | "supervisor"`. Este helper hace el mapeo retrocompatible
 * en el borde (server), así los componentes client y los server
 * components solo conocen el dominio nuevo.
 *
 * Mapeos:
 *   "admin"      -> "admin"
 *   "viewer"     -> "supervisor"  (legacy, pre-v1.4)
 *   "supervisor" -> "supervisor"  (v1.4+)
 *   otro/undef   -> "supervisor"  (defensa: least privilege)
 */
export function normalizeRole(rawRole: unknown): AppRole {
  if (rawRole === "admin") return "admin";
  if (rawRole === "supervisor") return "supervisor";
  if (rawRole === "viewer") return "supervisor";
  return "supervisor";
}
