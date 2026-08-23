import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { importApplications as importFn } from "../../../../../scripts/import-applications-from-excel.js";

interface ImportOptionsInput {
  xlsxPath?: string;
  dryRun?: boolean;
  areaUnit?: "ha" | "m2" | null;
  minScore?: number;
  limit?: number | null;
  actorEmail?: string;
}

/**
 * POST /api/admin/applications/import
 *
 * Ejecuta el import del Excel del operador fumigador. Solo accesible
 * para role=admin.
 */
export const dynamic = "force-dynamic";

const DEFAULT_XLSX_PATH = "C:\\Users\\agFab\\Downloads\\Aplicaciones.xlsx";

export async function POST(req: NextRequest) {
  try {
    await requireRole("admin");
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status });
  }

  let body: ImportOptionsInput = {};
  try {
    body = await req.json();
  } catch {
    // body vacio OK
  }

  const opts = {
    xlsxPath: body.xlsxPath ?? DEFAULT_XLSX_PATH,
    dryRun: body.dryRun ?? false,
    areaUnit: body.areaUnit ?? null,
    minScore: body.minScore ?? 0.5,
    limit: body.limit ?? null,
    actorEmail: body.actorEmail ?? "admin@aeroadmin.local"
  };

  try {
    // Capturar stdout del script para devolver al cliente
    const originalLog = console.log;
    const logs: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(a => String(a)).join(" "));
    };
    try {
      await importFn(opts as Parameters<typeof importFn>[0]);
    } finally {
      console.log = originalLog;
    }
    return NextResponse.json({ ok: true, dryRun: opts.dryRun, logs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
