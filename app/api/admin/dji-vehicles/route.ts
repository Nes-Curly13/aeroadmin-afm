/**
 * GET  /api/admin/dji-vehicles  — búsqueda/listado para el `VehiclePicker`.
 * POST /api/admin/dji-vehicles  — crear (idempotente: si la placa ya
 *                                  existe, devuelve 200 con el row).
 *
 * Sprint S7 — feature/s7-schema-extension / Fase 1 (PR-B).
 * Alimenta el autocomplete del `VehiclePicker` (componente
 * `components/fumigations/vehicle-picker.tsx`).
 *
 * Auth: admin o supervisor (lectura/escritura controlada).
 * Catálogo curado: solo estos roles pueden crear vehículos
 * (no es self-service para el operador en modo "viewer" — pero
 * `AppRole` solo incluye admin/supervisor, así que en la práctica
 * coincide con requireRole).
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import {
  createDjiVehicle,
  findDjiVehicleByPlate,
  searchDjiVehicles
} from "@/api/repositories";

export const dynamic = "force-dynamic";

const PLATE_REGEX = /^[A-Z0-9-]{3,12}$/;

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
  const search = (url.searchParams.get("search") ?? "").trim();
  const limitRaw = Number(url.searchParams.get("limit") ?? 10);
  const limit = Math.min(
    50,
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 10)
  );

  try {
    // Si el query es < 1 char, searchDjiVehicles devuelve los N más
    // recientes (UX del picker: ver los recientes antes de tipear).
    const vehicles = await searchDjiVehicles(search, limit);
    return NextResponse.json({ vehicles });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body JSON inválido" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "body requerido" }, { status: 400 });
  }
  const { plate, description } = body as {
    plate?: unknown;
    description?: unknown;
  };

  if (typeof plate !== "string" || plate.trim().length < 1) {
    return NextResponse.json(
      { error: "plate requerido (string)" },
      { status: 400 }
    );
  }

  // Normalizar: trim + uppercase, igual que la BD.
  const normalized = plate.trim().toUpperCase();
  if (!PLATE_REGEX.test(normalized)) {
    return NextResponse.json(
      {
        error:
          "plate inválido. Formato: solo letras mayúsculas, números y guiones, 3-12 caracteres."
      },
      { status: 400 }
    );
  }

  // description es opcional
  let descNorm: string | null = null;
  if (description != null) {
    if (typeof description !== "string") {
      return NextResponse.json(
        { error: "description debe ser string o null" },
        { status: 400 }
      );
    }
    const d = description.trim();
    if (d.length > 200) {
      return NextResponse.json(
        { error: "description demasiado largo (max 200)" },
        { status: 400 }
      );
    }
    descNorm = d.length > 0 ? d : null;
  }

  try {
    // Idempotencia: si ya existe, devolvemos 200 con el row (no 409).
    // El form llama a este endpoint sin miedo a duplicados: si el
    // operador selecciona una sugerencia o tipea + Enter, ambos paths
    // convergen en "el vehículo queda registrado".
    const existing = await findDjiVehicleByPlate(normalized);
    if (existing) {
      // Si la descripción cambió y no es null, opcionalmente la
      // actualizamos? Decisión: NO. El primer creador manda. Si el
      // operador quiere corregir la descripción, lo hace en otro
      // endpoint de admin (no scope de este PR).
      return NextResponse.json({ vehicle: existing }, { status: 200 });
    }
    const created = await createDjiVehicle({
      plate: normalized,
      description: descNorm
    });
    return NextResponse.json({ vehicle: created }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
