/**
 * Shim de back-compat para los tipos y helpers de roles.
 *
 * v1.5 (consolidación): la fuente de verdad del tipo `AppRole` es
 * `lib/auth/role.ts`, y los helpers de display (`ROLE_LABELS`,
 * `ROLE_BADGE_CLASS`, `normalizeRole`) viven en `lib/auth/role-display.ts`.
 *
 * Este archivo queda como un re-export para que callers existentes
 * (tests, componentes previos a v1.5) sigan importando de `@/components/auth/types`
 * sin romperse. NO se debe agregar código nuevo acá — los nuevos
 * callers deben importar de los archivos canónicos directamente.
 *
 * Histórico:
 *   - v1.4 Track B: este archivo definía `AppRole` localmente con el
 *     argumento "Track A puede no haber mergeado todavía".
 *   - v1.5: consolidado. Track A ya mergeó `lib/auth/role.ts`, así
 *     que el type se importa de ahí (single source of truth).
 *
 * Ver `lib/auth/role-display.ts` para la documentación completa de los helpers.
 */

export type { AppRole } from "@/lib/auth/role";
export {
  ROLE_LABELS,
  ROLE_BADGE_CLASS,
  normalizeRole
} from "@/lib/auth/role-display";
