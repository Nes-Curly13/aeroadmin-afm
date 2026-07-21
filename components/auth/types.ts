/**
 * Tipos y constantes compartidos por los componentes de auth/role.
 *
 * Track B v1.4 — UI gates por role.
 *
 * Decisión de scope: este archivo define `AppRole` LOCALMENTE (no
 * dependemos de `lib/auth/role.ts` que Track A está creando en paralelo).
 * Razón: si importamos de un archivo que aún no existe, el build falla.
 * Cuando Track A mergee `lib/auth/role.ts`, podemos consolidar este
 * tipo en una sola fuente de verdad (un único import + re-export).
 *
 * El endpoint `app/api/auth/me/route.ts` se encarga del mapeo
 * retrocompatible: el session actual expone `role: "admin" | "viewer"`,
 * y lo traducimos a `"admin" | "supervisor"` antes de devolverlo al
 * cliente. Cuando Track A cambie el dominio a `supervisor`, el endpoint
 * sigue funcionando sin tocar este archivo.
 *
 * NO TOCAR el shape de AppRole sin coordinar con Track A — los gates
 * del UI y el endpoint lo comparten vía este archivo.
 */

export type AppRole = "admin" | "supervisor";

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
 * Normaliza el role que viene de la sesion de NextAuth al dominio v1.4.
 *
 * Por que existe: la sesion actual expone `role: "admin" | "viewer"`
 * (definido en `lib/auth.config.ts` pre-Track A). El dominio v1.4 lo
 * renombra a `"admin" | "supervisor"`. Este helper hace el mapeo
 * retrocompatible en el borde, asi los componentes client y los
 * server components solo conocen el dominio nuevo.
 *
 * Mapeos:
 *   "admin"      -> "admin"
 *   "viewer"     -> "supervisor"  (legacy, pre-Track A)
 *   "supervisor" -> "supervisor"  (post-Track A)
 *   otro/undef   -> "supervisor"  (defensa: least privilege)
 */
export function normalizeRole(rawRole: unknown): AppRole {
  if (rawRole === "admin") return "admin";
  if (rawRole === "supervisor") return "supervisor";
  if (rawRole === "viewer") return "supervisor";
  return "supervisor";
}
