"use client";

/**
 * useUserRole() — hook client para leer el role del usuario actual.
 *
 * Track B v1.4 — UI gates por role.
 *
 * Estrategia deliberadamente simple: 0 deps externas (sin SWR / React
 * Query). Hace UN fetch a `/api/auth/me` en mount y cachea el resultado
 * en estado local. Si el usuario navega entre páginas, el componente
 * se re-monta y re-fetchea (es barato, ~5ms en local, ~30-50ms en
 * Supabase), pero no se duplican fetches dentro del mismo mount.
 *
 * El endpoint `/api/auth/me` se encarga del mapeo retrocompatible
 * `viewer → supervisor` (ver `app/api/auth/me/route.ts`). Este hook
 * solo consume el resultado y valida que sea uno de los roles
 * conocidos — si llega algo inesperado, devuelve `null` (defensa en
 * profundidad contra un endpoint mal configurado).
 *
 * Por qué `useState + useEffect` y no `useSession()` de NextAuth:
 *   - `useSession()` requiere `<SessionProvider>` en el layout, que hoy
 *     no existe. Agregar SessionProvider a un server component es un
 *     cambio más invasivo que un fetch a un endpoint que ya devuelve
 *     lo que necesitamos.
 *   - El endpoint es chico, cacheable por Next (in-process), y se
 *     invalida automaticamente cuando el usuario hace logout (cookie
 *     expira → 401 → role=null).
 */

import { useEffect, useState } from "react";

import type { AppRole } from "@/lib/auth/role";

/**
 * Tipos de la respuesta del endpoint. Inline (no en `types.ts`) porque
 * este hook es el unico caller. Mantenerlo local facilita ver el
 * contrato HTTP completo en un solo lugar.
 */
interface MeResponse {
  email: string;
  role: AppRole;
  name: string | null;
}

function isAppRole(value: unknown): value is AppRole {
  return value === "admin" || value === "supervisor";
}

export function useUserRole(): AppRole | null {
  const [role, setRole] = useState<AppRole | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchRole(): Promise<void> {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          if (!cancelled) setRole(null);
          return;
        }
        const data: unknown = await res.json();
        if (
          data &&
          typeof data === "object" &&
          "role" in data &&
          isAppRole((data as MeResponse).role)
        ) {
          if (!cancelled) setRole((data as MeResponse).role);
        } else {
          // rol desconocido -> tratamos como no autenticado
          if (!cancelled) setRole(null);
        }
      } catch {
        // red caida, JSON malformado, etc. -> no autenticado
        if (!cancelled) setRole(null);
      }
    }

    void fetchRole();

    return () => {
      cancelled = true;
    };
  }, []);

  return role;
}
