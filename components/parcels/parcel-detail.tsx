"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { DjiParcelRecord } from "@/lib/types";

import { ParcelEditPanel } from "@/components/parcels/parcel-edit-panel";

const ParcelMiniMap = dynamic(
  () => import("@/components/parcels/parcel-mini-map").then((m) => m.ParcelMiniMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[280px] items-center justify-center rounded-2xl bg-[#f4f7f4] text-xs font-semibold uppercase tracking-[0.2em] text-[#587064]">
        Cargando mapa
      </div>
    )
  }
);

function ha(m2: number | null | undefined) {
  if (m2 === null || m2 === undefined) return "—";
  return `${(m2 / 10_000).toFixed(3)} ha`;
}

function numOrDash(v: number | string | null | undefined, suffix = "", digits = 2) {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}${suffix}`;
}

function dateOrDash(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

/** Calcula días desde una fecha YYYY-MM-DD hasta hoy. null si input falsy. */
function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const ms = Date.now() - d.getTime();
  return Math.floor(ms / 86_400_000);
}

function yesNo(v: boolean | null | undefined) {
  if (v === true) return "Sí";
  if (v === false) return "No";
  return "—";
}

/** Fila vacía con hint "editá para agregar" — más útil que "—" sordo. */
function EmptyMetaField({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed border-[#e0e7e2] pb-2">
      <dt className="text-[#4a5b50]">{label}</dt>
      <dd className="text-right text-[10px] italic text-[#587064]">{hint}</dd>
    </div>
  );
}

function section(title: string, children: React.ReactNode, headerAction?: React.ReactNode) {
  return (
    <section className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">{title}</h2>
        {headerAction}
      </div>
      {children}
    </section>
  );
}

function dl(rows: Array<[string, React.ReactNode]>) {
  return (
    <dl className="space-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-3 border-b border-[#f0f4f1] pb-2 last:border-0">
          <dt className="text-[#4a5b50]">{k}</dt>
          <dd className="text-right font-semibold text-[#121815]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ParcelDetail({ parcel }: { parcel: DjiParcelRecord }) {
  // Estado lifted para que el botón "Editar" de la sección Contexto del lote
  // pueda abrir el mismo editor que el botón "Editar metadata" del header
  // de identidad. Antes había que scrollear hacia arriba — ahora ambos
  // botones coordinan via props controlados.
  const [editing, setEditing] = useState(false);
  const hasGeometry = !!parcel.spray_geometry;
  const hasWaypoints = !!parcel.waypoints_geometry;
  const hasRefPoint = !!parcel.reference_point;

  const areaComparison = useMemo(() => {
    const declared = parcel.declared_area_ha ?? 0;
    const sprayHa = (parcel.spray_area_m2 ?? 0) / 10_000;
    if (!declared || !sprayHa) return null;
    const ratio = sprayHa / declared;
    return {
      declared: declared.toFixed(3),
      spray: sprayHa.toFixed(3),
      ratio: ratio.toFixed(2),
      covered: ratio >= 0.5 ? "alta" : ratio >= 0.2 ? "media" : "baja"
    };
  }, [parcel.declared_area_ha, parcel.spray_area_m2]);

  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      {/* Columna izquierda: identidad + geometría + secciones */}
      <div className="space-y-5">
        {/* Header de identidad */}
        <header className="rounded-2xl border border-[#d2ddd6] bg-white p-6 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-[12px] font-bold ${
                parcel.is_orchard ? "bg-[#7b3f00]/10 text-[#7b3f00]" : "bg-[#0b5f2d]/10 text-[#0b5f2d]"
              }`}
            >
              {parcel.field_type}
            </span>
            {parcel.drone_model_name && (
              <span className="rounded-full bg-[#dbe7df] px-3 py-1 text-[12px] font-bold text-[#0b5f2d]">
                {parcel.drone_model_name}
              </span>
            )}
            {parcel.waypoint_count ? (
              <span className="rounded-full bg-[#c7a43a]/15 px-3 py-1 text-[12px] font-bold text-[#5a4a1e]">
                {parcel.waypoint_count} waypoints
              </span>
            ) : null}
            <span className="ml-auto text-xs text-[#4a5b50]">
              Importado {dateOrDash(parcel.fetched_at)}
            </span>
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-[#121815]">
            {parcel.land_name ?? "Sin nombre"}
          </h1>
          <p className="mt-1 break-all text-xs text-[#4a5b50]">
            DJI ID: <code className="rounded bg-[#f4f7f4] px-1.5 py-0.5 text-[10px]">{parcel.external_id}</code>
          </p>
        </header>

        {/* Panel de edicion de metadata editable (controlled por estado lifted) */}
        <ParcelEditPanel
          editing={editing}
          onClose={() => setEditing(false)}
          onOpen={() => setEditing(true)}
          parcel={parcel}
        />

        {/* Mini mapa de la parcela */}
        {hasGeometry ? (
          <section
            aria-label="Mapa de la parcela"
            className="overflow-hidden rounded-2xl border border-[#d2ddd6] bg-white shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
          >
            <div className="flex items-center justify-between border-b border-[#d2ddd6] px-5 py-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Geometría</p>
                <h3 className="mt-1 text-base font-semibold text-[#121815]">Spray zone + plan de vuelo</h3>
              </div>
              <Link
                className="rounded-full border border-[#cfd8d3] px-3 py-1.5 text-xs font-semibold text-[#0b5f2d]"
                href="/map"
              >
                Ver en mapa completo
              </Link>
            </div>
            <ParcelMiniMap parcel={parcel} />
            <div className="flex gap-4 border-t border-[#d2ddd6] bg-[#f7f9fb] px-5 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#4a5b50]">
              <div className="flex items-center gap-2">
                <div className={`h-3 w-3 rounded-sm ${parcel.is_orchard ? "bg-[#f4a460]/40 border-2 border-[#7b3f00]" : "bg-[#90EE90]/40 border-2 border-[#0b5f2d]"}`} />
                Spray zone
              </div>
              {hasWaypoints ? (
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-[#c7a43a]" />
                  Waypoint
                </div>
              ) : null}
              {hasRefPoint ? (
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-[#ba1a1a]" />
                  Home point
                </div>
              ) : null}
            </div>
          </section>
        ) : (
          <section className="rounded-2xl border border-dashed border-[#cfd8d3] bg-white p-8 text-center text-sm text-[#4a5b50]">
            Esta parcela no tiene geometría cargada.
          </section>
        )}

        {/* Configuración de aspersión */}
        {section(
          "Parámetros de aspersión",
          dl([
            ["Ancho de swath", `${numOrDash(parcel.spray_width_m, " m", 2)}`],
            ["Velocidad de trabajo", `${numOrDash(parcel.work_speed_mps, " m/s", 2)}`],
            ["Altura del radar", `${numOrDash(parcel.radar_height_m, " m", 2)}`],
            ["Heading óptimo", `${numOrDash(parcel.optimal_heading_deg, "°", 1)}`],
            ["Tamaño de gota", numOrDash(parcel.droplet_size, " µm", 0)],
            ["Aspersión lateral", yesNo(parcel.uses_side_spray)],
            ["Dirección de barrido", numOrDash(parcel.sweep_direction, "", 0)]
          ])
        )}

        {/* Fuentes */}
        {section(
          "Fuentes",
          <div className="space-y-2 text-xs">
            {parcel.source_url_geometry ? (
              <div>
                <p className="font-bold uppercase tracking-[0.18em] text-[#587064]">Geometry</p>
                <p className="mt-1 break-all text-[#4a5b50]">
                  <a className="hover:underline" href={parcel.source_url_geometry} rel="noreferrer" target="_blank">
                    {parcel.source_url_geometry}
                  </a>
                </p>
              </div>
            ) : null}
            {parcel.source_url_parameter ? (
              <div>
                <p className="font-bold uppercase tracking-[0.18em] text-[#587064]">Parameter</p>
                <p className="mt-1 break-all text-[#4a5b50]">
                  <a className="hover:underline" href={parcel.source_url_parameter} rel="noreferrer" target="_blank">
                    {parcel.source_url_parameter}
                  </a>
                </p>
              </div>
            ) : null}
            {parcel.source_url_waypoint ? (
              <div>
                <p className="font-bold uppercase tracking-[0.18em] text-[#587064]">Waypoint</p>
                <p className="mt-1 break-all text-[#4a5b50]">
                  <a className="hover:underline" href={parcel.source_url_waypoint} rel="noreferrer" target="_blank">
                    {parcel.source_url_waypoint}
                  </a>
                </p>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Columna derecha: KPIs + trazabilidad */}
      <div className="space-y-5">
        {section(
          "Área",
          areaComparison ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-[#f4f7f4] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Declarada</p>
                  <p className="text-2xl font-black text-[#121815]">{areaComparison.declared} ha</p>
                </div>
                <div className="rounded-lg bg-[#f4f7f4] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Fumigable</p>
                  <p className="text-2xl font-black text-[#0b5f2d]">{areaComparison.spray} ha</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-[#4a5b50]">
                  El {areaComparison.ratio}x del área declarada está dentro de la zona fumigable calculada por DJI.
                  Cobertura {areaComparison.covered}.
                </p>
                <p className="mt-1 text-[10px] text-[#4a5b50]">
                  Nota: la geometría capturada es la <em>spray zone</em>, no el lindero del campo. La diferencia es esperada.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[#4a5b50]">
              No hay área declarada ni fumigable capturada. Probablemente el plan de fumigación
              aún no está configurado en DJI.
            </p>
          )
        )}

        {section(
          "Plan de vuelo",
          hasWaypoints ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-[#f4f7f4] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Waypoints</p>
                  <p className="text-2xl font-black text-[#121815]">{parcel.waypoint_count ?? 0}</p>
                </div>
                <div className="rounded-lg bg-[#f4f7f4] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Velocidad</p>
                  <p className="text-2xl font-black text-[#121815]">{numOrDash(parcel.work_speed_mps, " m/s", 1)}</p>
                </div>
              </div>
              <p className="text-xs text-[#4a5b50]">
                Plan actual (no histórico). DJI no expone aquí las fumigaciones pasadas por parcela.
              </p>
            </div>
          ) : (
            <p className="text-sm text-[#4a5b50]">
              Sin plan de vuelo capturado. Es típico en campos recién creados o sin tareas asignadas.
            </p>
          )
        )}

        {section(
          "Contexto del lote",
          <div className="space-y-2 text-sm">
            {!editing ? (
              <div className="flex justify-end">
                <button
                  className="rounded-full border border-[#0b5f2d] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#0b5f2d] transition hover:bg-[#0b5f2d] hover:text-white"
                  data-testid="parcel-context-edit-button"
                  onClick={() => setEditing(true)}
                  type="button"
                >
                  Editar
                </button>
              </div>
            ) : null}
            {parcel.crop_type ? (
              <div className="flex items-center justify-between gap-3 border-b border-[#f0f4f1] pb-2">
                <dt className="text-[#4a5b50]">Cultivo</dt>
                <dd className="text-right font-semibold text-[#121815]">{parcel.crop_type}</dd>
              </div>
            ) : (
              <EmptyMetaField label="Cultivo" hint="Editá para agregar el cultivo (caña, maíz, arroz…)" />
            )}
            {parcel.planting_date ? (
              <div className="flex items-center justify-between gap-3 border-b border-[#f0f4f1] pb-2">
                <dt className="text-[#4a5b50]">Sembrado el</dt>
                <dd className="text-right font-semibold text-[#121815]">
                  {dateOrDash(parcel.planting_date)}
                  {(() => {
                    const d = daysSince(parcel.planting_date);
                    return d !== null ? (
                      <span className="ml-1 text-[10px] font-normal text-[#4a5b50]">({d} días)</span>
                    ) : null;
                  })()}
                </dd>
              </div>
            ) : (
              <EmptyMetaField label="Fecha de siembra" hint="Editá para registrar cuándo se plantó" />
            )}
            {parcel.owner_name ? (
              <div className="flex items-center justify-between gap-3 border-b border-[#f0f4f1] pb-2">
                <dt className="text-[#4a5b50]">Propietario</dt>
                <dd className="text-right font-semibold text-[#121815]">{parcel.owner_name}</dd>
              </div>
            ) : (
              <EmptyMetaField label="Propietario" hint="Editá para agregar el nombre del cañero" />
            )}
            {parcel.owner_contact ? (
              <div className="flex items-center justify-between gap-3 border-b border-[#f0f4f1] pb-2">
                <dt className="text-[#4a5b50]">Contacto</dt>
                <dd className="text-right font-semibold text-[#121815]">{parcel.owner_contact}</dd>
              </div>
            ) : (
              <EmptyMetaField label="Contacto" hint="Editá para agregar teléfono o email" />
            )}
            {parcel.location_label ? (
              <div className="flex items-center justify-between gap-3 border-b border-[#f0f4f1] pb-2">
                <dt className="text-[#4a5b50]">Ubicación DJI</dt>
                <dd className="text-right text-xs font-semibold text-[#121815]">{parcel.location_label}</dd>
              </div>
            ) : null}
            {parcel.supervisor_notes ? (
              <div className="pt-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Notas del supervisor</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[#121815]">{parcel.supervisor_notes}</p>
              </div>
            ) : null}
          </div>
        )}

        {section(
          "Acciones",
          <div className="flex flex-col gap-2">
            <Link
              className="rounded-full bg-[#0b5f2d] px-4 py-2 text-center text-sm font-semibold text-white"
              href="/map"
            >
              Ver en mapa completo
            </Link>
            <Link
              className="rounded-full border border-[#cfd8d3] px-4 py-2 text-center text-sm font-semibold text-[#0b5f2d]"
              href="/history"
            >
              Ver historial operativo
            </Link>
            <Link
              className="rounded-full border border-[#cfd8d3] px-4 py-2 text-center text-sm font-semibold text-[#0b5f2d]"
              href="/"
            >
              Volver al dashboard
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
