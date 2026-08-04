import { NewParcelForm } from "@/components/admin/parcels/new-parcel-form";
import { PageHeader } from "@/components/page-header";

/**
 * /admin/parcels/new — alta manual de una parcela.
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding (sub-sprint 1).
 *
 * Cierra el gap #1 del QA review de gestión de datos: el operador
 * fumigador ahora puede crear una parcela sin esperar a que DJI la
 * reporte, sin necesidad de correr SQL directo.
 *
 * Server component que renderiza el form (client component) en 2
 * columnas:
 *   - Izquierda: 11 campos alfanuméricos (nombre, tipo, suerte,
 *     cliente, hacienda, municipio, variedad, cultivo, siembra,
 *     propietario, contacto, notas).
 *   - Derecha: mapa MapLibre + terra-draw para dibujar el polígono.
 *
 * El form hace POST a /api/admin/parcels. Al success, redirige a
 * /parcelas/{id} (el detalle).
 *
 * Gate: el middleware ya filtra /admin/* por role (admin only).
 * El handler del API tiene requireRole("admin") como segunda capa.
 */

export const metadata = {
  title: "Alta manual de parcela | AFM",
  description:
    "Crear una parcela nueva (no escrapeda de DJI) con su polígono dibujado en el mapa."
};

export const dynamic = "force-dynamic";

export default function NewParcelPage() {
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader
        title="Alta manual de parcela"
        description="Crear una parcela nueva cuando DJI no la reportó. Dibujá el polígono en el mapa y completá los datos del lote."
      />
      <NewParcelForm />
    </div>
  );
}
