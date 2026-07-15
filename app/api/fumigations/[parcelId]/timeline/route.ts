// app/api/fumigations/[parcelId]/timeline/route.ts
//
// GET /api/fumigations/[parcelId]/timeline
//
// M7 (roadmap mediano plazo) — vista de timeline de fumigaciones por parcela.
// Devuelve el historial completo de una parcela en un rango de fechas:
//   - `events`: FumigationEvent[] (orden ascendente)
//   - `summary`: contadores + byMonth + cadencia observada/esperada + gaps
//   - `parcel` + `schedule` + `dateRange`: contexto extra para la UI
//
// Query params (todos opcionales):
//   - from: YYYY-MM-DD (default: hace 6 meses)
//   - to:   YYYY-MM-DD (default: hoy)
//
// Status codes:
//   - 200: OK (incluso si la parcela no tiene fumigaciones — events=[])
//   - 400: input inválido (parcelId no numérico, fechas mal formadas, from > to)
//   - 401: sin sesión (requireAuth)
//   - 404: la parcela no existe
//   - 500: BD falla
//
// Cache: NO cacheamos (M7 — datos operativos frescos, misma decisión
// que Task History. La UI de operaciones fumigadoras siempre ve data al día).
//
// Auth: requireAuth() (a diferencia de /api/task-history, este endpoint
// expone data de UNA parcela — scope de operación, no agregado del operador).

import { NextRequest, NextResponse } from "next/server";

import {
  getFumigationSchedule,
  getFumigationTimelineForParcel,
  getParcelById
} from "@/api/repositories";
import { requireAuth } from "@/lib/auth";
import { buildFumigationTimeline } from "@/lib/fumigation-timeline";
import { parseIntParam } from "@/lib/request";

export const dynamic = "force-dynamic";

/** Default: ventana de 6 meses si el caller no pasa `from`/`to`. */
const DEFAULT_WINDOW_DAYS = 183;

/**
 * Parsea y valida una fecha YYYY-MM-DD. Devuelve { ok: true, value: "" } si
 * el input es null/empty (usar default). 400 si el formato no matchea o la
 * fecha es calendar-inválida (ej. 2026-02-31).
 */
function parseIsoDate(
  value: string | null
): { ok: true; value: string } | { ok: false; error: string } {
  if (value === null || value.trim() === "") {
    return { ok: true, value: "" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, error: "Date must be YYYY-MM-DD." };
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    return { ok: false, error: "Invalid date (calendar mismatch)." };
  }
  return { ok: true, value };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

interface TimelineResponse {
  parcel: Awaited<ReturnType<typeof getParcelById>>;
  schedule: Awaited<ReturnType<typeof getFumigationSchedule>>;
  dateRange: { from: string; to: string };
  events: ReturnType<typeof buildFumigationTimeline>["events"];
  summary: ReturnType<typeof buildFumigationTimeline>["summary"];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ parcelId: string }> }
) {
  try {
    // ---- Auth ----
    // requireAuth() lanza error tipado con status=401 si no hay sesión.
    // Lo capturamos en el catch y devolvemos 401 con el mensaje.
    try {
      await requireAuth();
    } catch (authErr) {
      const status =
        (authErr as { status?: number }).status === 401 ? 401 : 500;
      return NextResponse.json(
        { error: (authErr as Error).message || "UNAUTHENTICATED" },
        { status }
      );
    }

    // ---- Validate parcelId ----
    const { parcelId: rawId } = await params;
    const idParsed = parseIntParam(rawId, "parcelId", 1);
    if ("error" in idParsed) {
      return NextResponse.json({ error: idParsed.error }, { status: 400 });
    }
    const parcelId = idParsed.value;

    // ---- Validate date range ----
    const url = request.nextUrl;
    const fromParsed = parseIsoDate(url.searchParams.get("from"));
    if (!fromParsed.ok) {
      return NextResponse.json({ error: `from: ${fromParsed.error}` }, { status: 400 });
    }
    const toParsed = parseIsoDate(url.searchParams.get("to"));
    if (!toParsed.ok) {
      return NextResponse.json({ error: `to: ${toParsed.error}` }, { status: 400 });
    }
    const to = toParsed.value || todayIso();
    const from = fromParsed.value || daysAgoIso(DEFAULT_WINDOW_DAYS);
    if (from > to) {
      return NextResponse.json(
        { error: "from must be <= to." },
        { status: 400 }
      );
    }

    // ---- Check parcel exists (404) ----
    const parcel = await getParcelById(parcelId);
    if (!parcel) {
      return NextResponse.json({ error: "Parcel not found." }, { status: 404 });
    }

    // ---- Fetch schedule + events in parallel ----
    const [schedule, events] = await Promise.all([
      getFumigationSchedule(parcelId),
      getFumigationTimelineForParcel(parcelId, from, to)
    ]);

    // ---- Build timeline (pure function) ----
    const timeline = buildFumigationTimeline({
      parcelId,
      from,
      to,
      expectedCadenceDays: schedule?.recommended_cadence_days ?? null,
      events
    });

    const body: TimelineResponse = {
      parcel,
      schedule,
      dateRange: { from, to },
      events: timeline.events,
      summary: timeline.summary
    };
    return NextResponse.json(body);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch fumigation timeline.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
