/**
 * POST /api/admin/parcels/import/commit — crea N parcelas en una sola tx
 * a partir de la preview ya parseada.
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding, sub-sprint 2 (Import GIS).
 *
 * Body JSON: { parcels: [{ name, geometry, field_type, luck_name?, ... }] }
 * Response 201: { created: DjiParcelRecord[] }  (orden = orden del input)
 * Response 400: { error }
 * Response 500: { error }
 *
 * Auth: admin only.
 *
 * Decisión: la preview y el commit son 2 requests separados (no 1) para
 * que el operador pueda editar nombres ANTES de crear. El "name" que
 * viene del GIS (ej "OBJECTID 2473") muchas veces no es útil — el
 * operador lo quiere cambiar a "Lote 12 — Suerte 3" antes de confirmar.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import {
  createManualParcelsBulk,
  type CreateManualParcelInput,
  type ManualParcelGeometry
} from "@/api/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CommitParcelInput {
  name: string;
  field_type?: string;
  geometry: ManualParcelGeometry;
  luck_name?: string | null;
  client_name?: string | null;
  farm_name?: string | null;
  municipality?: string | null;
  variety?: string | null;
  crop_type?: string | null;
  planting_date?: string | null;
  owner_name?: string | null;
  owner_contact?: string | null;
  supervisor_notes?: string | null;
}

function validateCommitInput(body: unknown): CommitParcelInput[] {
  if (!body || typeof body !== "object") {
    throw new Error("Body inválido (JSON esperado)");
  }
  const b = body as { parcels?: unknown };
  if (!Array.isArray(b.parcels)) {
    throw new Error("Falta el array 'parcels'");
  }
  if (b.parcels.length === 0) {
    throw new Error("parcels está vacío");
  }
  if (b.parcels.length > 1000) {
    throw new Error("Máximo 1000 parcelas por import (límite MVP)");
  }
  return b.parcels as CommitParcelInput[];
}

export async function POST(req: NextRequest) {
  // Auth: admin only
  try {
    await requireRole("admin");
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "no autenticado" }, { status: 401 });
    }
    if (e.code === "FORBIDDEN") {
      return NextResponse.json({ error: "rol insuficiente" }, { status: 403 });
    }
    return NextResponse.json(
      { error: e.message ?? "auth error" },
      { status: 500 }
    );
  }

  // Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json(
      { error: `Body inválido (JSON esperado): ${err instanceof Error ? err.message : "?"}` },
      { status: 400 }
    );
  }

  let parcels: CommitParcelInput[];
  try {
    parcels = validateCommitInput(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "?" },
      { status: 400 }
    );
  }

  // Convertir al shape de createManualParcelsBulk
  const inputs: CreateManualParcelInput[] = parcels.map((p) => ({
    land_name: p.name,
    field_type: p.field_type ?? "Farmland",
    geometry: p.geometry,
    luck_name: p.luck_name ?? null,
    client_name: p.client_name ?? null,
    farm_name: p.farm_name ?? null,
    municipality: p.municipality ?? null,
    variety: p.variety ?? null,
    crop_type: p.crop_type ?? null,
    planting_date: p.planting_date ?? null,
    owner_name: p.owner_name ?? null,
    owner_contact: p.owner_contact ?? null,
    supervisor_notes: p.supervisor_notes ?? null
  }));

  // Crear
  let created;
  try {
    created = await createManualParcelsBulk(inputs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido al crear";
    // Si la validación falla, devolvemos 400 (mensaje útil)
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ created }, { status: 201 });
}
