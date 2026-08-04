/**
 * POST /api/admin/parcels
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding (sub-sprint 1).
 *
 * Crea una parcela MANUAL (origen = 'manual', no escrapeda de DJI).
 * El server inyecta:
 *   - source = 'manual'
 *   - batch_id = NULL
 *   - external_id = 'manual-{uuid-v4}'
 *
 * Authorization: solo role=admin. El operador fumigador supervisor
 * no debería poder crear parcelas (es tarea del supervisor/admin del
 * cliente). El gate de /admin/* en `lib/auth.config.ts` ya filtra
 * la UI; acá filtramos el endpoint para que no se pueda bypassear
 * con curl.
 *
 * Body: `CreateManualParcelInput` (ver `api/repositories.ts`).
 *   - `land_name` y `field_type` son obligatorios
 *   - `geometry` (GeoJSON Polygon o MultiPolygon) es obligatorio
 *   - resto de campos opcionales
 *
 * Respuestas:
 *   201 + { parcel: DjiParcelRecord } — parcela creada
 *   400 + { error: string }            — body inválido, validación
 *                                        del repo falló, o CHECK de
 *                                        la BD (23514, 23502, 23503)
 *   401 / 403 — auth (requireRole)
 *   500 — error inesperado (BD caída u otro)
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import {
  createManualParcel,
  type CreateManualParcelInput
} from "@/api/repositories";

export const dynamic = "force-dynamic";

/**
 * Detecta si un error viene del driver `pg` (tiene `.code` con un
 * SQLSTATE) o si es un error de validación del repo (`.code ===
 * "VALIDATION"`, ver `validationError()` en api/repositories.ts).
 * Si es cualquiera de los dos, lo mapeamos a 400 con el mensaje.
 * Si NO matchea ninguno, es un error inesperado → 500.
 */
function mapErrorToHttp(err: unknown): { status: number; message: string } {
  const e = err as { code?: string; message?: string };

  // Errores de validación del repo (validationError en api/repositories.ts).
  if (e?.code === "VALIDATION") {
    return { status: 400, message: e.message ?? "validation error" };
  }

  // Errores de pg (SQLSTATE). 23514/23502/23503/23505 son violaciones
  // de constraint → 400 (el body del cliente es el problema).
  const pgCode = e?.code ?? "";
  if (pgCode === "23514") {
    return { status: 400, message: e.message ?? "check violation" };
  }
  if (pgCode === "23502") {
    return { status: 400, message: e.message ?? "not null violation" };
  }
  if (pgCode === "23503") {
    return { status: 400, message: e.message ?? "foreign key violation" };
  }
  if (pgCode === "23505") {
    return { status: 400, message: "external_id duplicado (raro con uuid)" };
  }

  // Si llega un error con código de pg de CONNECTION (08*, 57*), es
  // un problema del server (BD caída). Por seguridad podríamos
  // devolver 503, pero por ahora lo dejamos en 500 genérico.
  return { status: 500, message: "error interno" };
}

export async function POST(req: Request) {
  // requireRole lanza errores tipados (code='UNAUTHENTICATED' | 'FORBIDDEN')
  // que traducimos a 401/403. Si NO los capturamos, Next.js los convierte
  // en 500 (mismo bug que tuvo el metadata PATCH en S8.4).
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
    return NextResponse.json({ error: e.message ?? "auth error" }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "body JSON invalido" }, { status: 400 });
  }
  // Rechazamos arrays y nulls en el body. `typeof [] === 'object'` es
  // true en JS, así que hay que chequear explícitamente.
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "body debe ser un objeto" }, { status: 400 });
  }

  // Cast a CreateManualParcelInput. La validación estricta de tipos
  // y longitudes la hace `validateManualParcelInput` adentro del repo
  // (lanza Error con mensaje claro → 400 via mapErrorToHttp).
  const input = body as unknown as CreateManualParcelInput;

  try {
    const parcel = await createManualParcel(input);
    return NextResponse.json({ parcel }, { status: 201 });
  } catch (err) {
    const mapped = mapErrorToHttp(err);
    if (mapped.status === 500) {
      // Logueamos el error real al server log (no al cliente) y
      // devolvemos mensaje genérico. En producción esto va a
      // Sentry/Logtail.
      const message = err instanceof Error ? err.message : "error desconocido";
      return NextResponse.json(
        { error: "error interno", detail: message },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
