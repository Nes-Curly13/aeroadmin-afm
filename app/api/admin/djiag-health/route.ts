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
 * Si el archivo no existe o está corrupto, devolvemos 200 con
 * status='unknown' en vez de 500. El panel puede mostrar "Sin
 * datos" sin romper.
 *
 * Path del archivo: relativo a process.cwd() (mismo que el script).
 *
 * Tests: tests/api-admin-djiag-health.test.ts cubre:
 *   - 401 / 403 (gate de role)
 *   - 200 con archivo válido (fresh + stale)
 *   - 200 con archivo ausente
 *   - 200 con archivo corrupto
 *   - warnings derivados
 *
 * Logica pura (read + derive) en `lib/djiag-health.ts` para que sea
 * testeable sin mockear `node:fs` (los dynamic imports en el route
 * handler son diffciles de interceptar con vitest).
 */

import path from "node:path";

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role";
import {
  deriveResponse,
  readHealthFile,
  type HealthResponse
} from "@/lib/djiag-health";

export const dynamic = "force-dynamic";

const HEALTH_FILE_RELATIVE = "djiag_exports/_health.json";

export async function GET(): Promise<NextResponse<HealthResponse | { error: string }>> {
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

  const filePath = path.join(process.cwd(), HEALTH_FILE_RELATIVE);
  const health = await readHealthFile(filePath);
  const response = deriveResponse(health);
  return NextResponse.json(response);
}
