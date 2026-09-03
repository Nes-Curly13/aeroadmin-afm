import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { RegisterFumigationForm } from "@/components/parcels/register-fumigation-form";
import { getFumigationById } from "@/api/repositories";
import { getViewerRole } from "@/lib/auth/role";
import { fmtDate } from "@/lib/format";

/**
 * /fumigacion/[id]/edit — edición individual de una fumigación.
 *
 * Sprint 2026-08-13 — feature/fumigacion-detail-v2 / sub-3.
 *
 * Cierra el pedido del operador de poder editar fumigaciones una a
 * una (no bulk). El form reusa `RegisterFumigationForm` con mode="edit"
 * — el mismo componente, inicializado con los valores actuales de la
 * fumigación, hace PATCH en lugar de POST.
 *
 * Auth gate: solo admin o supervisor pueden editar. Si el viewer es
 * otro rol, mostramos 403 (no redirect a /fumigaciones — sería un
 * silent failure, mejor avisar).
 *
 * Si la fumigación no existe o está soft-deleted → 404.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditFumigacionPage({ params }: PageProps) {
  const { id } = await params;
  const fumigationId = Number(id);
  if (!Number.isFinite(fumigationId) || fumigationId <= 0) {
    notFound();
  }

  const fumigation = await getFumigationById(fumigationId);
  if (!fumigation) {
    notFound();
  }

  // Auth gate. requireRole tira excepción si no auth/forbidden; el
  // Next error boundary lo renderea como 500. Mejor: chequear
  // manualmente y devolver 403 via notFound (que al menos da feedback
  // visual). Para distinguir viewer-sin-permiso de fumigación-inexistente,
  // usamos 403 con un mensaje custom. Simplificación: si NO es admin ni
  // supervisor, mostrar el detail (read-only) con un banner "no tenés
  // permiso para editar". Esto preserva la URL y es más útil que un
  // 403 ciego.
  const role = await getViewerRole().catch(() => null);
  const canEdit = role === "admin" || role === "supervisor";

  // El header + back link se renderizan siempre (incluso si no puede
  // editar, así puede volver al detail).
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        render={
          <Link
            href={`/fumigacion/${fumigationId}`}
            className="self-start"
            aria-label="Volver al detalle de la fumigación sin guardar cambios"
          />
        }
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Volver al detalle
      </Button>

      <PageHeader
        title={`Editar fumigación #${fumigationId}`}
        description={`Modificá los datos de la fumigación del ${fmtDate(fumigation.fumigation_date)}. Los cambios se guardan uno a uno (no bulk).`}
      />

      {!canEdit ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-amber-700 dark:text-amber-300">
              Sin permisos para editar
            </CardTitle>
            <CardDescription>
              Tu rol actual ({role ?? "sin sesión"}) no permite editar fumigaciones.
              Solo admin o supervisor pueden hacerlo. Si necesitás editar, pedile
              a un admin que lo haga.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/fumigaciones" aria-label="Volver al listado de fumigaciones" />}
            >
              Volver a fumigaciones
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Datos editables</CardTitle>
            <CardDescription>
              El <code>parcel_id</code>, la <code>source</code> (manual/DJI/import),
              el operador que registró y los vuelos asociados son inmutables.
              Para cambiar la parcela o reasignar un operario, eliminá esta
              fumigación y registrá una nueva.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RegisterFumigationForm
              parcelId={fumigation.parcel_id}
              mode="edit"
              initialFumigation={fumigation}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
