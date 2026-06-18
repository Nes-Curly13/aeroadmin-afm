import { NextRequest, NextResponse } from "next/server";

import {
  createFumigationEvent,
  getFumigationEventsByParcel
} from "@/api/repositories";
import { parseIntParam } from "@/lib/request";

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
  recorded_by?: string;
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
 */
export async function POST(request: NextRequest) {
  try {
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

    const created = await createFumigationEvent({
      parcel_id: body.parcel_id,
      fumigation_date: body.fumigation_date,
      product_used: body.product_used,
      dose_l_per_ha: body.dose_l_per_ha,
      area_fumigated_m2: body.area_fumigated_m2,
      drone_code_used: body.drone_code_used,
      duration_minutes: body.duration_minutes,
      notes: body.notes,
      recorded_by: body.recorded_by
    });
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error al registrar fumigación."
      },
      { status: 500 }
    );
  }
}
