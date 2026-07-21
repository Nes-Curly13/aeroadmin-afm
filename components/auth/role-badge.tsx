"use client";

/**
 * RoleBadge — badge pequeno que muestra el role del usuario.
 *
 * Track B v1.4 — UI gates por role.
 *
 * Pensado para ir en el header del AppShell, al lado del logo. Solo se
 * renderiza si hay sesion valida (role != null). No muestra "cargando"
 * ni "sin permiso" — si no sabemos el role todavia, el badge
 * simplemente no aparece (asi no se ve un placeholder vacio durante el
 * primer render).
 *
 * Colores segun la task: admin = verde olivo, supervisor = gris.
 * Los hex vienen de `ROLE_BADGE_CLASS` en `types.ts` para mantener
 * una sola fuente de verdad.
 *
 * Accesibilidad: usa `role="status"` para que los lectores de pantalla
 * anuncien el role cuando cambia (ej. tras un switch de usuario).
 */

import { useUserRole } from "@/components/auth/use-user-role";
import { ROLE_BADGE_CLASS, ROLE_LABELS } from "@/lib/auth/role-display";

export function RoleBadge() {
  const role = useUserRole();

  if (role === null) {
    return null;
  }

  return (
    <span
      aria-label={`Sesión iniciada como ${ROLE_LABELS[role]}`}
      className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${ROLE_BADGE_CLASS[role]}`}
      data-testid="role-badge"
      role="status"
    >
      {ROLE_LABELS[role]}
    </span>
  );
}
