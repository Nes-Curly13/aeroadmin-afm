import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { auth } from "@/lib/auth";
import { importApplications as importFn } from "../../../../../scripts/import-applications-from-excel.js";
import { clientSafeErrorMessage } from "@/lib/api-error";

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
 *
 * Seguridad (auditoría 2026-09-10):
 *   - `xlsxPath` es requerido y debe apuntar a un .xlsx/.xls (previene
 *     lectura arbitraria de archivos del server, ej. /etc/passwd).
 *   - `actorEmail` se deriva de la sesión (NO del body) para evitar
 *     suplantación de autoría en el audit log.
 *   - Se eliminó el path hardcodeado con PII del dev.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireRole("admin");
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status });
  }

  const session = await auth();
  const actorEmail = session?.user?.email?.trim() || null;

  let body: ImportOptionsInput = {};
  try {
    body = await req.json();
  } catch {
    // body vacio OK
  }

  const xlsxPath = typeof body.xlsxPath === "string" ? body.xlsxPath.trim() : "";
  if (!xlsxPath) {
    return NextResponse.json(
      { ok: false, error: "xlsxPath es requerido (ruta del archivo .xlsx en el server)" },
      { status: 400 }
    );
  }
  if (!/\.xlsx?$/i.test(xlsxPath)) {
    return NextResponse.json(
      { ok: false, error: "xlsxPath debe apuntar a un archivo .xlsx o .xls" },
      { status: 400 }
    );
  }

  const opts = {
    xlsxPath,
    dryRun: body.dryRun ?? false,
    areaUnit: body.areaUnit ?? null,
    minScore: body.minScore ?? 0.5,
    limit: body.limit ?? null,
    actorEmail: actorEmail ?? "admin@aeroadmin.local"
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
    // 2026-09-10 (issue #28): NO filtrar `err.message` al cliente.
    const message = clientSafeErrorMessage(
      err,
      "error al importar aplicaciones",
      "POST /api/admin/applications/import"
    );
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
