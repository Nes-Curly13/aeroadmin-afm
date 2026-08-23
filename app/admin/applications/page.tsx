import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { fmtDate, toISODate } from "@/lib/format";
import { getDb } from "@/lib/db";
import { getViewerRole } from "@/lib/auth/role";

/**
 * /admin/applications — lista de fumigaciones importadas del Excel del
 * operador fumigador (source='import_excel').
 *
 * Sprint: feature/excel-applications-import / Nivel 1.
 *
 * Esta pagina es read-only. La UI para resolver huerfanos (Nivel 2)
 * vivira en /admin/applications/review.
 *
 * Server component — query directa via getDb(). El role gate esta en
 * el proxy.ts (middleware) que filtra /admin/* por role=admin.
 */

interface ApplicationRow {
  id: number;
  fumigation_date: Date;
  hacienda: string | null;
  drone: string | null;
  pilot: string | null;
  area: number | null;
  area_unit: string | null;
  match_score: number | null;
  match_method: string | null;
  excel_source: string | null;
  import_actor: string | null;
}

async function listApplications(): Promise<ApplicationRow[]> {
  const db = getDb();
  const result = await db.query(
    `SELECT id, fumigation_date, notes, recorded_by
       FROM dji_fumigations
      WHERE source = 'import_excel'
   ORDER BY fumigation_date DESC
      LIMIT 100`
  );
  return result.rows.map((r: { id: number; fumigation_date: Date; notes: Record<string, unknown> | null; recorded_by: string | null }) => {
    const notes = r.notes || {};
    const match = (notes.match as { drone_nickname?: string; pilot_name?: string; score?: number; method?: string }) || {};
    const app = (notes.application as { hacienda?: string; area_applied?: number; area_unit?: string }) || {};
    const src = (notes.source as { sheet?: string; row_idx?: number } | undefined);
    return {
      id: r.id,
      fumigation_date: r.fumigation_date,
      hacienda: app.hacienda ?? null,
      drone: match.drone_nickname ?? null,
      pilot: match.pilot_name ?? null,
      area: app.area_applied ?? null,
      area_unit: app.area_unit ?? null,
      match_score: match.score ?? null,
      match_method: match.method ?? null,
      excel_source: src ? `${src.sheet ?? "?"}!${src.row_idx ?? "?"}` : null,
      import_actor: r.recorded_by
    };
  });
}

export const dynamic = "force-dynamic";

export default async function ApplicationsAdminPage() {
  // Gate visual: si no es admin, mostrar mensaje. El filtro real esta en el middleware.
  const role = await getViewerRole();
  if (role !== "admin") {
    return (
      <div className="p-6">
        <Card>
          <p className="text-sm">Esta pagina es solo accesible para administradores.</p>
        </Card>
      </div>
    );
  }

  const apps = await listApplications();
  const total = apps.length;
  const matched = apps.filter(a => (a.match_score ?? 0) >= 0.5).length;
  const orphans = total - matched;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader
        title="Aplicaciones del Excel"
        description="Fumigaciones importadas del registro manual del operador (source=import_excel). El import se ejecuta via CLI en scripts/import-applications-from-excel.js."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <p className="text-xs text-muted-foreground">Total importadas</p>
          <p className="text-2xl font-bold">{total}</p>
        </Card>
        <Card>
          <p className="text-xs text-muted-foreground">Match OK (score &ge; 0.5)</p>
          <p className="text-2xl font-bold text-green-700">{matched}</p>
        </Card>
        <Card>
          <p className="text-xs text-muted-foreground">Huerfanas (score &lt; 0.5)</p>
          <p className="text-2xl font-bold text-amber-700">{orphans}</p>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Ultimas 100 fumigaciones importadas</h2>
          <Link href="/fumigaciones?source=import_excel" className="text-xs text-primary hover:underline">
            Ver todas en /fumigaciones
          </Link>
        </div>

        {apps.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Sin fumigaciones importadas. Corre <code>scripts/import-applications-from-excel.js</code> con el Excel del operador.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Fecha</th>
                  <th className="text-left p-2">Hacienda</th>
                  <th className="text-left p-2">Drone</th>
                  <th className="text-left p-2">Piloto</th>
                  <th className="text-right p-2">Area</th>
                  <th className="text-center p-2">Match</th>
                  <th className="text-left p-2">Origen</th>
                </tr>
              </thead>
              <tbody>
                {apps.map(a => (
                  <tr key={a.id} className="border-b hover:bg-muted/30">
                    <td className="p-2">{fmtDate(toISODate(a.fumigation_date))}</td>
                    <td className="p-2">{a.hacienda ?? "—"}</td>
                    <td className="p-2 font-mono text-xs">{a.drone ?? "—"}</td>
                    <td className="p-2">{a.pilot ?? "—"}</td>
                    <td className="p-2 text-right">
                      {a.area != null ? `${a.area.toFixed(2)} ${a.area_unit ?? ""}` : "—"}
                    </td>
                    <td className="p-2 text-center">
                      {a.match_method === "exact" ? (
                        <Badge className="bg-green-100 text-green-800">exacto</Badge>
                      ) : a.match_method === "fuzzy" ? (
                        <Badge variant="outline" className="border-amber-500 text-amber-700">
                          fuzzy
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          sin match
                        </Badge>
                      )}
                    </td>
                    <td className="p-2 font-mono text-xs text-muted-foreground">
                      {a.excel_source ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
