/**
 * POST /api/admin/backfill-fumigations
 *
 * Sprint H2 — Full auto: la app sincroniza sola.
 *
 * Recalcula fumigaciones per-parcel desde dji_flights (vía
 * `backfillFumigationsFromFlights`) y actualiza
 * `dji_fumigation_schedule` (vía `updateFumigationSchedule`),
 * todo en una sola transacción.
 *
 * El pipeline CLI (`scripts/run-pipeline.js`) llama a este endpoint
 * vía HTTP al final del import (step 6) en vez de ejecutar los
 * scripts `.js` locales. El resultado: si el Next.js server está
 * vivo, los datos derivados se mantienen sincronizados
 * automáticamente — sin necesidad de correr `refresh-fumigations.js`
 * a mano después.
 *
 * Autorización (defensa en profundidad, mismo patrón que
 * `/api/admin/djiag-health` con `HEALTH_TOKEN`):
 *   1. Sesión NextAuth con role 'admin' (path canónico, uso desde UI).
 *   2. **O** Bearer `BACKFILL_TOKEN` vía `Authorization: Bearer <token>`
 *      si el server tiene `BACKFILL_TOKEN` configurada. Esto permite
 *      que el CLI (sin sesión) llame al endpoint de forma
 *      unattended. Si la env var NO está configurada en el server,
 *      el bearer siempre falla con 401 — la sesión admin sigue
 *      siendo el único path.
 *
 * Variables de entorno:
 *   - `BACKFILL_TOKEN` (server): token compartido con el CLI. Si
 *     está vacío o ausente, el bypass de Bearer queda deshabilitado.
 *   - `BACKFILL_URL` (CLI): URL del Next.js (default
 *     `http://localhost:3000` en dev, URL de Vercel en prod).
 *
 * Respuesta: { backfilled, deleted, scheduleUpdated, durationMs }
 * Status codes:
 *   - 200: OK
 *   - 401: sin sesión y sin bearer válido
 *   - 403: sesión sin role admin
 *   - 500: error de BD (transaction rolled back)
 */

import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/role";
import { refreshFumigationsInTransaction } from "@/lib/backfill/refresh-fumigations";

export const dynamic = "force-dynamic";
// Endpoint pesado (transacción sobre dji_flights + dji_fumigations +
// dji_fumigation_schedule). Por defecto corre en Node runtime.
export const runtime = "nodejs";

/**
 * Bypass opcional para el CLI (mismo patrón que `djiag-health` con
 * `HEALTH_TOKEN`).
 *
 * Devuelve `true` si el caller presentó el `BACKFILL_TOKEN` correcto.
 * Devuelve `false` si:
 *   - `BACKFILL_TOKEN` no está configurada en el server (bypass
 *     deshabilitado, el caller debe tener sesión admin)
 *   - el header Authorization no empieza con "Bearer "
 *   - el token presentado no coincide (timing-safe compare)
 */
function isBearerTokenAuthorized(request: NextRequest): boolean {
  const serverToken = process.env.BACKFILL_TOKEN;
  if (!serverToken || serverToken.length === 0) return false;

  const auth = request.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return false;
  const presented = auth.slice("bearer ".length).trim();
  return constantTimeEquals(presented, serverToken);
}

/**
 * Comparación constant-time para evitar timing attacks. Mismo
 * patrón que `djiag-health`.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const max = Math.max(a.length, b.length);
  const aBuf = Buffer.alloc(max, 0);
  const bBuf = Buffer.alloc(max, 0);
  aBuf.write(a);
  bBuf.write(b);
  let equal = a.length === b.length;
  if (!equal) {
    aBuf.write(b);
    bBuf.write(a);
  }
  return equal && timingSafeEqual(aBuf, bBuf);
}

export async function POST(request: NextRequest) {
  // Bearer bypass (CLI unattended). Si está OK, saltamos el guard
  // de role. Si no, caemos al path canónico de sesión admin.
  if (!isBearerTokenAuthorized(request)) {
    try {
      await requireRole("admin");
    } catch (err) {
      // `requireRole` tira errores con `code` semántico
      // (`UNAUTHENTICATED` o `FORBIDDEN`). Mapeamos a HTTP status
      // codes consistentes. Si el code no matchea, devolvemos 500
      // (algo se rompió en el guard, no un error de auth del cliente).
      const code = (err as { code?: string }).code;
      if (code === "UNAUTHENTICATED") {
        return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
      }
      if (code === "FORBIDDEN") {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
      return NextResponse.json(
        { error: code ?? "INTERNAL" },
        { status: 500 }
      );
    }
  }

  try {
    const stats = await refreshFumigationsInTransaction();
    return NextResponse.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "BACKFILL_FAILED", message },
      { status: 500 }
    );
  }
}
