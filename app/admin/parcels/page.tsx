import { AdminParcelsClient } from "./admin-parcels-client";
import { getParcelsNormalized } from "@/api/repositories";
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

export default async function AdminParcelsPage({
  searchParams
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const query = (sp.q ?? "").trim();

  const result = await getParcelsNormalized(page, PAGE_SIZE, {});

  return (
    <>
      <PageHeader
        title="Admin · Parcelas"
        description={`Pobla los 4 campos del V0 (cliente, hacienda, municipio, variedad) que el operador fumigador conoce de campo. ${
          result.total
        } parcelas en dataset · ${PAGE_SIZE} por página · página ${page}/${result.totalPages || 1}.`}
      />
      <div className="px-4 py-6 sm:px-6">
        <AdminParcelsClient
          initialData={result.data}
          total={result.total}
          page={page}
          totalPages={result.totalPages}
          pageSize={PAGE_SIZE}
          initialQuery={query}
        />
      </div>
    </>
  );
}
