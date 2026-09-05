import { AdminParcelsClient } from "./admin-parcels-client";
import {
  getParcelsNormalized,
  searchClients,
  countUnassignedParcels,
  type DjiParcelsFilter
} from "@/api/repositories";
import { PageHeader } from "@/components/page-header";

/**
 * /admin/parcels — UI para que el admin pueble los 4 campos V0
 * (`client_name`, `farm_name`, `municipality`, `variety`) por parcela
 * + asignar cliente/finca via FK (S11+ / Fase 3.B).
 *
 * Sprint S8.2 (2026-07-29): el V0 mockup muestra estos campos en el
 * geovisor y en `/parcelas` pero DJI no los expone — los tiene que
 * llenar el operador fumigador a mano, una vez por parcela. Esta page
 * es la UI de edición.
 *
 * Sprint S11+ / Fase 3.B (2026-09-05): la UI ahora también expone
 * dropdowns de Cliente (FK → clients) y Finca (FK → farms). El repo
 * auto-deriva los names denormalizados desde los FK. La lista de
 * clients se pre-carga aqui (server component) para evitar spinner
 * en el initial render; la lista de farms se carga en el cliente
 * porque depende del clientId seleccionado.
 *
 * Diseño:
 *   - Server component: trae la primera pagina (50 parcelas) +
 *     lista de clients + count de parcelas sin asignar.
 *   - Filtros: busqueda por nombre/ID + dropdowns unicos por
 *     client/farm/municipality + filtro `missing_X` (QA 2026-08-02)
 *     + filtro "sin cliente asignado" (Fase 3.B backfill).
 *   - Edicion inline: 4 inputs + 2 dropdowns + 1 select de vigencia
 *     por row. "Guardar" habilita solo si algo cambio. PATCH a
 *     `/api/admin/parcels/[id]/metadata`.
 *   - Gate: el middleware (proxy.ts) ya filtra /admin/* por role.
 *     El handler del API tiene `requireRole("admin")` como segunda capa.
 *
 * Render: 50 filas por pagina × 24 paginas = 1213 parcelas (dataset
 * actual). Suficiente para la operatoria normal — si la lista crece a
 * >5000 parcelas, agregar server-side cursor pagination.
 */

export const metadata = {
  title: "Admin · Parcelas | AFM Geovisor",
  description:
    "Poblar client_name, farm_name, municipality, variety de cada parcela. Asignar cliente/finca via FK. Editable inline para el admin."
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function parseBoolParam(v: string | undefined): boolean {
  return v === "1" || v === "true";
}

export default async function AdminParcelsPage({
  searchParams
}: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    missing_client?: string;
    missing_farm?: string;
    missing_municipality?: string;
    missing_variety?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const query = (sp.q ?? "").trim();

  // Filtros "missing_X" (QA 2026-08-02).
  const filter: DjiParcelsFilter = {
    missingClientName: parseBoolParam(sp.missing_client),
    missingFarmName: parseBoolParam(sp.missing_farm),
    missingMunicipality: parseBoolParam(sp.missing_municipality),
    missingVariety: parseBoolParam(sp.missing_variety)
  };

  // S11+ / Fase 3.B — queries en paralelo: parcels paginadas + lista
  // de clients (para popular dropdowns del client component) + count
  // de parcelas sin cliente asignado (banner del backfill).
  const [result, initialClients, unassignedCount] = await Promise.all([
    getParcelsNormalized(page, PAGE_SIZE, filter),
    searchClients("", 200).catch(
      () => [] as Awaited<ReturnType<typeof searchClients>>
    ),
    countUnassignedParcels().catch(() => 0)
  ]);

  const activeMissingCount =
    (filter.missingClientName ? 1 : 0) +
    (filter.missingFarmName ? 1 : 0) +
    (filter.missingMunicipality ? 1 : 0) +
    (filter.missingVariety ? 1 : 0);

  return (
    <>
      <PageHeader
        title="Admin · Parcelas"
        description={`Pobla los 4 campos V0 (cliente, hacienda, municipio, variedad) y asigna Cliente/Finca via FK. ${
          result.total
        } parcelas en dataset · ${PAGE_SIZE} por página · página ${page}/${result.totalPages || 1}${
          activeMissingCount > 0
            ? ` · ${activeMissingCount} filtro${activeMissingCount === 1 ? "" : "s"} de campos vacíos activo${activeMissingCount === 1 ? "" : "s"}`
            : ""
        }.`}
      />
      <div className="px-4 py-6 sm:px-6">
        <AdminParcelsClient
          initialData={result.data}
          total={result.total}
          page={page}
          totalPages={result.totalPages}
          pageSize={PAGE_SIZE}
          initialQuery={query}
          missingFilter={{
            client: filter.missingClientName ?? false,
            farm: filter.missingFarmName ?? false,
            municipality: filter.missingMunicipality ?? false,
            variety: filter.missingVariety ?? false
          }}
          initialClients={initialClients.map((c) => ({ id: c.id, name: c.name }))}
          initialUnassignedCount={unassignedCount}
        />
      </div>
    </>
  );
}
