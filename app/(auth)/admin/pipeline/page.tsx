// app/(auth)/admin/pipeline/page.tsx
//
// DASH-05 (2026-09-14): el panel de salud del pipeline DJI AG se movió
// del dashboard del operador a acá (es monitoreo técnico, admin-only).
import { PageHeader } from "@/components/page-header";
import { HealthPanel } from "@/components/dashboard/health-panel";
import { requireRole } from "@/lib/auth/role";
import { getHealth, getImportBatches } from "@/lib/data";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pipeline DJI | AFM Geovisor"
};

export default async function PipelinePage() {
  await requireRole("admin");
  const [health, batches] = await Promise.all([getHealth(), getImportBatches()]);

  return (
    <>
      <PageHeader
        title="Salud del pipeline DJI AG"
        description="Estado del scraper y últimos lotes importados. Monitoreo técnico (admin)."
      />
      <div className="px-4 py-6 sm:px-6">
        <HealthPanel health={health} batches={batches} />
      </div>
    </>
  );
}
