import { AdminParcelsClient } from "./admin-parcels-client";
import { getParcelsNormalized, type DjiParcelsFilter } from "@/api/repositories";
import { PageHeader } from "@/components/page-header";

/**
 * /admin/parcels — UI para que el admin pueble los 4 campos V0
 * (`client_name`, `farm_name`, `municipality`, `variety`) por parcela.
 *
 * Sprint S8.2 (2026-07-29): el V0 mockup muestra estos campos en el
 * geovisor y en `/parcelas` pero DJI no los expone — los tiene que
 * llenar el operador fumigador a mano, una vez por parcela. Esta page
 * es la UI de edición.
 *
 * Diseño:
 *   - Server component: trae la primera pagina (50 parcelas) y
 *     delegamos paginación a un client component que pide las
 *     siguientes paginas via API.
 *   - Filtros: busqueda por nombre/ID + dropdowns unicos por
 *     client/farm/municipality. Como los 4 campos arrancan vacios en
 *     la BD, los dropdowns muestran `"(vacio)"` para que el admin
 *     pueda ver que parcelas faltan poblar.
 *   - Edicion inline: 4 inputs por row, "Guardar" habilita solo si
 *     algo cambio. POST a `/api/admin/parcels/[id]/metadata`. Al
 *     success, refresh silencioso de la lista (revalidatePath) para
 *     reflejar el cambio en las demas rows.
 *   - Gate: el middleware (proxy.ts) ya filtra /admin/* por role, asi
 *     que un supervisor que tipee la URL directamente recibe un
 *     redirect a /login. El handler del API tiene `requireRole("admin")`
 *     como segunda capa.
 *
 * QA gap cerrado 2026-08-02: filtros "missing_X" server-side.
 * El operador tiene 1213 parcelas y los 4 campos arrancan vacíos.
 * Sin este filtro tendría que ir página por página (24 páginas)
 * para encontrar las que faltan. Con `?missing_client=1` (o
 * cualquiera de los 4) el server filtra y solo devuelve las
 * parcelas que cumplen. Combinables con AND (varios flags).
 *
 * Render: 50 filas por pagina × 24 paginas = 1213 parcelas (dataset
 * actual). Suficiente para la operatoria normal — si la lista crece a
 * >5000 parcelas, agregar server-side cursor pagination.
 */

export const metadata = {
  title: "Admin · Parcelas | AFM Geovisor",
  description:
    "Poblar client_name, farm_name, municipality, variety de cada parcela. Editable inline para el admin."
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * Parsea los searchParams del filtro "missing_X" en un boolean.
 * Acepta '1' / 'true' como truthy. Cualquier otro valor (incluido
 * ausente) es falsy. Esto matchea la convención de Next.js
 * searchParams (todo es string).
 */
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

  // Filtros "missing_X" (QA 2026-08-02). El page server los pasa
  // al repo que arma el WHERE. El client component los expone
  // como checkboxes que se sincronizan con la URL via router.push.
  const filter: DjiParcelsFilter = {
    missingClientName: parseBoolParam(sp.missing_client),
    missingFarmName: parseBoolParam(sp.missing_farm),
    missingMunicipality: parseBoolParam(sp.missing_municipality),
    missingVariety: parseBoolParam(sp.missing_variety)
  };

  const result = await getParcelsNormalized(page, PAGE_SIZE, filter);

  const activeMissingCount =
    (filter.missingClientName ? 1 : 0) +
    (filter.missingFarmName ? 1 : 0) +
    (filter.missingMunicipality ? 1 : 0) +
    (filter.missingVariety ? 1 : 0);

  return (
    <>
      <PageHeader
        title="Admin · Parcelas"
        description={`Pobla los 4 campos del V0 (cliente, hacienda, municipio, variedad) que el operador fumigador conoce de campo. ${
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
        />
      </div>
    </>
  );
}
