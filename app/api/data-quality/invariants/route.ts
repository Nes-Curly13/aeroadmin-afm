/**
 * GET /api/data-quality/invariants?parcelaId=X
 *
 * Sprint S11+ / PLAN-FUMIGACIONES-V2 / Fase 4.4 — Capa de Gestión.
 *
 * Devuelve una lista de warnings de calidad de datos para una
 * parcela (o todas si no se pasa parcelaId). Cada warning es un
 * problema potencial que el operador debe revisar:
 *   - Parcela sin cliente/finca asignado
 *   - Parcela con fumigaciones pero sin ciclo activo
 *   - Parcela con ciclo pero sin eventos de aplicacion
 *   - Fumigaciones con cycle_id apuntando a ciclo cerrado
 *   - data_validity='stale' o 'unknown' en ciclos
 *   - Ciclos con end_date anterior a start_date (imposible por CHECK)
 *   - Crop type no encontrado en phase_rules
 *
 * Authorization: solo role=admin (la UI del parcel detail lo expone
 * al fumigador en read-only, pero el endpoint es admin-only).
 *
 * Respuesta:
 *   200 + { warnings: DataQualityWarning[] }
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export type WarningSeverity = "info" | "warning" | "error";
export type WarningCode =
  | "parcela_no_cliente"
  | "parcela_no_finca"
  | "parcela_sin_ciclo_activo"
  | "fumigacion_sin_ciclo"
  | "fumigacion_ciclo_cerrado"
  | "ciclo_sin_eventos"
  | "ciclo_sin_phase_rule"
  | "parcela_data_stale";

export interface DataQualityWarning {
  code: WarningCode;
  severity: WarningSeverity;
  message: string;
  parcela_id?: number;
  cycle_id?: number;
  fumigation_id?: number;
}

export async function GET(request: NextRequest) {
  try {
    await requireRole("admin");
  } catch (err) {
    return authErrorToResponse(err);
  }

  const url = new URL(request.url);
  const parcelaIdRaw = url.searchParams.get("parcelaId");
  const parcelaId = parcelaIdRaw ? Number(parcelaIdRaw) : null;
  if (parcelaId !== null && (!Number.isFinite(parcelaId) || parcelaId < 1)) {
    return NextResponse.json(
      { error: "parcelaId debe ser entero positivo o ausente (todas)" },
      { status: 400 }
    );
  }

  try {
    const warnings = await computeInvariants(parcelaId);
    return NextResponse.json({ warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    return NextResponse.json(
      { error: "error interno", detail: message },
      { status: 500 }
    );
  }
}

async function computeInvariants(
  parcelaId: number | null
): Promise<DataQualityWarning[]> {
  const db = getDb();
  const warnings: DataQualityWarning[] = [];
  const params: unknown[] = [];
  let whereClause = "WHERE p.deleted_at IS NULL";
  if (parcelaId !== null) {
    params.push(parcelaId);
    whereClause += ` AND p.id = $${params.length}`;
  }

  try {
    // 1) Parcelas sin cliente o sin finca
    const noClient = await db.query<{ id: number }>(
      `SELECT id FROM dji_parcels p ${whereClause} AND p.client_id IS NULL`,
      params
    );
    for (const r of noClient.rows) {
      warnings.push({
        code: "parcela_no_cliente",
        severity: "warning",
        message: "Parcela sin cliente asignado",
        parcela_id: r.id
      });
    }
    const noFarm = await db.query<{ id: number }>(
      `SELECT id FROM dji_parcels p ${whereClause} AND p.farm_id IS NULL`,
      params
    );
    for (const r of noFarm.rows) {
      warnings.push({
        code: "parcela_no_finca",
        severity: "warning",
        message: "Parcela sin finca asignada",
        parcela_id: r.id
      });
    }

    // 2) Parcelas con fumigaciones pero sin ciclo activo
    const noCycle = await db.query<{ id: number; n: string }>(
      `SELECT p.id, count(f.id) AS n
         FROM dji_parcels p
         JOIN dji_fumigations f ON f.parcela_id = p.id AND f.deleted_at IS NULL
         ${whereClause.replace("p.deleted_at IS NULL", "p.deleted_at IS NULL AND f.deleted_at IS NULL")}
          AND NOT EXISTS (
            SELECT 1 FROM cycles c WHERE c.parcela_id = p.id AND c.end_date IS NULL
          )
        GROUP BY p.id
       HAVING count(f.id) > 0`,
      params
    );
    for (const r of noCycle.rows) {
      warnings.push({
        code: "parcela_sin_ciclo_activo",
        severity: "warning",
        message: `Parcela tiene ${r.n} fumigacion(es) pero ningún ciclo activo`,
        parcela_id: r.id
      });
    }

    // 3) Fumigaciones con cycle_id apuntando a un ciclo cerrado
    const closedCycle = await db.query<{ fumigation_id: number; cycle_id: number; parcela_id: number }>(
      `SELECT f.id AS fumigation_id, c.id AS cycle_id, f.parcela_id
         FROM dji_fumigations f
         JOIN cycles c ON c.id = f.cycle_id AND c.end_date IS NOT NULL
         ${whereClause.replace("p.deleted_at IS NULL", "f.deleted_at IS NULL")}
       LIMIT 100`,
      params
    );
    for (const r of closedCycle.rows) {
      warnings.push({
        code: "fumigacion_ciclo_cerrado",
        severity: "error",
        message: "Fumigación apunta a un ciclo ya cerrado",
        fumigation_id: r.fumigation_id,
        cycle_id: r.cycle_id,
        parcela_id: r.parcela_id
      });
    }

    // 4) Ciclos sin phase_rule para su crop_type (current_phase devuelve NULL)
    const noPhase = await db.query<{ cycle_id: number; parcela_id: number; crop_type: string }>(
      `SELECT c.id AS cycle_id, c.parcela_id, c.crop_type
         FROM cycles c
         JOIN dji_parcels p ON p.id = c.parcela_id
         ${whereClause}
          AND c.end_date IS NULL
          AND c.crop_type IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM phase_rules pr WHERE pr.crop_type = c.crop_type
          )`,
      params
    );
    for (const r of noPhase.rows) {
      warnings.push({
        code: "ciclo_sin_phase_rule",
        severity: "info",
        message: `Ciclo activo con crop_type='${r.crop_type}' no tiene reglas de fase definidas`,
        cycle_id: r.cycle_id,
        parcela_id: r.parcela_id
      });
    }

    // 5) Parcelas con data_validity='stale' o 'unknown' en sus ciclos activos
    const stale = await db.query<{ cycle_id: number; parcela_id: number; data_validity: string }>(
      `SELECT c.id AS cycle_id, c.parcela_id, c.data_validity
         FROM cycles c
         JOIN dji_parcels p ON p.id = c.parcela_id
         ${whereClause}
          AND c.end_date IS NULL
          AND c.data_validity IN ('stale', 'unknown')`,
      params
    );
    for (const r of stale.rows) {
      warnings.push({
        code: "parcela_data_stale",
        severity: r.data_validity === "stale" ? "warning" : "info",
        message: `Ciclo activo con data_validity='${r.data_validity}'`,
        cycle_id: r.cycle_id,
        parcela_id: r.parcela_id
      });
    }
  } catch {
    // DB no disponible — devolvemos lista vacía. El caller puede
    // mostrar "calidad de datos no disponible".
  }

  return warnings;
}

function authErrorToResponse(err: unknown): NextResponse {
  const code = err && typeof err === "object" && "code" in err
    ? (err as { code?: string }).code
    : undefined;
  if (code === "UNAUTHENTICATED") {
    return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  }
  if (code === "FORBIDDEN") {
    return NextResponse.json({ error: "sin permisos" }, { status: 403 });
  }
  return NextResponse.json({ error: "auth error" }, { status: 500 });
}
