import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  ClipboardList,
  Download,
  FileText,
  Droplets,
  History,
  MapPin,
  Pencil,
  Plane,
  Sprout,
  Timer,
  User
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteFumigationButton } from "@/components/fumigations/delete-fumigation-button";
import { FumigationAuditTrail } from "@/components/fumigations/fumigation-audit-trail";
import { FumigationMap } from "@/components/parcels/fumigation-map";
import {
  getFumigationAuditTrail,
  getFumigationById,
  getFumigationFlights,
  getParcelById
} from "@/api/repositories";
import { droneModel } from "@/lib/data";
import { FUMIGATION_CATEGORIES, type FumigationCategoryOption } from "@/lib/data-constants";
import { fmtDate, fmtDateTime, fmtDec, fmtHa, fmtLiters } from "@/lib/format";

/**
 * /fumigacion/[id] — ficha de un evento individual de fumigación.
 *
 * Sprint 2026-08-05 — feature/nav-fumigaciones.
 *
 * Cierra el pedido del operador fumigador de poder navegar fumigaciones
 * por URL propia. Antes las fumigaciones solo existían como filas en
 * /fumigaciones y como items en el timeline del parcel detail. Ahora
 * cada fumigación tiene una ficha con:
 *   - Header: #id, fecha, badge de fuente, link al parcel
 *   - Mapa satelital con el polígono del parcel + pin de la fumigación
 *   - Detalles: producto, dosis, área, duración, dron
 *   - Compliance: ICA, licencia piloto
 *   - Lista de vuelos asociados (de flight_ids)
 *   - Notas + trazabilidad
 *
 * Auth: igual que /fumigaciones — el middleware NO filtra esta ruta
 * porque es pública para el rol del operador fumigador. La lógica de
 * auth se hace dentro de la BD (deleted_at IS NULL).
 *
 * Si el id no existe o fue soft-deleted, devolvemos 404.
 */

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  djiscraper: "DJI",
  import: "Import"
};

const SOURCE_STYLE: Record<string, string> = {
  manual: "border-chart-3/40 bg-chart-3/10 text-chart-3",
  import: "border-chart-2/40 bg-chart-2/10 text-chart-2",
  djiscraper: "border-chart-1/40 bg-chart-1/10 text-chart-1"
};

/**
 * Sprint 2026-08-13 — sub-2. Mapea el slug/color de la categoría
 * curada a clases Tailwind del badge. Lo hacemos en código (no en BD)
 * porque la BD solo guarda el color semántico (amber/red/...) y la
 * decisión de cómo renderizarlo es responsabilidad de la UI.
 */
const CATEGORY_BADGE: Record<string, string> = {
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  red: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  purple: "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  green: "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300",
  orange: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  yellow: "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
  slate: "border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300"
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function FumigacionPage({ params }: PageProps) {
  const { id } = await params;
  const fumigationId = Number(id);
  if (!Number.isFinite(fumigationId) || fumigationId <= 0) {
    notFound();
  }

  const fumigation = await getFumigationById(fumigationId);
  if (!fumigation) {
    notFound();
  }

  // Cargar el parcel en paralelo (es chico, no hace falta await seriado).
  const parcel = await getParcelById(fumigation.parcel_id);

  // Cargar los vuelos asociados a la fumigación.
  const flights = await getFumigationFlights(fumigation.flight_ids);

  // Cargar el historial de cambios (audit log). Sprint 2026-08-15 —
  // feature/fumigation-audit-log / sub-3. Devuelve [] si la fumigación
  // no tiene eventos (caso típico: fumigaciones creadas antes de este
  // sprint, el audit log se populó desde esta fecha en adelante).
  const auditTrail = await getFumigationAuditTrail(fumigationId);

  // Dron info (puede ser null si drone_code_used=0 = "Sin asignar")
  // Cast a DroneModelId (0|72|201|210) — el type del evento es number
  // genérico pero el catálogo de drones solo tiene esos 4 IDs.
  const droneInfo =
    fumigation.drone_code_used != null &&
    [0, 72, 201, 210].includes(fumigation.drone_code_used)
      ? droneModel(fumigation.drone_code_used as 0 | 72 | 201 | 210)
      : null;

  // Geometría del parcel (si está) + punto de la fumigación
  const parcelGeom = parcel?.spray_geometry as
    | { type: "Polygon"; coordinates: number[][][] }
    | null
    | undefined;
  const fumigationPoint =
    fumigation.lat != null && fumigation.lng != null
      ? { lat: Number(fumigation.lat), lng: Number(fumigation.lng) }
      : null;

  // Categoría curada (sprint 2026-08-13 — sub-2). Priorizamos el objeto
  // `category` hidratado por el JOIN; caemos al catálogo client-side
  // por `category_id` si el JOIN no devolvió (caso raro de tests con
  // mocks parciales). Si tampoco, queda null → "Sin clasificar".
  const category: FumigationCategoryOption | null =
    fumigation.category ??
    (fumigation.category_id != null
      ? (FUMIGATION_CATEGORIES.find(
          (c: FumigationCategoryOption) => c.id === fumigation.category_id
        ) ?? null)
      : null);

  // Sprint 2026-08-13 — sub-3. El botón "Editar" se muestra solo si
  // el viewer tiene rol admin o supervisor (gate del PATCH). Si no,
  // el botón no aparece (es preferible a un botón disabled que el
  // usuario no entienda por qué).
  const { getViewerRole } = await import("@/lib/auth/role");
  const viewerRole = await getViewerRole().catch(() => null);
  const canEdit = viewerRole === "admin" || viewerRole === "supervisor";

  // Sprint 2026-08-13 — polish v1. Si el viewer es admin/supervisor
  // no mostramos nada (las acciones de Editar/Eliminar/PDF/CSV ya
  // están visibles a la derecha). Si NO hay sesión (o el role
  // no es admin/supervisor), un banner sutil en el header avisa que
  // está en modo lectura. Esto evita la confusión de "¿por qué no
  // puedo editar?" cuando un futuro role con menos permisos entre
  // al detail de una fumigación o alguien sin sesión intenta editar
  // vía URL. El sistema actual solo tiene roles `admin` y
  // `supervisor` (ver `lib/auth/role.ts` → `AppRole`), así que hoy
  // este banner solo se muestra cuando `viewerRole == null`. Cuando
  // se agregue un role `viewer` o `operator`, el chequeo se
  // extiende a `!canEdit`.
  const readOnlyReason = canEdit
    ? null
    : viewerRole == null
      ? "no autenticado"
      : `tu rol (${viewerRole}) no permite editar fumigaciones`;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {/* Banner de modo lectura (sprint 2026-08-13 polish v1). */}
      {readOnlyReason ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
        >
          <svg
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {`Modo lectura — ${readOnlyReason}. Las acciones de edición están deshabilitadas.`}
        </p>
      ) : null}

      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/fumigaciones" className="self-start" aria-label="Volver al listado de fumigaciones" />}
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Volver a fumigaciones
          </Button>
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={
                  <a
                    href={`/api/admin/fumigations/${fumigation.id}/report.pdf`}
                    download={`fumigacion-${fumigation.id}.pdf`}
                    aria-label={`Descargar reporte PDF de la fumigación #${fumigation.id}`}
                  />
                }
              >
                <FileText className="size-3.5" aria-hidden />
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={
                  <a
                    href={`/api/admin/fumigations/${fumigation.id}/report.csv`}
                    download={`fumigacion-${fumigation.id}.csv`}
                    aria-label={`Descargar reporte CSV de la fumigación #${fumigation.id}`}
                  />
                }
              >
                <Download className="size-3.5" aria-hidden />
                CSV
              </Button>
              <DeleteFumigationButton
                fumigationId={fumigation.id}
                description={fumigation.product_used ?? "sin producto"}
              />
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={
                  <Link
                    href={`/fumigacion/${fumigation.id}/edit`}
                    aria-label={`Editar fumigación #${fumigation.id}`}
                  />
                }
              >
                <Pencil className="size-3.5" aria-hidden />
                Editar fumigación
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-extrabold tracking-tight text-balance">
            {`Fumigación #${fumigation.id}`}
          </h1>
          <Badge
            variant="outline"
            className={`text-[11px] font-semibold uppercase tracking-wider ${
              SOURCE_STYLE[fumigation.source] ?? ""
            }`}
          >
            {SOURCE_LABEL[fumigation.source] ?? fumigation.source}
          </Badge>
          {category ? (
            <Badge
              variant="outline"
              className={`text-[11px] font-semibold uppercase tracking-wider ${
                CATEGORY_BADGE[category.color] ?? CATEGORY_BADGE.slate
              }`}
              aria-label={`Tipo de fumigación: ${category.label}`}
            >
              {category.label}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[11px] font-normal italic text-muted-foreground"
              aria-label="Tipo de fumigación sin clasificar"
            >
              Sin clasificar
            </Badge>
          )}
          <span className="font-mono text-sm text-muted-foreground">
            <CalendarDays className="mr-1 inline size-3.5" aria-hidden />
            {fmtDate(fumigation.fumigation_date)}
          </span>
          {parcel ? (
            <Link
              href={`/parcelas/${parcel.id}`}
              className="inline-flex items-center gap-1 rounded-md border border-input bg-card px-2.5 py-1 text-xs font-semibold hover:bg-muted"
            >
              <Sprout className="size-3 text-muted-foreground" aria-hidden />
              {`Parcela #${parcel.id}`}
              {parcel.land_name ? (
                <span className="font-normal text-muted-foreground">
                  · {parcel.land_name}
                </span>
              ) : null}
            </Link>
          ) : null}
        </div>
      </div>

      {/* Grid principal: mapa (izq) + detalles (der) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Mapa satelital */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="size-4 text-primary" aria-hidden />
              Ubicación
            </CardTitle>
            <CardDescription>
              Basemap satelital (Sentinel-2 2024). El pin amarillo marca
              el centroide de los vuelos asociados a esta fumigación.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FumigationMap
              parcelGeom={parcelGeom ?? null}
              fumigationPoint={fumigationPoint}
              flights={flights
                .filter((f) => f.lng != null && f.lat != null)
                .map((f) => ({
                  id: f.flight_id,
                  lng: Number(f.lng),
                  lat: Number(f.lat),
                  pilot: f.pilot_name ?? undefined,
                  drone_model: f.drone_nickname ?? undefined
                }))}
              className="h-80 lg:h-96"
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              {`${flights.length} vuelo${flights.length === 1 ? "" : "s"} asociad${flights.length === 1 ? "o" : "os"}`}
              {fumigationPoint
                ? ` · centroide en (${fumigationPoint.lat.toFixed(5)}, ${fumigationPoint.lng.toFixed(5)})`
                : " · sin centroide (fumigación sin vuelos asociados)"}
            </p>
          </CardContent>
        </Card>

        {/* Detalles */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Droplets className="size-4 text-chart-2" aria-hidden />
                Detalles de aplicación
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <DetailRow
                  label="Tipo"
                  value={
                    category ? (
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                          CATEGORY_BADGE[category.color] ?? CATEGORY_BADGE.slate
                        }`}
                      >
                        {category.label}
                      </span>
                    ) : (
                      <span className="italic text-muted-foreground">Sin clasificar</span>
                    )
                  }
                />
                <DetailRow label="Producto" value={fumigation.product_used ?? "—"} />
                <DetailRow
                  label="Dosis"
                  value={
                    fumigation.dose_l_per_ha != null
                      ? `${fmtDec(fumigation.dose_l_per_ha)} L/ha`
                      : "—"
                  }
                />
                <DetailRow
                  label="Área fumigada"
                  value={
                    fumigation.area_fumigated_m2 != null
                      ? fmtHa(fumigation.area_fumigated_m2)
                      : "—"
                  }
                />
                <DetailRow
                  label="Duración"
                  value={
                    fumigation.duration_minutes != null
                      ? `${fumigation.duration_minutes} min`
                      : "—"
                  }
                />
                <DetailRow
                  label="Dron"
                  value={
                    droneInfo
                      ? `${droneInfo.name} (${droneInfo.tank_l} L)`
                      : "Sin asignar"
                  }
                />
                <DetailRow
                  label="Operador"
                  value={fumigation.recorded_by ?? "—"}
                />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="size-4 text-chart-4" aria-hidden />
                Compliance
              </CardTitle>
              <CardDescription>
                Requerido por la auditoría ICA/Aerocivil.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-3 text-sm">
                <DetailRow
                  label="Registro ICA del producto"
                  value={fumigation.product_registered_ica ?? "—"}
                />
                <DetailRow
                  label="Licencia del piloto (Aerocivil)"
                  value={fumigation.pilot_license ?? "—"}
                />
                {(!fumigation.product_registered_ica || !fumigation.pilot_license) ? (
                  <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                    Esta fumigación no tiene todos los datos de compliance. Para auditoría,
                    editar la fumigación y completar ICA + licencia.
                  </p>
                ) : null}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Vuelos asociados */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plane className="size-4 text-primary" aria-hidden />
            {`Vuelos asociados (${flights.length})`}
          </CardTitle>
          <CardDescription>
            Vuelos de dji_flights cuyo flight_id está en el array flight_ids
            de esta fumigación. El importador los asoció automáticamente;
            las fumigaciones manuales no tienen asociación.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {flights.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              {fumigation.source === "manual"
                ? "Fumigación manual — sin vuelos asociados. Es normal."
                : "No hay vuelos asociados en dji_flights. Revisar el importador."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Flight ID</th>
                    <th className="px-3 py-2 text-left font-semibold">Inicio</th>
                    <th className="px-3 py-2 text-left font-semibold">Piloto</th>
                    <th className="px-3 py-2 text-left font-semibold">Dron</th>
                    <th className="px-3 py-2 text-right font-semibold">Área</th>
                    <th className="px-3 py-2 text-right font-semibold">Duración</th>
                    <th className="px-3 py-2 text-right font-semibold">Volumen</th>
                  </tr>
                </thead>
                <tbody>
                  {flights.map((f) => (
                    <tr key={f.flight_id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">#{f.flight_id}</td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums">
                        {fmtDateTime(f.start_at)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {f.pilot_name ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {f.drone_nickname ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                        {f.area_m2 != null ? fmtHa(f.area_m2) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                        {f.duration_min != null ? `${fmtDec(f.duration_min)} min` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                        {f.spray_usage_ml != null ? `${fmtLiters(f.spray_usage_ml / 1000)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notas + trazabilidad */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="size-4 text-muted-foreground" aria-hidden />
              Notas operativas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {fumigation.human_notes ? (
              <p className="text-sm leading-relaxed">{fumigation.human_notes}</p>
            ) : (
              <p className="text-sm italic text-muted-foreground">
                Sin notas del operador.
              </p>
            )}
            {fumigation.notes && fumigation.notes !== fumigation.human_notes ? (
              <details className="mt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer font-semibold">
                  Metadata técnica (import)
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-md bg-muted/50 p-2 text-[10px]">
                  {fumigation.notes}
                </pre>
              </details>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Timer className="size-4 text-muted-foreground" aria-hidden />
              Trazabilidad
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-2 text-sm">
              <DetailRow
                label="Registrada el"
                value={fmtDateTime(fumigation.recorded_at)}
              />
              <DetailRow label="Fuente" value={SOURCE_LABEL[fumigation.source] ?? fumigation.source} />
              <DetailRow
                label="Vuelos en flight_ids"
                value={String(fumigation.flight_ids?.length ?? 0)}
              />
              <DetailRow
                label="Vuelos con match en dji_flights"
                value={String(flights.length)}
              />
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* Historial de cambios (audit log) — sprint 2026-08-15.
          Solo visible si hay eventos (fumigaciones modernas) o si
          quiere ver el mensaje "sin historial" para las antiguas. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-primary" aria-hidden />
            Historial
            {auditTrail.length > 0 ? (
              <Badge variant="outline" className="ml-1 text-[10px] font-normal">
                {`${auditTrail.length} evento${auditTrail.length === 1 ? "" : "s"}`}
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            Cambios registrados sobre esta fumigación: quién la creó, qué se
            editó, cuándo se eliminó/restauró. Append-only — no se borra.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FumigationAuditTrail events={auditTrail} />
        </CardContent>
      </Card>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-sm tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );
}
