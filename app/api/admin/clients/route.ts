/**
 * GET /api/admin/clients?q=&limit=
 * POST /api/admin/clients
 *
 * Sprint S11+ / PLAN-FUMIGACIONES-V2 / Fase 3.A.
 *
 * CRUD básico de clientes (entidad de primera clase, requisito
 * de tesis). El `getRecentParcelsForPicker` y otros call sites
 * ya consumen esta data.
 *
 * Authorization: solo role=admin. El gate de /admin/* en
 * `lib/auth.config.ts` filtra la UI; acá filtramos el endpoint
 * para evitar bypass con curl.
 *
 * GET responses:
 *   200 + { clients: Client[] }  — lista (default: top 10 por updated_at)
 *   401 / 403                      — auth
 *   500                            — DB caída
 *
 * POST body:
 *   { name: string, notes?: string, created_by_email: string }
 *
 * POST responses:
 *   201 + { client: Client }       — creado
 *   400 + { error: string }        — body inválido
 *   409 + { error: string }        — name duplicado (UNIQUE)
 *   401 / 403                      — auth
 *   500                            — error inesperado
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { searchClients, createClient } from "@/api/repositories";

export async function GET(request: NextRequest) {
  // Gate: solo admin puede listar clientes
  try {
    await requireRole("admin");
  } catch (err) {
    return authErrorToResponse(err);
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 10;

  try {
    const clients = await searchClients(q, limit);
    return NextResponse.json({ clients });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    return NextResponse.json(
      { error: "error interno", detail: message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Gate: solo admin puede crear clientes
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
  if (b.notes !== undefined && b.notes !== null && typeof b.notes !== "string") {
    return NextResponse.json(
      { error: "notes debe ser string o null" },
      { status: 400 }
    );
  }

  try {
    const client = await createClient({
      name: b.name,
      notes: typeof b.notes === "string" ? b.notes : null,
      created_by_email: b.created_by_email
    });
    return NextResponse.json({ client }, { status: 201 });
  } catch (err) {
    // 23505 = unique_violation (UNIQUE name) → 409
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      return NextResponse.json(
        { error: "Ya existe un cliente con ese nombre (case-insensitive)" },
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
