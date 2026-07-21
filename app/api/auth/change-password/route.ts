import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";

import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/auth/role";

interface ChangePasswordBody {
  email: string;
  new_password: string;
}

/**
 * POST /api/auth/change-password
 *
 * Sprint 3: cambio de password admin-only (un admin puede resetear el
 * password de cualquier usuario; un viewer NO puede cambiar el propio
 * via este endpoint — para viewer-self use el flow de "olvide mi password"
 * que se hara en una iteracion posterior).
 *
 * Por qué admin-only y no self-service:
 *   - Opcion A = single-tenant para herramienta interna. El operador
 *     definio (en 2026-06-28) que la poblacion son 5-10 personas y
 *     no vale la pena un flow de "olvide password" con email.
 *   - El user logged-in puede cambiar SU propio password si querés:
 *     anyadimos /api/auth/me/change-password en una iteracion si surge.
 *
 * Validacion:
 *   - new_password >= 10 chars (OWASP minimum razonable para admin tools)
 *   - bcrypt cost 10 (~70ms hash, OK para interactive)
 *   - Retorna 200 / 400 / 401 / 403 / 500
 */
export async function POST(request: NextRequest) {
  try {
    // requireRole lanza 401/403 si falla
    await requireRole("admin");

    const body = (await request.json()) as ChangePasswordBody;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Body JSON requerido." }, { status: 400 });
    }
    const email = String(body.email ?? "").trim().toLowerCase();
    const newPassword = String(body.new_password ?? "");

    if (!email) {
      return NextResponse.json({ error: "email requerido." }, { status: 400 });
    }
    if (newPassword.length < 10) {
      return NextResponse.json(
        { error: "Password debe tener al menos 10 caracteres." },
        { status: 400 }
      );
    }
    if (newPassword.length > 128) {
      return NextResponse.json(
        { error: "Password demasiado largo (max 128 chars)." },
        { status: 400 }
      );
    }

    const hash = await bcrypt.hash(newPassword, 10);
    const db = getDb();
    const result = await db.query<{ id: number }>(
      "UPDATE app_users SET password_hash = $2, updated_at = NOW() WHERE email = $1 RETURNING id",
      [email, hash]
    );
    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: `Usuario con email '${email}' no existe.` },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }
    if (code === "FORBIDDEN") {
      return NextResponse.json(
        { error: "Solo administradores pueden cambiar passwords." },
        { status: 403 }
      );
    }
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Error al cambiar password."
      },
      { status: 500 }
    );
  }
}
