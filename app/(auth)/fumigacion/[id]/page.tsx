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
  Layers,
  MapPin,
  Pencil,
  Plane,
  Receipt,
  Sprout,
  Timer,
  User
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteFumigationButton } from "@/components/fumigations/delete-fumigation-button";
import { FumigationAuditTrail } from "@/components/fumigations/fumigation-audit-trail";
import { InvoicesCard } from "@/components/fumigations/invoices-card";
import { FumigationMap } from "@/components/parcels/fumigation-map";
import {
  getFumigationAuditTrail,
  getFumigationById,
  getFumigationFlights,
  getFumigationParcelsForMap,
  getParcelById,
  getParcelsByExternalIds
} from "@/api/repositories";
import { droneModel } from "@/lib/data";
import { FUMIGATION_CATEGORIES, type FumigationCategoryOption } from "@/lib/data-constants";
import { fmtDate, fmtDateTime, fmtDec, fmtHa, fmtInt, fmtLiters } from "@/lib/format";

/**
 * /fumigacion/[id] — ficha de un evento individual de fumigación.
 *
 * Sprint 2026-08-05 — feature/nav-fumigaciones.
 * Sprint S9 (2026-08-30) — feature/standalone-fumigation-v2: la vista
 *   standalone ahora trata fumigaciones multi-parcela como un "plan"
 *   con totales agregados (N suertes, M vuelos, ha totales), polígonos
 *   de TODAS las suertes en el mapa y flight list con suerte por vuelo.
 *   Para fumigaciones single-parcela, la vista es la misma de antes.
 *
 * Cierra el pedido del operador fumigador de poder navegar fumigaciones
 * por URL propia. Antes las fumigaciones solo existían como filas en
 * /fumigaciones y como items en el timeline del parcel detail. Ahora
 * cada fumigación tiene una ficha con:
 *   - Header: #id, fecha, badge de fuente, link al parcel primario,
 *     badge multi-parcela si aplica
 *   - "Plan" card (solo multi-parcela): N suertes, M vuelos, ha totales,
 *     lista de suertes con su área individual
 *   - Mapa satelital con polígonos de TODAS las suertes (primaria
 *     destacada) + pin del centroide + puntos de cada flight
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

  // Sprint S9 — cargar las suertes SECUNDARIAS cubiertas por esta fumigación.
  // `parcels` (text[] de external_ids) se hidrata en getFumigationById.
  // Si está vacío, no hay multi-parcela — esta card no se renderiza.
  const secondaryParcels = fumigation.parcels && fumigation.parcels.length > 0
    ? await getParcelsByExternalIds(fumigation.parcels)
    : [];

  // Sprint S9 (2026-08-30) — feature/standalone-fumigation-v2.
  // Hidratamos TODAS las parcelas del plan (1 primaria + N secundarias)
  // con su `spray_geometry` para renderizar el mapa multi-polígono y
  // calcular el área total del plan. El helper usa 2 queries en paralelo
  // y dedupa por id.
  const allParcels = await getFumigationParcelsForMap(
    fumigation.parcel_id,
    fumigation.parcels
  );

  // Total de ha del plan (suma de `declared_area_ha` de las parcelas
  // que lo tienen cargado). null-safe por si alguna parcela no
  // scrapeo su área declarada.
  const totalAreaHa = allParcels.reduce<number>((sum, p) => {
    const v = p.declared_area_ha == null ? null : Number(p.declared_area_ha);
    return sum + (Number.isFinite(v) ? (v as number) : 0);
  }, 0);
  const isPlan = allParcels.length > 1;
  const nSueres = allParcels.length;

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
          {/*
            Sprint S9 — badge "multi-parcela" en el header. Solo aparece
            cuando la fumigación cubrió >1 suerte. El link "Ver N suertes"
            scrollea a la card de detalle (id="fumigation-other-parcels").
          */}
          {secondaryParcels.length > 0 ? (
            <Badge
              variant="outline"
              className="border-chart-1/40 bg-chart-1/10 text-[11px] font-semibold uppercase tracking-wider text-chart-1"
              aria-label={`Fumigación multi-parcela: cubrió ${secondaryParcels.length} suerte${secondaryParcels.length === 1 ? "" : "s"} adicional${secondaryParcels.length === 1 ? "" : "es"}`}
            >
              <Layers className="mr-1 inline size-3" aria-hidden />
              {`Multi-parcela (+${secondaryParcels.length})`}
            </Badge>
          ) : null}
        </div>
      </div>

      {/*
        Sprint S9 (2026-08-30) — feature/standalone-fumigation-v2.
        "Plan" card: solo se renderiza cuando la fumigación cubrió >1
        suerte. Muestra totales agregados (N suertes, M vuelos, ha
        totales, duración total) + lista de suertes con su área.
        Es la primera card visible cuando es multi-parcela para que la
        fumigación se sienta como un PLAN, no como un sub-feature del
        parcel primario.
      */}
      {isPlan ? (
        <Card
          id="fumigation-plan"
          className="border-primary/30 bg-primary/5"
          aria-label="Resumen del plan de fumigación multi-parcela"
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="size-4 text-primary" aria-hidden />
              {`Plan de fumigación (${nSueres} suerte${nSueres === 1 ? "" : "s"})`}
            </CardTitle>
            <CardDescription>
              Esta fumigación cubrió {nSueres} suertes como un solo plan
              operativo. La primaria ({parcel?.land_name ?? `parcela #${fumigation.parcel_id}`})
              aparece destacada en el mapa; las demás se listan acá con su área.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <PlanStat
                label="Suertes"
                value={fmtInt(nSueres)}
                hint={nSueres === 1 ? "1 parcela" : `1 primaria + ${nSueres - 1} secundarias`}
              />
              <PlanStat
                label="Vuelos"
                value={fmtInt(flights.length)}
                hint={flights.length === 0 ? "sin vuelos asociados" : "asociados al plan"}
              />
              <PlanStat
                label="Área total"
                value={totalAreaHa > 0 ? `${fmtDec(totalAreaHa)} ha` : "—"}
                hint="suma de declared_area_ha"
              />
              <PlanStat
                label="Duración total"
                value={(() => {
                  const totalSec = flights.reduce((s, f) => {
                    const v = f.duration_min;
                    if (v == null) return s;
                    const n = typeof v === "string" ? parseFloat(v) : v;
                    return Number.isFinite(n) ? s + n * 60 : s;
                  }, 0);
                  if (totalSec <= 0) return "—";
                  const min = Math.round(totalSec / 60);
                  return min >= 60
                    ? `${Math.floor(min / 60)}h ${min % 60}m`
                    : `${min} min`;
                })()}
                hint="suma de duration_seconds"
              />
            </dl>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Suertes del plan
              </p>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {allParcels.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/parcelas/${p.id}`}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition hover:bg-muted ${
                        p.is_primary
                          ? "border-primary/40 bg-primary/10"
                          : "border-input bg-card"
                      }`}
                    >
                      <span className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1.5 font-semibold">
                          {p.is_primary ? (
                            <Badge
                              variant="outline"
                              className="border-primary/40 bg-primary/15 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider text-primary"
                            >
                              primaria
                            </Badge>
                          ) : null}
                          {p.land_name ?? `Parcela #${p.id}`}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          #{p.id} · {p.field_type}
                          {p.declared_area_ha != null
                            ? ` · ${fmtDec(Number(p.declared_area_ha))} ha`
                            : ""}
                        </span>
                      </span>
                      <Sprout className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      ) : null}

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
              parcels={allParcels.map((p) => ({
                id: p.id,
                is_primary: p.is_primary,
                land_name: p.land_name,
                geometry: p.spray_geometry as
                  | { type: "Polygon"; coordinates: number[][][] }
                  | null
              }))}
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
              {isPlan
                ? ` · ${nSueres} suerte${nSueres === 1 ? "" : "s"} (primaria destacada)`
                : ""}
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

          {/**
           * Sprint S7 — feature/s7-schema-extension / Fase 1 / PR-C.
           * Card "Facturación": lista de facturas de la fumigación
           * (1:N con `dji_fumigations`). El `invoices` aggregate lo
           * hidrata `getFumigationById` con un subquery `jsonb_agg`
           * (no requiere round-trip extra).
           */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Receipt className="size-4 text-chart-5" aria-hidden />
                Facturación
              </CardTitle>
              <CardDescription>
                Facturas asociadas a esta fumigación. Una fumigación puede tener
                N facturas (cuotas, pagos parciales).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InvoicesCard
                fumigationId={fumigation.id}
                invoices={fumigation.invoices ?? []}
                canEdit={canEdit}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/*
        Sprint S9 — feature/multi-parcela-fumigation.
        Card "Otras suertes cubiertas". Solo se renderiza si la fumigación
        cubrió más de 1 suerte (parcels[] poblado por el backfill).
        Muestra las N suertes secundarias con link a cada /parcelas/[id].
        Si hay >5, muestra "Ver todas (N)" con collapse.
      */}
      {secondaryParcels.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="size-4 text-chart-1" aria-hidden />
              {`Otras suertes cubiertas (${secondaryParcels.length})`}
            </CardTitle>
            <CardDescription>
              {`Esta fumigación cubrió ${secondaryParcels.length} suerte${
                secondaryParcels.length === 1 ? "" : "s"
              } adicional${
                secondaryParcels.length === 1 ? "" : "es"
              } además de la parcela principal. Cada link abre la ficha de la suerte correspondiente.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {secondaryParcels.map((p) => (
                <li key={p.id}>
                  <Link
                    className="flex items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm transition hover:bg-muted"
                    href={`/parcelas/${p.id}`}
                  >
                    <span className="flex flex-col gap-0.5">
                      <span className="font-semibold">
                        {p.land_name ?? `Parcela #${p.id}`}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        #{p.id} · {p.field_type}
                      </span>
                    </span>
                    <Sprout className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-muted-foreground">
              {`Detectado vía spatial-join de los ${flights.length} vuelo${
                flights.length === 1 ? "" : "s"
              } asociado${flights.length === 1 ? "" : "s"} (tolerancia 200m).`}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Vuelos asociados */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plane className="size-4 text-primary" aria-hidden />
            {`Vuelos asociados (${flights.length})`}
          </CardTitle>
          <CardDescription>
            Vuelos de dji_flights cuyo flight_id está en el array flight_ids
            de esta fumigación, ordenados cronológicamente. El importador
            los asoció automáticamente; las fumigaciones manuales no tienen
            asociación. La columna "Suerte" muestra qué parcela cubrió cada
            vuelo (resuelto por spatial-join v2).
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
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Flight ID</th>
                    <th className="px-3 py-2 text-left font-semibold">Inicio</th>
                    {isPlan ? (
                      <th className="px-3 py-2 text-left font-semibold">Suerte</th>
                    ) : null}
                    <th className="px-3 py-2 text-left font-semibold">Piloto</th>
                    <th className="px-3 py-2 text-left font-semibold">Dron</th>
                    <th className="px-3 py-2 text-right font-semibold">Área</th>
                    <th className="px-3 py-2 text-right font-semibold">Duración</th>
                    <th className="px-3 py-2 text-right font-semibold">Volumen</th>
                  </tr>
                </thead>
                <tbody>
                  {flights.map((f) => {
                    // Suerte cubierta por este vuelo (JOIN con
                    // `dji_flights.parcel_id` resuelto por spatial-join).
                    const flightParcel =
                      f.parcel_id != null
                        ? allParcels.find((p) => p.id === f.parcel_id) ?? null
                        : null;
                    return (
                      <tr key={f.flight_id} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-2 font-mono text-xs">#{f.flight_id}</td>
                        <td className="px-3 py-2 font-mono text-xs tabular-nums">
                          {fmtDateTime(f.start_at)}
                        </td>
                        {isPlan ? (
                          <td className="px-3 py-2 text-xs">
                            {flightParcel ? (
                              <Link
                                href={`/parcelas/${flightParcel.id}`}
                                className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
                              >
                                <Sprout className="size-3 text-muted-foreground" aria-hidden />
                                <span className="truncate">
                                  {flightParcel.land_name ?? `#${flightParcel.id}`}
                                </span>
                                {flightParcel.is_primary ? (
                                  <span className="rounded-full bg-primary/15 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider text-primary">
                                    primaria
                                  </span>
                                ) : null}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">
                                sin parcela
                              </span>
                            )}
                          </td>
                        ) : null}
                        <td className="px-3 py-2 text-xs">
                          {f.pilot_name ?? <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {f.drone_nickname ?? <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                          {f.area_m2 != null ? fmtHa(Number(f.area_m2)) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                          {f.duration_min != null
                            ? `${fmtDec(Number(f.duration_min))} min`
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                          {f.spray_usage_ml != null ? `${fmtLiters(f.spray_usage_ml / 1000)}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
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

/**
 * Stat compacto para la "Plan card" multi-parcela. Igual pattern que
 * DetailRow pero con un hint debajo (texto pequeño en muted).
 */
function PlanStat({
  label,
  value,
  hint
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-base font-bold tabular-nums text-foreground">
        {value}
      </dd>
      {hint ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
