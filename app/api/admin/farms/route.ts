/**
 * GET /api/admin/farms?q=&clientId=&limit=
 * POST /api/admin/farms
 *
 * Sprint S11+ / PLAN-FUMIGACIONES-V2 / Fase 3.A.
 *
 * CRUD básico de farms. Cada farm pertenece a un client.
 *
 * Authorization: solo role=admin (gate /admin/* + requireRole).
 *
 * GET responses:
 *   200 + { farms: Farm[] }
 *   401 / 403 — auth
 *   500 — DB caída
 *
 * POST body:
 *   { client_id: number, name: string, municipality?: string,
 *     department?: string, created_by_email: string }
 *
 * POST responses:
 *   201 + { farm: Farm }        — creado
 *   400 + { error: string }     — body inválido
 *   409 + { error: string }     — (client_id, name) duplicado
 *   401 / 403 — auth
 *   500 — error inesperado
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { searchFarms, createFarm } from "@/api/repositories";

export async function GET(request: NextRequest) {
  try {
    await requireRole("admin");
  } catch (err) {
    return authErrorToResponse(err);
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const clientIdRaw = url.searchParams.get("clientId");
  const clientId = clientIdRaw ? Number(clientIdRaw) : null;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 10;

  try {
    const farms = await searchFarms(q, {
      clientId: Number.isFinite(clientId) ? clientId : null,
      limit
    });
    return NextResponse.json({ farms });
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
  if (typeof b.client_id !== "number" || !Number.isFinite(b.client_id) || b.client_id < 1) {
    return NextResponse.json(
      { error: "client_id es obligatorio y debe ser número positivo" },
      { status: 400 }
    );
  }
  if (typeof b.name !== "string" || b.name.trim().length < 1) {
    return NextResponse.json(
      { error: "name es obligatorio y debe ser string no vacío" },
      { status: 400 }
    );
  }
  if (typeof b.created_by_email !== "string" || b.created_by_email.length < 1) {
    return NextResponse.json(
      { error: "created_by_email es obligatorio" },
      { status: 400 }
    );
  }
  if (b.municipality !== undefined && b.municipality !== null && typeof b.municipality !== "string") {
    return NextResponse.json(
      { error: "municipality debe ser string o null" },
      { status: 400 }
    );
  }
  if (b.department !== undefined && b.department !== null && typeof b.department !== "string") {
    return NextResponse.json(
      { error: "department debe ser string o null" },
      { status: 400 }
    );
  }

  try {
    const farm = await createFarm({
      client_id: b.client_id,
      name: b.name,
      municipality: typeof b.municipality === "string" ? b.municipality : null,
      department: typeof b.department === "string" ? b.department : null,
      created_by_email: b.created_by_email
    });
    return NextResponse.json({ farm }, { status: 201 });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      return NextResponse.json(
        { error: "Ya existe una farm con ese nombre para ese cliente" },
        { status: 409 }
      );
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
