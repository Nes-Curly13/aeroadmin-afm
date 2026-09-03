import { PageHeader } from "@/components/page-header";
import { ImportGisWizard } from "@/components/admin/parcels/import-gis-wizard";

/**
 * /admin/parcels/import — wizard de import GIS (KML / SHP / GPKG).
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding, sub-sprint 2 (Import GIS).
 *
 * Server component que monta el wizard client. El wizard hace:
 *   1. POST /api/admin/parcels/import/preview (multipart)
 *   2. Tabla editable de nombres
 *   3. POST /api/admin/parcels/import/commit (JSON)
 *
 * Auth: el middleware ya gatea /admin/* a admin only. El API también
 * valida con requireRole("admin").
 *
 * Decisión: NO soportamos KMZ (KML zipeado) en MVP. Si lo suben, tira
 * "formato no soportado" con mensaje claro.
 */

export const metadata = {
  title: "Importar parcelas desde GIS | AFM",
  description:
    "Carga un archivo KML, ZIP (shapefile) o GeoPackage y crea N parcelas en una sola operación."
};

export const dynamic = "force-dynamic";

export default function ImportGisPage() {
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader
        title="Importar parcelas desde GIS"
        description="Subí un archivo KML, ZIP (shapefile) o GeoPackage. El sistema detecta los polígonos, te deja editar los nombres, y crea todas las parcelas en una sola operación."
      />
      <ImportGisWizard />
    </div>
  );
}
