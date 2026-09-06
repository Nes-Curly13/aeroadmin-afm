// app/(auth)/admin/calidad/page.tsx
//
// Sprint S11+ / PLAN-FUMIGACIONES-V2 / Fase 4.4.1 — Capa de Gestión.
//
// Página de admin: muestra TODOS los warnings de calidad de datos
// (sin filtrar por parcela). Útil para auditar el dataset completo.
//
// Consume `GET /api/data-quality/invariants` (sin parcelaId = todos).
// Server component — el endpoint es admin-only y la página está
// protegida por el route group (auth) + el handler que valida role.
//
// Layout:
//   - KPIs arriba: total warnings, parcelas afectadas, # por severidad
//   - Lista agrupada por parcela: para cada parcela con warnings,
//     una card con el nombre, link al detail, y los mensajes.

import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/role";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

interface DataQualityWarning {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  parcela_id?: number;
  cycle_id?: number;
  fumigation_id?: number;
}

async function fetchAllWarnings(): Promise<DataQualityWarning[]> {
  // Reutilizamos el endpoint HTTP para tener una única fuente de
  // verdad (no duplicamos la lógica de computeInvariants). El
  // endpoint es admin-only y esta página está protegida por
  // requireRole("admin") más arriba, así que el rol se valida 2x.
  // Hacemos el fetch desde server — si falla (DB caída, etc.)
  // devolvemos [] y la UI muestra "0 warnings" (no rompemos).
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  try {
    const res = await fetch(`${baseUrl}/api/data-quality/invariants`, {
      cache: "no-store"
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { warnings: DataQualityWarning[] };
    return data.warnings ?? [];
  } catch {
    return [];
  }
}

export default async function CalidadDatosPage() {
  await requireRole("admin");
  const warnings = await fetchAllWarnings();

  // Conteos por severidad.
  const bySeverity = {
    error: warnings.filter((w) => w.severity === "error").length,
    warning: warnings.filter((w) => w.severity === "warning").length,
    info: warnings.filter((w) => w.severity === "info").length
  };

  // Agrupar por parcela.
  const byParcela = new Map<number, DataQualityWarning[]>();
  for (const w of warnings) {
    if (w.parcela_id == null) continue;
    const list = byParcela.get(w.parcela_id) ?? [];
    list.push(w);
    byParcela.set(w.parcela_id, list);
  }

  return (
    <>
      <PageHeader
        title="Calidad de datos"
        description="Warnings de calidad de datos detectados en el dataset. Útil para auditar parcelas con metadata incompleta, ciclos inconsistentes o fumigaciones huérfanas."
      />
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
        {/* KPIs */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card>
            <CardContent className="flex items-start justify-between gap-2 p-4">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Total warnings
                </p>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums">
                  {fmtInt(warnings.length)}
                </p>
              </div>
              <AlertTriangle className="size-4 shrink-0 text-primary" aria-hidden />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-start justify-between gap-2 p-4">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Errores
                </p>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums text-destructive">
                  {fmtInt(bySeverity.error)}
                </p>
              </div>
              <ShieldAlert className="size-4 shrink-0 text-destructive" aria-hidden />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-start justify-between gap-2 p-4">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Warnings
                </p>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums text-amber-700 dark:text-amber-300">
                  {fmtInt(bySeverity.warning)}
                </p>
              </div>
              <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-start justify-between gap-2 p-4">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Info
                </p>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums">
                  {fmtInt(bySeverity.info)}
                </p>
              </div>
              <Info className="size-4 shrink-0 text-primary" aria-hidden />
            </CardContent>
          </Card>
        </section>

        {/* Lista por parcela */}
        {byParcela.size === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Sin warnings — el dataset está limpio.
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {Array.from(byParcela.entries()).map(([parcelaId, ws]) => {
              const worst = ws.some((w) => w.severity === "error")
                ? "error"
                : ws.some((w) => w.severity === "warning")
                  ? "warning"
                  : "info";
              return (
                <Card key={parcelaId}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base">
                        <Link
                          href={`/parcelas/${parcelaId}`}
                          className="hover:text-primary"
                        >
                          Parcela #{parcelaId}
                        </Link>
                      </CardTitle>
                      <Badge
                        variant="outline"
                        className={
                          worst === "error"
                            ? "border-destructive/40 bg-destructive/5 text-destructive"
                            : worst === "warning"
                              ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300"
                              : "border-primary/30 bg-primary/5"
                        }
                      >
                        {ws.length} {ws.length === 1 ? "warning" : "warnings"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ul className="ml-4 list-disc space-y-1 text-xs">
                      {ws.map((w, i) => (
                        <li key={`${w.code}-${i}`} data-severity={w.severity}>
                          <span className="font-medium">{w.message}</span>
                          {w.fumigation_id != null ? (
                            <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                              (fumigación #{w.fumigation_id})
                            </span>
                          ) : null}
                          {w.cycle_id != null ? (
                            <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                              (ciclo #{w.cycle_id})
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
