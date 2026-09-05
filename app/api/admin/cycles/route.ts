/**
 * /api/admin/cycles
 *
 * Sprint S11+ / PLAN-FUMIGACIONES-V2 / Fase 4.
 *
 * Endpoints:
 *   GET  /api/admin/cycles?parcelaId=X        — listar ciclos (filtra por parcela)
 *   POST /api/admin/cycles                   — crear ciclo manual
 *   POST /api/admin/cycles/backfill          — backfill híbrido desde fumigaciones
 *
 * Authorization: solo role=admin (gate /admin/* + requireRole).
 *
 * Por que este endpoint existe aparte del repositorio:
 *   - El operator crea ciclos manualmente desde /admin/parcels
 *     (boton "Iniciar nuevo ciclo" en el parcel detail, Fase 4.5).
 *   - El backfill corre UNA vez por environment como parte del
 *     setup del modelo V2.
 *   - Los fumigadores NO crean ciclos (no tienen UI para eso).
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/role";
import {
  listCyclesForParcel,
  createCycle,
  backfillCyclesFromFumigations
} from "@/api/repositories";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireRole("admin");
  } catch (err) {
    return authErrorToResponse(err);
  }

  const url = new URL(request.url);
  const parcelaIdRaw = url.searchParams.get("parcelaId");
  const parcelaId = parcelaIdRaw ? Number(parcelaIdRaw) : null;
  if (parcelaId === null || !Number.isFinite(parcelaId) || parcelaId < 1) {
    return NextResponse.json(
      { error: "parcelaId es obligatorio y debe ser entero positivo" },
      { status: 400 }
    );
  }

  try {
    const cycles = await listCyclesForParcel(parcelaId);
    return NextResponse.json({ cycles });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    return NextResponse.json(
      { error: "error interno", detail: message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireRole("admin");
  } catch (err) {
    return authErrorToResponse(err);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body debe ser JSON válido" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "body debe ser un objeto" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  // Validaciones
  if (typeof b.parcela_id !== "number" || !Number.isFinite(b.parcela_id) || b.parcela_id < 1) {
    return NextResponse.json(
      { error: "parcela_id es obligatorio y debe ser entero positivo" },
      { status: 400 }
    );
  }
  if (typeof b.start_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.start_date)) {
    return NextResponse.json(
      { error: "start_date es obligatorio con formato YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (b.end_date !== undefined && b.end_date !== null) {
    if (typeof b.end_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.end_date)) {
      return NextResponse.json(
        { error: "end_date debe tener formato YYYY-MM-DD o null" },
        { status: 400 }
      );
    }
  }
  if (b.crop_type !== undefined && b.crop_type !== null && typeof b.crop_type !== "string") {
    return NextResponse.json({ error: "crop_type debe ser string o null" }, { status: 400 });
  }
  if (b.variety !== undefined && b.variety !== null && typeof b.variety !== "string") {
    return NextResponse.json({ error: "variety debe ser string o null" }, { status: 400 });
  }

  try {
    const cycle = await createCycle({
      parcela_id: b.parcela_id,
      crop_type: typeof b.crop_type === "string" ? b.crop_type : null,
      variety: typeof b.variety === "string" ? b.variety : null,
      start_date: b.start_date,
      end_date: typeof b.end_date === "string" ? b.end_date : null,
      source: "manual",
      data_validity: "fresh"
    });
    return NextResponse.json({ cycle }, { status: 201 });
  } catch (err) {
    // 23503 = FK violation (parcela_id no existe)
    // 23514 = CHECK violation (end_date < start_date)
    if (err && typeof err === "object" && "code" in err) {
      const code = (err as { code?: string }).code;
      if (code === "23503") {
        return NextResponse.json(
          { error: "parcela_id no existe o está soft-deleted" },
          { status: 400 }
        );
      }
      if (code === "23514") {
        return NextResponse.json(
          { error: "end_date debe ser >= start_date" },
          { status: 400 }
        );
      }
    }
    const message = err instanceof Error ? err.message : "error desconocido";
    return NextResponse.json(
      { error: "error interno", detail: message },
      { status: 500 }
    );
  }
}

function authErrorToResponse(err: unknown): NextResponse {
  const code = err && typeof err === "object" && "code" in err
    ? (err as { code?: string }).code
    : undefined;
  if (code === "UNAUTHENTICATED") {
    return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  }
  if (code === "FORBIDDEN") {
    return NextResponse.json({ error: "sin permisos" }, { status: 403 });
  }
  return NextResponse.json({ error: "auth error" }, { status: 500 });
}
