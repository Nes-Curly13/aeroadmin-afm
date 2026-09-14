// app/(auth)/admin/reglas-fitosanitarias/page.tsx
//
// Control admin de las reglas de aplicación por fase (MVP fenológico
// 2026-09-13). Data-driven: el admin ajusta ventanas/cadencias y el
// sistema recalcula la planificación.
import { PageHeader } from "@/components/page-header";
import { PhaseRulesEditor } from "@/components/admin/phase-rules-editor";
import { requireRole } from "@/lib/auth/role";
import { getPhaseApplicationRules } from "@/api/repositories";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Reglas fitosanitarias | AFM Geovisor"
};

export default async function ReglasFitosanitariasPage() {
  await requireRole("admin");
  const rules = await getPhaseApplicationRules("cana");

  return (
    <>
      <PageHeader
        title="Reglas fitosanitarias"
        description="Aplicaciones recomendadas por fase del cultivo. Ajustá ventanas y cadencias: la planificación se recalcula automáticamente."
      />
      <div className="px-4 py-6 sm:px-6">
        <PhaseRulesEditor initialRules={rules} />
      </div>
    </>
  );
}
