/**
 * GET /api/auth/me
 *
 * Track B v1.4 — UI gates por role.
 *
 * Devuelve los datos del usuario autenticado: email, role, name.
 * Pensado para consumo client-side (el `useUserRole` hook lo llama
 * en mount). Cuesta ~5ms con cache de Next (in-process) y ~30ms
 * en cold path (validacion de JWT).
 *
 * Sin validacion de permisos: cualquier usuario autenticado puede
 * ver SUS PROPIOS datos. No expone datos de otros usuarios.
 *
 * Mapeo retrocompatible: la sesion actual de NextAuth expone
 * `role: "admin" | "viewer"`. El dominio v1.4 lo renombra a
 * `"admin" | "supervisor"`. Este endpoint hace el mapeo en el
 * borde (server), asi los componentes client solo conocen el
 * dominio nuevo. Cuando Track A migre el codigo de auth a
 * `supervisor`, este endpoint seguira funcionando sin cambios.
 *
 * Defensa en profundidad: si la sesion tiene un role desconocido
 * (ej. un test que creo 'guest' por error), devolvemos 'supervisor'
 * (least privilege) en vez de 500. Asi la UI no rompe.
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { normalizeRole } from "@/components/auth/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }

    const user = session.user as {
      email?: string | null;
      name?: string | null;
      role?: string | null;
    };

    return NextResponse.json({
      email: user.email ?? "",
      role: normalizeRole(user.role),
      name: user.name ?? null
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error al obtener sesion." },
      { status: 500 }
    );
  }
}
