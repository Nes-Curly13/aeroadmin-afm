/**
 * GET /api/admin/djiag-health
 *
 * Endpoint admin que devuelve el health del pipeline DJI AG. Consumido
 * por:
 *   - UI admin (sesión admin requerida; el panel lo consume vía
 *     `lib/djiag-health.ts#readHealthFromDb` que es server-only)
 *   - Watchdog externo (`scripts/health-watchdog.js` + GH Action
 *     `.github/workflows/djiag-health-watchdog.yml`) que corre cada
 *     6h y alerta si el scraper lleva >24h sin sync exitosa.
 *
 * Auth: doble gate, ambos invisibles para el caller correcto.
 *   1. **HEALTH_TOKEN bypass**: si el server tiene `HEALTH_TOKEN`
 *      configurado y la request trae `Authorization: Bearer <HEALTH_TOKEN>`,
 *      se permite sin chequear sesión. Es para el watchdog CLI que
 *      no puede mantener sesión de NextAuth.
 *   2. **Session admin**: si el bypass no aplica (o el server no tiene
 *      HEALTH_TOKEN configurado), se requiere sesión con role=admin.
 *      Mismo patrón que el route handler de parcels metadata.
 *
 * Lectura: serverless-friendly. Intenta primero leer de la tabla
 * `djiag_health` (incluyendo la nueva columna `circuit_breaker` agregada
 * en la migration 20260802000000). Si la tabla no existe (migration
 * no aplicada) o la query falla, cae al filesystem
 * `djiag_exports/_health.json` (dev local). El filesystem sigue
 * siendo la fuente operativa en dev; la DB es la fuente en Vercel.
 *
 * Respuestas:
 *   200 + HealthResponse — health leído OK (de DB o filesystem)
 *   401 + { error: "no autenticado" } — sin session y sin HEALTH_TOKEN
 *   403 + { error: "rol insuficiente" } — session pero role ≠ admin
 *   500 — error inesperado (DB caída, etc.)
 *
 * Sprint 2026-08-02: este endpoint era deuda pendiente del audit
 * original. Estaba documentado en `docs/HEALTH-WATCHDOG.md` y en
 * el script `scripts/health-watchdog.js` como el consumer del
 * bypass, pero el archivo nunca se creó en `app/api/admin/`. El
 * workflow GH `.github/workflows/djiag-health-watchdog.yml` y el
 * script CLI lo llaman con curl → 404 hasta hoy.
 */
import { join } from "node:path";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { getDb } from "@/lib/db";
import {
  deriveResponse,
  readHealthFile,
  readHealthFromDb,
  type HealthResponse,
  type PipelineHealth
} from "@/lib/djiag-health";

// El endpoint NUNCA se cachea. Cada request es una query fresca
// a la DB (o filesystem) — el panel admin y el watchdog quieren
// el state actual, no algo de hace 5min.
export const dynamic = "force-dynamic";

/**
 * Compara dos strings en tiempo constante. Evita el timing attack
 * clásico donde un attacker mide el tiempo de respuesta para adivinar
 * el token byte a byte. Para strings cortas (<64 chars) el overhead
 * es despreciable.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Verifica si la request trae un `Authorization: Bearer <HEALTH_TOKEN>`
 * que matchee el env var del server. Si el server NO tiene
 * `HEALTH_TOKEN` configurado, devuelve `false` (no se puede validar
 * un token contra nada → rechazar el bypass). El caller cae al
 * requireRole admin.
 */
function isWatchdogAuthorized(req: Request): boolean {
  const expected = process.env.HEALTH_TOKEN;
  if (!expected || expected.length === 0) return false;
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  // Aceptamos case-insensitive en el prefijo "Bearer" (RFC 7235 lo
  // permite, pero algunos clients lo mandan en minúscula).
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  return timingSafeEqual(m[1].trim(), expected);
}

/**
 * Lee el health. Estrategia: DB primero (serverless-compatible),
 * filesystem como fallback. El fallback permite que dev local con
 * migration no aplicada siga mostrando el health (del filesystem
 * que el pipeline mantiene).
 *
 * El shape retornado es `PipelineHealth` (la fuente cruda). El caller
 * le aplica `deriveResponse()` para obtener el `HealthResponse` que
 * la UI consume (con `status` derivado, `hoursSinceLastSync` calculado,
 * etc.).
 */
async function readHealth(): Promise<PipelineHealth | null> {
  // 1) DB primero.
  try {
    const pool = getDb();
    const fromDb = await readHealthFromDb(pool);
    if (fromDb) return fromDb;
  } catch (err) {
    // No fallar el endpoint. Logueamos y caemos al filesystem.
    // El caller va a mostrar `status: "unknown"` igual.
    // eslint-disable-next-line no-console
    console.warn(
      "[djiag-health/route] readHealthFromDb falló, intentando filesystem:",
      err instanceof Error ? err.message : String(err)
    );
  }
  // 2) Fallback al filesystem.
  const filePath = join(process.cwd(), "djiag_exports", "_health.json");
  return await readHealthFile(filePath);
}

export async function GET(req: Request) {
  // Gate 1: bypass por HEALTH_TOKEN (para el watchdog CLI).
  // Si el server no tiene HEALTH_TOKEN configurado, isWatchdogAuthorized
  // devuelve false y caemos al requireRole.
  if (!isWatchdogAuthorized(req)) {
    // Gate 2: sesión admin (para la UI).
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
      return NextResponse.json(
        { error: e.message ?? "auth error" },
        { status: 500 }
      );
    }
  }

  const health = await readHealth();
  const response: HealthResponse = deriveResponse(health);
  return NextResponse.json(response);
}
