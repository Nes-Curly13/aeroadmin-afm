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
 *   400 + { error: string, issues?: [...] }  — body inválido (zod)
 *   409 + { error: string }        — name duplicado (UNIQUE)
 *   401 / 403                      — auth
 *   500                            — error inesperado
 *
 * Sprint S11+ / zod PR #2 — body validation via createClientBodySchema
 * (lib/api-schemas.ts). Reemplaza 18 lines de if-checks manuales.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { searchClients, createClient } from "@/api/repositories";
import { createClientBodySchema, formatZodIssues } from "@/lib/api-schemas";
import type { CreateClientBody } from "@/lib/api-schemas";

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

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "body debe ser JSON válido" }, { status: 400 });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json({ error: "body debe ser un objeto" }, { status: 400 });
  }

  // Sprint S11+ / zod PR #2 — schema validation reemplaza if-checks
  const parsed = createClientBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(formatZodIssues(parsed.error), { status: 400 });
  }
  const b: CreateClientBody = parsed.data;

  try {
    const client = await createClient({
      name: b.name,
      notes: b.notes,
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
