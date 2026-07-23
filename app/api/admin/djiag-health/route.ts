/**
 * GET /api/admin/djiag-health
 *
 * XS1 (audit 2026-07-22, docs/DJIAG_AUDIT.md H1).
 *
 * Endpoint de visibilidad operacional del scraper DJI AG. Lee
 * `djiag_exports/_health.json` (escrito por `scripts/run-pipeline.js`
 * al final de cada corrida) y reporta el estado al admin.
 *
 * Solo accesible para role 'admin' (gates de seguridad: el archivo
 * expone metadata operacional, no datos del cliente).
 *
 * Bypass para monitoring (Sprint C — H3b, 2026-07-23):
 *   - Si la env var `HEALTH_TOKEN` está configurada en el SERVER, el
 *     endpoint acepta también `Authorization: Bearer <HEALTH_TOKEN>`
 *     (mismo valor) o `?token=<HEALTH_TOKEN>` como query param. Esto
 *     permite que el GitHub Action watchdog (`.github/workflows/
 *     djiag-health-watchdog.yml`) llame al endpoint sin necesitar una
 *     sesión NextAuth de admin.
 *   - Si `HEALTH_TOKEN` NO está configurada en el server, el bearer
 *     siempre falla con 401 (no hay forma de "adivinarlo"). La sesión
 *     admin sigue siendo el path canónico para uso desde la UI.
 *   - El token es leído vía `timingSafeEqual` para evitar timing
 *     attacks (un string equality con `===` filtra info por timing).
 *   - Si la env var está configurada pero el cliente no la envía,
 *     cae al `requireRole('admin')` normal — backwards compatible
 *     con la UI existente.
 *
 * Si el archivo no existe o está corrupto, devolvemos 200 con
 * status='unknown' en vez de 500. El panel puede mostrar "Sin
 * datos" sin romper.
 *
 * Path del archivo: relativo a process.cwd() (mismo que el script).
 *
 * Tests: tests/api-admin-djiag-health.test.ts cubre:
 *   - 401 / 403 (gate de role, sin token)
 *   - 200 con token válido y server-token configurado
 *   - 401 con token inválido y server-token configurado
 *   - 200 admin con archivo válido (fresh + stale)
 *   - 200 admin con archivo ausente
 *   - 200 admin con archivo corrupto
 *   - warnings derivados
 *
 * Logica pura (read + derive) en `lib/djiag-health.ts` para que sea
 * testeable sin mockear `node:fs` (los dynamic imports en el route
 * handler son diffciles de interceptar con vitest).
 */

import path from "node:path";
import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/role";
import {
  deriveResponse,
  readHealthFile,
  type HealthResponse
} from "@/lib/djiag-health";

export const dynamic = "force-dynamic";

const HEALTH_FILE_RELATIVE = "djiag_exports/_health.json";

/**
 * Bypass opcional para monitoring externo (GitHub Action watchdog).
 *
 * Devuelve `true` si el caller presentó el HEALTH_TOKEN correcto.
 * Devuelve `false` si:
 *   - HEALTH_TOKEN no está configurada en el server (bypass deshabilitado)
 *   - el header Authorization no empieza con "Bearer "
 *   - el query param `?token=` está ausente
 *   - el token presentado no coincide (timing-safe compare)
 *
 * Si el server tiene HEALTH_TOKEN configurada y el caller NO envía
 * ningún token, este helper devuelve `false` y el caller debe seguir
 * con `requireRole('admin')` (backwards compat con la UI).
 */
function isMonitoringAuthorized(request: NextRequest): boolean {
  const serverToken = process.env.HEALTH_TOKEN;
  if (!serverToken || serverToken.length === 0) return false;

  // Aceptar Authorization: Bearer <token>
  const auth = request.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const presented = auth.slice("bearer ".length).trim();
    if (constantTimeEquals(presented, serverToken)) return true;
  }
  // Aceptar ?token=<token> (para healthchecks simples sin headers)
  const queryToken = request.nextUrl.searchParams.get("token") ?? "";
  if (queryToken.length > 0 && constantTimeEquals(queryToken, serverToken)) {
    return true;
  }
  return false;
}

/**
 * Comparación constant-time para evitar timing attacks. Si los strings
 * tienen distinta longitud, padding-eamos al más largo (también constant
 * time) — `timingSafeEqual` tira si los buffers tienen distinta length,
 * pero la longitud ya es información pública en este contexto.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const max = Math.max(a.length, b.length);
  const aBuf = Buffer.alloc(max, 0);
  const bBuf = Buffer.alloc(max, 0);
  aBuf.write(a);
  bBuf.write(b);
  let equal = a.length === b.length;
  // Buffer.compare + masking: si equal es false, igualamos los buffers
  // para que timingSafeEqual no falle por length mismatch.
  if (!equal) {
    aBuf.write(b);
    bBuf.write(a);
  }
  // timingSafeEqual retorna boolean — usamos AND con `equal` para que
  // longitudes distintas fallen por construcción, no por timing.
  return equal && timingSafeEqual(aBuf, bBuf);
}

export async function GET(
  request: NextRequest
): Promise<NextResponse<HealthResponse | { error: string }>> {
  // Bypass de monitoring (H3b): si el server tiene HEALTH_TOKEN y el
  // caller la presenta correctamente, saltea el guard de role. Esto
  // permite que el GitHub Action watchdog corra sin sesión NextAuth.
  if (!isMonitoringAuthorized(request)) {
    try {
      await requireRole("admin");
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "UNAUTHENTICATED") {
        return NextResponse.json({ error: "No autenticado." }, { status: 401 });
      }
      if (code === "FORBIDDEN") {
        return NextResponse.json(
          { error: "Solo administradores pueden ver la salud del scraper." },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Error de autorización." },
        { status: 500 }
      );
    }
  }

  const filePath = path.join(process.cwd(), HEALTH_FILE_RELATIVE);
  const health = await readHealthFile(filePath);
  const response = deriveResponse(health);
  return NextResponse.json(response);
}
