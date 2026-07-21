"use client";

/**
 * RoleGate — renderiza children solo si el role del usuario está en `allow`.
 *
 * Track B v1.4 — UI gates por role.
 *
 * Politica conservadora: si el role es `null` (aun cargando, no
 * autenticado, o rol desconocido), el gate oculta el contenido. Esto
 * evita un flash de UI protegida antes de que el hook `useUserRole`
 * resuelva. El costo es ~50ms de "no se ve nada" en la primera carga,
 * aceptable porque el contenido gated suele ser secundario (un boton,
 * un link, un banner).
 *
 * Para ocultar contenido critico (ej. una pagina entera), la
 * responsabilidad es del server component / middleware, no del gate
 * client (un usuario malicioso puede bypassear el render client). Ver
 * `app/devices/page.tsx` para el patron server-side con `redirect()`.
 *
 * Uso:
 *   <RoleGate allow={["admin"]}>
 *     <button>Solo admin</button>
 *   </RoleGate>
 *
 *   <RoleGate allow={["admin", "supervisor"]} fallback={<p>No aplica</p>}>
 *     <Panel />
 *   </RoleGate>
 */

import type { ReactNode } from "react";

import { useUserRole } from "@/components/auth/use-user-role";
import type { AppRole } from "@/lib/auth/role";

export interface RoleGateProps {
  /** Lista de roles que pueden ver el contenido. */
  allow: AppRole[];
  /** Contenido a renderizar si el role esta en `allow`. */
  children: ReactNode;
  /**
   * Opcional. Lo que se muestra cuando el role NO esta permitido.
   * Si no se pasa, el gate renderiza `null` (espacio vacio en el DOM).
   */
  fallback?: ReactNode;
}

export function RoleGate({ allow, children, fallback = null }: RoleGateProps) {
  const role = useUserRole();

  if (role === null || !allow.includes(role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
