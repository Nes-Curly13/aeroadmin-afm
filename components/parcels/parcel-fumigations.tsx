"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { isProvenanceNotes, toDateString } from "@/lib/format";
import type { DjiFumigationEvent, DjiFumigationSchedule, DjiParcelRecord } from "@/lib/types";

import { CadenceEditor } from "@/components/parcels/cadence-editor";
import { DownloadPdfReportButton } from "@/components/parcels/download-pdf-report-button";
import { ExportFumigationsCsvButton } from "@/components/parcels/export-fumigations-csv-button";
import { EmptyState } from "@/components/ui/empty-state";
import { RoleGate } from "@/components/auth/role-gate";

function statusChip(status: "ok" | "due_soon" | "overdue" | "no_history", days: number | null) {
  if (status === "overdue") return { label: "Vencida", className: "bg-[#a93232]/15 text-[#a93232]" };
  if (status === "due_soon") return { label: "Vence pronto", className: "bg-[#d4b23c]/20 text-[#7a5f0d]" };
  if (status === "ok") return { label: "En fecha", className: "bg-[#0b5f2d]/10 text-[#0b5f2d]" };
  return { label: "Sin historial", className: "bg-[#cfd8d3] text-[#4a5b50]" };
}

function daysLabel(days: number | null): string {
  if (days === null) return "Sin fecha objetivo";
  if (days < 0) return `Vencida hace ${Math.abs(days)} día${Math.abs(days) === 1 ? "" : "s"}`;
  if (days === 0) return "Vence hoy";
  if (days === 1) return "Vence mañana";
  return `En ${days} días`;
}

interface ParcelFumigationsProps {
  parcel: DjiParcelRecord;
  schedule: DjiFumigationSchedule | null;
  events: DjiFumigationEvent[];
  status: "ok" | "due_soon" | "overdue" | "no_history";
  daysUntilNextDue: number | null;
}

export function ParcelFumigations({
  parcel,
  schedule,
  events,
  status,
  daysUntilNextDue
}: ParcelFumigationsProps) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const chip = statusChip(status, daysUntilNextDue);

  // M5/F1.8: el form vive en un <dialog> modal en lugar de inline.
  // El browser maneja focus trap, scroll lock, y cierre con Escape
  // automáticamente. showModal() también bloquea el scroll del body
  // (en navegadores modernos). El backdrop click lo manejamos abajo
  // con un onClick en el dialog mismo.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (showForm && !dialog.open) {
      dialog.showModal();
    } else if (!showForm && dialog.open) {
      dialog.close();
    }
  }, [showForm]);

  function closeForm() {
    setShowForm(false);
    setError(null);
  }

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setError(null);
    try {
      const areaRaw = formData.get("area_fumigated_m2");
      // string vacío → null (NO 0). El supervisor puede dejar el campo
      // sin tocar si quiere registrar la fumigación sin área medida.
      const areaFumigatedM2 =
        typeof areaRaw === "string" && areaRaw.trim() !== ""
          ? Number(areaRaw)
          : null;
      const body = {
        parcel_id: parcel.id,
        fumigation_date: formData.get("fumigation_date"),
        product_used: formData.get("product_used") || null,
        dose_l_per_ha: formData.get("dose_l_per_ha") ? Number(formData.get("dose_l_per_ha")) : null,
        area_fumigated_m2: areaFumigatedM2,
        duration_minutes: formData.get("duration_minutes") ? Number(formData.get("duration_minutes")) : null,
        // Track C v1.4: `notes` queda como provenance del backfill (no se
        // setea desde el form). El operador usa `human_notes` para dejar
        // contexto libre (lluvia, producto nuevo, problema del equipo, etc.).
        human_notes: formData.get("human_notes") || null,
        recorded_by: formData.get("recorded_by") || null,
        // Sprint C — H2: compliance metadata (ICA + Aerocivil). Strings
        // vacíos → null para no mandar strings al server si el operador
        // deja el campo en blanco.
        product_registered_ica: formData.get("product_registered_ica") || null,
        pilot_license: formData.get("pilot_license") || null
      };
      const res = await fetch("/api/fumigations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Error desconocido" }));
        throw new Error(err.error ?? "Error al registrar");
      }
      setShowForm(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#587064]">Fumigación</h2>
          <p className="mt-1 text-sm text-[#4a5b50]">Cadencia, estado e historial</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${chip.className}`}>
          {chip.label}
        </span>
      </header>

      {schedule ? (
        <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-[#f4f7f4] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Cultivo</p>
            <p className="text-base font-semibold text-[#121815]">{schedule.crop_type}</p>
          </div>
          <div className="rounded-lg bg-[#f4f7f4] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Cadencia</p>
            <p className="text-base font-semibold text-[#121815]">cada {schedule.recommended_cadence_days} días</p>
          </div>
          <div className="rounded-lg bg-[#f4f7f4] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Última</p>
            <p className="text-base font-semibold text-[#121815]">
              {schedule.last_fumigation_date ? toDateString(schedule.last_fumigation_date) ?? "—" : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-[#f4f7f4] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Próxima</p>
            <p className="text-base font-semibold text-[#121815]">
              {schedule.next_due_date ? toDateString(schedule.next_due_date) ?? "—" : "—"}
              <span className="ml-2 text-[10px] font-normal text-[#4a5b50]">
                {daysLabel(daysUntilNextDue)}
              </span>
            </p>
          </div>
        </div>
      ) : (
        <p className="mb-4 text-sm text-[#a93232]">
          Esta parcela no tiene schedule de fumigación.
        </p>
      )}

      {schedule ? <CadenceEditor currentCadence={schedule.recommended_cadence_days} parcelId={parcel.id} /> : null}

      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Historial ({events.length})</h3>
        <div className="flex items-center gap-2">
          {/* Sprint B — F1.11: reporte PDF server-side. Visible siempre
              (no depende de tener eventos) — el PDF puede mostrar un
              header + parcela + "sin fumigaciones" si el rango está
              vacío. Decisión del PO: preferible que el botón esté
              siempre visible para no esconder la feature. */}
          <DownloadPdfReportButton parcelId={parcel.id} />
          {events.length > 0 ? (
            <ExportFumigationsCsvButton
              events={events}
              parcelDroneName={parcel.drone_model_name}
              parcelName={parcel.land_name ?? parcel.external_id}
              // Sprint B — F1.11: header de metadata + totales al final.
              // `process.env.NEXT_PUBLIC_OPERATOR_NAME` se usa para que
              // el bundle del cliente tenga el nombre del operador sin
              // hardcodearlo (Next expone las env vars prefixadas con
              // NEXT_PUBLIC_ al cliente en build time). Fallback a
              // "AeroAdmin" para dev local.
              csvMeta={{
                operatorName: process.env.NEXT_PUBLIC_OPERATOR_NAME ?? "AeroAdmin",
                generatedAt: new Date().toISOString().slice(0, 10),
                parcelLabel: `${parcel.id} - ${parcel.land_name ?? parcel.external_id}`
              }}
            />
          ) : null}
          {/* Track B v1.4: gate por role. Admin y supervisor pueden registrar
              fumigaciones (es una operacion de campo, no de admin). El patron
              RoleGate se aplica aca como ejemplo: cuando se agreguen mas
              permisos granulares, cambiar el `allow` sin tocar el resto.
              El boton "Cancelar" sigue mostrandose siempre que el form
              este abierto (mismo gate adentro del form si es necesario). */}
          <RoleGate allow={["admin", "supervisor"]}>
            <button
              className="rounded-full bg-[#0b5f2d] px-3 py-1.5 text-[11px] font-semibold text-white"
              onClick={() => setShowForm((v) => !v)}
              type="button"
            >
              {showForm ? "Cancelar" : "Registrar fumigación"}
            </button>
          </RoleGate>
        </div>
      </div>

      {showForm ? (
        <dialog
          aria-labelledby="fumigation-modal-title"
          className="w-full max-w-full bg-transparent p-0 backdrop:bg-black/50 sm:max-w-[600px] sm:m-auto sm:rounded-2xl"
          data-testid="fumigation-modal"
          onCancel={(e) => {
            // El browser dispara onCancel cuando el user aprieta Escape.
            // Prevenimos el default y manejamos el cierre nosotros para
            // también limpiar el state local (error, etc).
            e.preventDefault();
            if (!submitting) closeForm();
          }}
          onClick={(e) => {
            // Backdrop click: el dialog element tiene un "::backdrop"
            // pseudo-element que el browser no expone como child. Pero
            // el click en el <dialog> mismo (fuera del contenido)
            // funciona como "click en el backdrop" en implementaciones
            // modernas. Si el target es exactamente el dialog (no un
            // hijo), cerramos.
            if (e.target === e.currentTarget && !submitting) {
              closeForm();
            }
          }}
          ref={dialogRef}
        >
          <form
            className="flex max-h-[90vh] flex-col overflow-hidden rounded-none bg-white shadow-[0px_24px_60px_rgba(15,23,42,0.18)] sm:rounded-2xl"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              handleSubmit(fd);
            }}
          >
            <header className="flex shrink-0 items-center justify-between border-b border-[#d2ddd6] px-5 py-4">
              <div>
                <h2
                  className="text-base font-semibold text-[#121815]"
                  id="fumigation-modal-title"
                >
                  Registrar fumigación
                </h2>
                <p className="mt-0.5 text-[11px] text-[#4a5b50]">
                  {parcel.land_name ?? `Parcela #${parcel.id}`}
                </p>
              </div>
              <button
                aria-label="Cerrar"
                className="rounded-md p-1 text-[#587064] transition hover:bg-[#f4f7f4] hover:text-[#121815]"
                disabled={submitting}
                onClick={closeForm}
                type="button"
              >
                <span aria-hidden="true" className="text-xl leading-none">×</span>
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {error && (
                <p
                  className="mb-3 rounded bg-[#fff5f3] px-3 py-2 text-xs text-[#a93232]"
                  data-testid="fumigation-modal-error"
                >
                  {error}
                </p>
              )}
              <fieldset className="contents" disabled={submitting}>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Fecha *</span>
                    <input
                      className="mt-1 w-full rounded border border-[#cfd8d3] px-2 py-1.5 disabled:opacity-50"
                      defaultValue={today}
                      name="fumigation_date"
                      required
                      type="date"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Producto</span>
                    <input
                      className="mt-1 w-full rounded border border-[#cfd8d3] px-2 py-1.5 disabled:opacity-50"
                      // M10/F1.9: pre-llenar con el último producto usado en esta
                      // parcela. El caso típico es caña: misma parcela = mismo
                      // producto casi siempre. Si no hay eventos previos, queda
                      // vacío (defaultValue="" → el operador tipea el primero).
                      defaultValue={events[0]?.product_used ?? ""}
                      maxLength={200}
                      name="product_used"
                      placeholder="ej. Glifosato 1L/ha"
                      type="text"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Dosis (L/ha)</span>
                    <input
                      className="mt-1 w-full rounded border border-[#cfd8d3] px-2 py-1.5 disabled:opacity-50"
                      min="0"
                      name="dose_l_per_ha"
                      step="0.1"
                      type="number"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Área fumigada (m²)</span>
                    <input
                      className="mt-1 w-full rounded border border-[#cfd8d3] px-2 py-1.5 disabled:opacity-50"
                      min="0"
                      name="area_fumigated_m2"
                      // Track B v1.1: pre-llenado con `parcel.spray_area_m2` cuando
                      // existe (el sistema ya sabe el área fumigable). El supervisor
                      // puede ajustar si la fumigación real fue menor (obstáculos,
                      // franjas de seguridad, etc.). No pre-llenamos cuando es null/0
                      // para no inducir errores — un valor 0 no es un default razonable.
                      {...(parcel.spray_area_m2 !== null && parcel.spray_area_m2 > 0
                        ? { defaultValue: String(parcel.spray_area_m2) }
                        : {})}
                      step="0.01"
                      type="number"
                    />
                    <span className="mt-1 block text-[10px] text-[#587064]">
                      Editable si la fumigación real fue menor al área fumigable.
                    </span>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Duración (min)</span>
                    <input
                      className="mt-1 w-full rounded border border-[#cfd8d3] px-2 py-1.5 disabled:opacity-50"
                      min="0"
                      name="duration_minutes"
                      type="number"
                    />
                  </label>
                  <label className="col-span-2 block">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Operador</span>
                    <input
                      className="mt-1 w-full rounded border border-[#cfd8d3] px-2 py-1.5 disabled:opacity-50"
                      maxLength={100}
                      name="recorded_by"
                      placeholder="ej. Juan Pérez"
                      type="text"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Registro ICA del producto</span>
                    <input
                      className="mt-1 w-full rounded border border-[#cfd8d3] px-2 py-1.5 disabled:opacity-50"
                      maxLength={50}
                      name="product_registered_ica"
                      placeholder="ej. ICA-1234-PN"
                      type="text"
                    />
                    <span className="mt-1 block text-[10px] text-[#587064]">
                      Requerido para auditoría ICA. 3-50 chars, formato libre.
                    </span>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Licencia del piloto</span>
                    <input
                      className="mt-1 w-full rounded border border-[#cfd8d3] px-2 py-1.5 disabled:opacity-50"
                      maxLength={20}
                      name="pilot_license"
                      placeholder="ej. PCA-12345"
                      type="text"
                    />
                    <span className="mt-1 block text-[10px] text-[#587064]">
                      Requerido para auditoría Aerocivil. Mayúsculas, dígitos y guiones.
                    </span>
                  </label>
                  <label className="col-span-2 block">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Agregar nota (opcional)</span>
                    <textarea
                      className="mt-1 w-full rounded border border-[#cfd8d3] px-2 py-1.5 disabled:opacity-50"
                      maxLength={2000}
                      name="human_notes"
                      placeholder="ej. Se atrasó por lluvia matinal"
                      rows={2}
                    />
                    <span className="mt-1 block text-[10px] text-[#587064]">
                      Contexto libre sobre esta fumigación. No se mezcla con la metadata técnica del sistema.
                    </span>
                  </label>
                </div>
              </fieldset>
            </div>

            <footer className="sticky bottom-0 z-10 flex shrink-0 gap-2 border-t border-[#d2ddd6] bg-white px-5 py-3">
              <button
                className="rounded-full bg-[#0b5f2d] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                disabled={submitting}
                type="submit"
              >
                {submitting ? "Guardando…" : "Guardar fumigación"}
              </button>
              <button
                className="rounded-full border border-[#cfd8d3] px-4 py-2 text-xs font-semibold text-[#4a5b50] disabled:opacity-50"
                disabled={submitting}
                onClick={closeForm}
                type="button"
              >
                Cancelar
              </button>
            </footer>
          </form>
        </dialog>
      ) : null}

      {events.length === 0 ? (
        <RoleGate
          allow={["admin", "supervisor"]}
          fallback={
            <EmptyState
              description="Cuando registres la primera fumigación, la cadencia recomendada se calcula automáticamente y el panel se actualiza con la próxima fecha objetivo."
              size="sm"
              testId="parcel-fumigations-empty"
              title="Esta parcela aún no tiene fumigaciones"
            />
          }
        >
          <EmptyState
            cta={{ label: "Registrar fumigación", onClick: () => setShowForm(true) }}
            description="Cuando registres la primera fumigación, la cadencia recomendada se calcula automáticamente y el panel se actualiza con la próxima fecha objetivo."
            size="sm"
            testId="parcel-fumigations-empty"
            title="Esta parcela aún no tiene fumigaciones"
          />
        </RoleGate>
      ) : (
        <ol className="space-y-2">
          {events.map((e) => {
            const dateStr = toDateString(e.fumigation_date) ?? "";
            return (
              <li
                className="flex items-start gap-3 rounded-lg border border-[#eef2ee] bg-white p-3"
                key={e.id}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0b5f2d]/10 text-[10px] font-bold text-[#0b5f2d]">
                  {dateStr.slice(5)}
                </div>
                <div className="flex-1 text-sm">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <strong className="text-[#121815]">{dateStr}</strong>
                    {e.product_used && (
                      <span className="text-[#4a5b50]">— {e.product_used}</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-[#4a5b50]">
                    {e.dose_l_per_ha && <span>Dosis: {e.dose_l_per_ha} L/ha</span>}
                    {e.duration_minutes && <span>{e.duration_minutes} min</span>}
                    {e.recorded_by && <span>Por: {e.recorded_by}</span>}
                    {e.product_registered_ica && (
                      <span
                        className="text-[#587064]"
                        data-testid="fumigation-ica"
                        title="Registro ICA del producto (auditoría ICA)"
                      >
                        ICA: {e.product_registered_ica}
                      </span>
                    )}
                    {e.pilot_license && (
                      <span
                        className="text-[#587064]"
                        data-testid="fumigation-pilot-license"
                        title="Licencia del piloto (auditoría Aerocivil)"
                      >
                        Piloto: {e.pilot_license}
                      </span>
                    )}
                  </div>
                  {e.human_notes && (
                    <p className="mt-1 text-[11px] italic text-[#4a5b50]" data-testid="fumigation-human-notes">
                      {e.human_notes}
                    </p>
                  )}
                  {e.notes && !isProvenanceNotes(e.notes) && (
                    <p className="mt-1 text-[11px] italic text-[#4a5b50]">{e.notes}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
