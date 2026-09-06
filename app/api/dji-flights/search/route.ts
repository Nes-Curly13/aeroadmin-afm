/**
 * GET /api/dji-flights/search
 *
 * Sprint S11+ Fase 2/5 — wizard de "Importar vuelo DJI".
 *
 * Devuelve los vuelos DJI (sorties del drone) que matchean una parcela
 * y un rango de fechas. Alimenta el componente `DjiFlightPicker` del
 * step 0 del wizard de nueva fumigación: el operator ve qué vuelos DJI
 * existen en la parcela/fecha elegida y puede auto-importar uno con
 * un click (pre-llena applied_at, duration, area, drone, pilot).
 *
 * Query params:
 *   - `parcelId` (number, REQUERIDO) — id de la parcela elegida.
 *   - `dateFrom` (YYYY-MM-DD, opcional) — inicio del rango. Default:
 *     30 días atrás.
 *   - `dateTo` (YYYY-MM-DD, opcional) — fin del rango. Default: hoy.
 *   - `limit` (number, opcional, default 20, max 50, min 1) — cap de
 *     resultados devueltos.
 *
 * Shape de respuesta (read-only, denormalizado para el picker):
 *   { flights: Array<{
 *       id: number;            // PK de dji_flights
 *       flight_id: number;     // DJI internal flight id
 *       drone_serial: string | null;
 *       drone_nickname: string | null;
 *       pilot_name: string | null;
 *       start_at: string;      // ISO timestamptz
 *       end_at: string;
 *       duration_seconds: number;
 *       area_m2: string | null;       // numeric → string
 *       spray_usage_ml: number | null;
 *       lng: string | null;          // numeric → string
 *       lat: string | null;
 *   }> }
 *
 * Auth: `requireRole(["admin", "supervisor"])` — el operator que
 * registra fumigaciones manuales y el admin pueden ver los vuelos.
 * La escritura (import) está en otros endpoints.
 *
 * Por qué NO en /api/admin/dji-flights/search: este endpoint no es
 * "admin" propiamente — es data cruda de DJI accesible también al
 * supervisor que está registrando fumigaciones. Mantenerlo en
 * /api/dji-flights/search (path de primer nivel) lo hace independiente
 * del namespace /admin/* y más fácil de reusar.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

interface FlightSearchRow {
  id: number;
  flight_id: number;
  drone_serial: string | null;
  drone_nickname: string | null;
  pilot_name: string | null;
  start_at: string;
  end_at: string;
  duration_seconds: number;
  area_m2: string | null;
  spray_usage_ml: number | null;
  lng: string | null;
  lat: string | null;
}

export async function GET(req: Request) {
  try {
    await requireRole(["admin", "supervisor"]);
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

  const url = new URL(req.url);
  const parcelIdRaw = url.searchParams.get("parcelId");
  const dateFromRaw = url.searchParams.get("dateFrom");
  const dateToRaw = url.searchParams.get("dateTo");
  const limitRaw = Number(url.searchParams.get("limit") ?? 20);

  // Validación parcelId — REQUERIDO, numérico, > 0
  if (!parcelIdRaw) {
    return NextResponse.json(
      { error: "parcelId es requerido" },
      { status: 400 }
    );
  }
  const parcelId = Number(parcelIdRaw);
  if (!Number.isFinite(parcelId) || !Number.isInteger(parcelId) || parcelId <= 0) {
    return NextResponse.json(
      { error: "parcelId debe ser un entero positivo" },
      { status: 400 }
    );
  }

  // dateFrom / dateTo: default = últimos 30 días
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  const isoDate = (d: Date) => d.toISOString().slice(0, 10); // YYYY-MM-DD
  const dateFrom = dateFromRaw ?? isoDate(thirtyDaysAgo);
  const dateTo = dateToRaw ?? isoDate(today);

  // Validación fechas si vinieron: YYYY-MM-DD
  const isoDateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (dateFromRaw && !isoDateRe.test(dateFromRaw)) {
    return NextResponse.json(
      { error: "dateFrom debe ser YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (dateToRaw && !isoDateRe.test(dateToRaw)) {
    return NextResponse.json(
      { error: "dateTo debe ser YYYY-MM-DD" },
      { status: 400 }
    );
  }

  // limit: clamp 1..50
  const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20));

  const db = getDb();
  try {
    // Query: filtrar por parcel_id + rango de fechas. No devolver
    // parcel_id en la respuesta (info redundante — el cliente ya sabe
    // cuál parcela eligió).
    //
    // Index usado: idx_dji_flights_parcel_date (parcel_id, start_at desc)
    // creado en la migration inicial. El rango por start_at es covered.
    const result = await db.query<FlightSearchRow>(
      `SELECT
          f.id,
          f.flight_id,
          f.drone_serial,
          f.drone_nickname,
          f.pilot_name,
          f.start_at,
          f.end_at,
          f.duration_seconds,
          f.area_m2,
          f.spray_usage_ml,
          f.lng,
          f.lat
         FROM dji_flights f
        WHERE f.parcel_id = $1
          AND f.start_at >= $2::date
          AND f.start_at < ($3::date + INTERVAL '1 day')
        ORDER BY f.start_at DESC
        LIMIT $4`,
      [parcelId, dateFrom, dateTo, limit]
    );
    return NextResponse.json({ flights: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
