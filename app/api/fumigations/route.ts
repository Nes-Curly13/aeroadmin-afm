import { NextRequest, NextResponse } from "next/server";

import {
  createFumigationEvent,
  getFumigationEventsByParcel
} from "@/api/repositories";
import { parseIntParam } from "@/lib/request";
import { requireRole } from "@/lib/auth/role";

export const dynamic = "force-dynamic";

interface CreateFumigationBody {
  parcel_id: number;
  fumigation_date: string; // YYYY-MM-DD
  product_used?: string;
  dose_l_per_ha?: number;
  area_fumigated_m2?: number;
  drone_code_used?: number;
  duration_minutes?: number;
  notes?: string;
  /**
   * Nota libre del operador fumigador ("lluvia matinal", "producto nuevo",
   * etc.). Separada de `notes` que es provenance del backfill (JSON técnico,
   * no visible al usuario). Track C v1.4 — audit ui-ux-2026-07 #11.
   */
  human_notes?: string;
  recorded_by?: string;
  /**
   * Compliance metadata (Sprint C — H2, 2026-07-23). Texto libre
   * con formato validado por CHECK constraint en la BD.
   *   - product_registered_ica: ej "ICA-1234-PN" (registro ICA del producto)
   *   - pilot_license:            ej "PCA-12345"  (licencia Aerocivil del piloto)
   *
   * El server NO re-valida el formato (eso lo hace la BD) — solo valida
   * tipo y longitud para no tumbar el handler con un input gigante.
   */
  product_registered_ica?: string;
  pilot_license?: string;
}

// Límites de longitud por campo (sprint Q4 / track C, mejora 3, 2026-07-20).
// Defense in depth: las columnas SQL son text sin limite, pero un input
// de 1MB rompe JSON.parse y tumba el handler. La validación es del server
// (el cliente tambien tiene maxLength en el form, pero es solo UX).
// Alineado con la convencion del repo: PUT /api/parcels/[id] usa 200
// para land_name, 64 para field_type. Aca: 200 para product_used,
// 2000 para notes y human_notes, 100 para recorded_by.
//
// Compliance (H2): product_registered_ica max 50 (alineado con CHECK BD),
// pilot_license max 20 (alineado con CHECK BD `^[A-Z0-9-]{4,20}$`).
const MAX_LENGTHS = {
  product_used: 200,
  notes: 2000,
  human_notes: 2000,
  recorded_by: 100,
  product_registered_ica: 50,
  pilot_license: 20
} as const;

/**
 * Valida tipo y longitud de un campo string opcional. Devuelve
 * NextResponse con 400 si falla, o `null` si todo OK.
 */
function validateOptionalString(
  value: unknown,
  fieldName: keyof typeof MAX_LENGTHS
): NextResponse | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    return NextResponse.json(
      { error: `${fieldName} debe ser string o null.` },
      { status: 400 }
    );
  }
  const max = MAX_LENGTHS[fieldName];
  if (value.length > max) {
    return NextResponse.json(
      { error: `${fieldName} max ${max} chars (recibido: ${value.length}).` },
      { status: 400 }
    );
  }
  return null;
}

/**
 * GET /api/fumigations?parcelId=N
 * Devuelve los eventos de fumigación de una parcela, ordenados desc.
 */
export async function GET(request: NextRequest) {
  try {
    const rawParcelId = request.nextUrl.searchParams.get("parcelId");
    const parsed = parseIntParam(rawParcelId ?? "", "parcelId", 1);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const events = await getFumigationEventsByParcel(parsed.value);
    return NextResponse.json({ data: events, total: events.length });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error al obtener fumigaciones."
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/fumigations
 * Registra un nuevo evento de fumigación para una parcela.
 * Recalcula automáticamente `next_due_date` en el schedule.
 *
 * v1.4 Track A: guard de role. Tanto admin como supervisor pueden
 * registrar fumigaciones propias (el supervisor es operario de
 * campo, no solo consulta). El guard es solo demostracion del
 * sistema RBAC; el resto de endpoints no se toca en este PR para
 * mantener el scope (<25 min, decision PO 2026-07-21).
 *
 * futuro: aplicar este patron a todos los endpoints criticos
 * (cambiar-password, editar cadencia, etc.). En este PR se deja
 * solo el de fumigations como ejemplo verificable.
 */
export async function POST(request: NextRequest) {
  try {
    // Guard de role (v1.4 Track A). 401 si no hay sesion, 403 si
    // el role no es admin ni supervisor. El try/catch exterior
    // traduce los errores tipados a 401/403.
    await requireRole(["admin", "supervisor"]);

    const body = (await request.json()) as CreateFumigationBody;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Body JSON requerido." }, { status: 400 });
    }
    if (typeof body.parcel_id !== "number" || body.parcel_id < 1) {
      return NextResponse.json({ error: "parcel_id requerido (entero >= 1)." }, { status: 400 });
    }
    if (typeof body.fumigation_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.fumigation_date)) {
      return NextResponse.json({ error: "fumigation_date requerido (YYYY-MM-DD)." }, { status: 400 });
    }

    // Validacion de longitud (sprint Q4 / track C, mejora 3). Orden:
    // primero tipo, despues longitud. Si el campo es null/undefined
    // (opcional) se acepta. `human_notes` se valida junto a los demás
    // (Track C v1.4): misma regla de longitud que `notes` (2000 chars).
    // Compliance (H2): product_registered_ica + pilot_license con
    // longitudes alineadas a CHECK constraints de la BD.
    for (const field of [
      "product_used",
      "notes",
      "human_notes",
      "recorded_by",
      "product_registered_ica",
      "pilot_license"
    ] as const) {
      const err = validateOptionalString(body[field], field);
      if (err) return err;
    }

    const created = await createFumigationEvent({
      parcel_id: body.parcel_id,
      fumigation_date: body.fumigation_date,
      product_used: body.product_used,
      dose_l_per_ha: body.dose_l_per_ha,
      area_fumigated_m2: body.area_fumigated_m2,
      drone_code_used: body.drone_code_used,
      duration_minutes: body.duration_minutes,
      notes: body.notes,
      human_notes: body.human_notes,
      recorded_by: body.recorded_by,
      product_registered_ica: body.product_registered_ica,
      pilot_license: body.pilot_license
    });
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    // Traduccion de errores tipados de `requireRole` (v1.4 Track A).
    // Patron consistente con app/api/auth/change-password/route.ts.
    const code = (error as { code?: string }).code;
    if (code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }
    if (code === "FORBIDDEN") {
      return NextResponse.json(
        { error: "No tiene permisos para registrar fumigaciones." },
        { status: 403 }
      );
    }
    // Sprint C — H2: cuando el INSERT falla por un CHECK constraint
    // (ej: pilot_license con formato inválido), pg tira un error con
    // `code: '23514'`. Mapeamos a 400 con un mensaje claro para que
    // el frontend pueda mostrar el error al operador.
    const pgCode = (error as { code?: string }).code;
    const pgMessage = error instanceof Error ? error.message : String(error);
    if (pgCode === "23514" || /check constraint/i.test(pgMessage)) {
      // Extraemos el nombre del CHECK del mensaje para ayudar al debug.
      // Formato típico: 'new row for relation "dji_fumigations" violates
      // check constraint "dji_fumigations_pilot_license_check"'.
      const m = pgMessage.match(/check constraint "([^"]+)"/i);
      const constraint = m ? m[1] : "desconocido";
      return NextResponse.json(
        {
          error: `Valor inválido para un campo de compliance (${constraint}). ` +
            `Verificá el formato (ej: ICA "ICA-1234-PN", piloto "PCA-12345").`
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error al registrar fumigación."
      },
      { status: 500 }
    );
  }
}
