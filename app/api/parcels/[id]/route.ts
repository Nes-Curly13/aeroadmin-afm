import { NextRequest, NextResponse } from "next/server";

import {
  getParcelById,
  updateParcelMetadata,
  type ParcelMetadataUpdate
} from "@/api/repositories";
import { parseIntParam } from "@/lib/request";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/parcels/[id]
 *
 * Devuelve una sola parcela con todas sus geometrías como GeoJSON.
 * 404 si no existe.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const parsed = parseIntParam(rawId, "id", 1);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const parcel = await getParcelById(parsed.value);
    if (!parcel) {
      return NextResponse.json({ error: "Parcela no encontrada." }, { status: 404 });
    }
    return NextResponse.json({ data: parcel });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error al obtener la parcela."
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/parcels/[id]
 *
 * Actualiza metadata editable de una parcela. Body: ParcelMetadataUpdate.
 * Solo actualiza los campos provistos (PATCH semantics via PUT, comun en
 * APIs REST). Requiere sesion valida (viewer o admin pueden editar metadata
 * basica; el caller decide si viewers pueden o no segun la politica del tenant).
 *
 * 404 si la parcela no existe.
 * 400 si algun valor numerico esta fuera de rango.
 * 401 si no hay sesion.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Auth: viewers y admins pueden editar metadata. (El caller decide si
    // bloquea viewers via middleware del client.)
    const session = await requireAuth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }

    const { id: rawId } = await params;
    const idParsed = parseIntParam(rawId, "id", 1);
    if ("error" in idParsed) {
      return NextResponse.json({ error: idParsed.error }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON requerido." }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Body JSON requerido." }, { status: 400 });
    }

    const b = body as Record<string, unknown>;
    const patch: ParcelMetadataUpdate = {};

    if ("land_name" in b) {
      const v = b.land_name;
      if (v !== null && typeof v !== "string") {
        return NextResponse.json({ error: "land_name debe ser string o null." }, { status: 400 });
      }
      if (typeof v === "string" && v.length > 200) {
        return NextResponse.json({ error: "land_name max 200 chars." }, { status: 400 });
      }
      patch.land_name = (v as string | null) ?? null;
    }
    if ("field_type" in b) {
      const v = b.field_type;
      if (v !== null && typeof v !== "string") {
        return NextResponse.json({ error: "field_type debe ser string o null." }, { status: 400 });
      }
      if (typeof v === "string" && v.length > 64) {
        return NextResponse.json({ error: "field_type max 64 chars." }, { status: 400 });
      }
      patch.field_type = (v as string | null) ?? null;
    }
    if ("declared_area_ha" in b) {
      const v = b.declared_area_ha;
      if (v !== null && typeof v !== "number") {
        return NextResponse.json({ error: "declared_area_ha debe ser numero o null." }, { status: 400 });
      }
      patch.declared_area_ha = (v as number | null) ?? null;
    }
    if ("spray_area_m2" in b) {
      const v = b.spray_area_m2;
      if (v !== null && typeof v !== "number") {
        return NextResponse.json({ error: "spray_area_m2 debe ser numero o null." }, { status: 400 });
      }
      patch.spray_area_m2 = (v as number | null) ?? null;
    }

    const updated = await updateParcelMetadata(idParsed.value, patch);
    if (!updated) {
      return NextResponse.json({ error: "Parcela no encontrada." }, { status: 404 });
    }
    return NextResponse.json({ data: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error al actualizar parcela.";
    // Validacion (declared_area_ha / spray_area_m2 fuera de rango) cae aca.
    if (msg.includes("debe estar entre")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}