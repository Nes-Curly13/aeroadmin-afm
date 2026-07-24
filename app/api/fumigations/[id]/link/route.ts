/**
 * POST /api/fumigations/[id]/link
 *
 * Sprint G1 — Hoja de vida de la parcela.
 *
 * Vincula una fumigación huérfana (parcel_id IS NULL) a una parcela.
 * El admin decide manualmente a qué parcela va cada huérfana (no hay
 * spatial join posible — ver comentario en `linkFumigationToParcel`).
 *
 * Solo accesible para role 'admin'.
 *
 * Body: { parcel_id: number }
 *
 * Respuestas:
 *   - 200 { status: "linked", event: DjiFumigationEvent } → OK
 *   - 200 { status: "already_assigned" } → la fumigación ya tenía parcela
 *   - 200 { status: "not_found" } → fumigación o parcela no existe
 *   - 400 → body inválido (parcel_id faltante o no numérico)
 *   - 401 → sin sesión
 *   - 403 → role no es admin
 *
 * Decisión: usar 200 con `status` en el body en vez de 409/404 para
 * que el cliente tenga un solo happy path y muestre el mensaje
 * correcto según el status. 404 sería válido pero el caller (la página
 * admin) ya tiene la fumigación en memoria; no necesita otro GET.
 */

import { NextRequest, NextResponse } from "next/server";

import { linkFumigationToParcel } from "@/api/repositories";
import { requireRole } from "@/lib/auth/role";
import { parseIntParam } from "@/lib/request";

export const dynamic = "force-dynamic";

interface LinkBody {
  parcel_id?: number | string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireRole("admin");

  const { id: rawId } = await params;
  const fumigationId = Number(rawId);
  if (!Number.isFinite(fumigationId) || fumigationId < 1) {
    return NextResponse.json(
      { error: "id inválido" },
      { status: 400 }
    );
  }

  let body: LinkBody;
  try {
    body = (await req.json()) as LinkBody;
  } catch {
    return NextResponse.json(
      { error: "body inválido (JSON)" },
      { status: 400 }
    );
  }

  const parcelId = Number(body.parcel_id);
  if (!Number.isFinite(parcelId) || parcelId < 1) {
    return NextResponse.json(
      { error: "parcel_id requerido y numérico" },
      { status: 400 }
    );
  }

  const result = await linkFumigationToParcel(fumigationId, parcelId);
  return NextResponse.json(result);
}
