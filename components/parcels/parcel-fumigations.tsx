"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { isProvenanceNotes, toDateString } from "@/lib/format";
import type { DjiFumigationEvent, DjiFumigationSchedule, DjiParcelRecord } from "@/lib/types";

import { CadenceEditor } from "@/components/parcels/cadence-editor";
import { ExportFumigationsCsvButton } from "@/components/parcels/export-fumigations-csv-button";
import { EmptyState } from "@/components/ui/empty-state";

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
  const chip = statusChip(status, daysUntilNextDue);

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
        recorded_by: formData.get("recorded_by") || null
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
          {events.length > 0 ? (
            <ExportFumigationsCsvButton
              events={events}
              parcelDroneName={parcel.drone_model_name}
              parcelName={parcel.land_name ?? parcel.external_id}
            />
          ) : null}
          <button
            className="rounded-full bg-[#0b5f2d] px-3 py-1.5 text-[11px] font-semibold text-white"
            onClick={() => setShowForm((v) => !v)}
            type="button"
          >
            {showForm ? "Cancelar" : "Registrar fumigación"}
          </button>
        </div>
      </div>

      {showForm ? (
        <form
          className="mb-4 space-y-3 rounded-lg border border-[#d2ddd6] bg-[#f7f9fb] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            handleSubmit(fd);
          }}
        >
          {error && (
            <p className="rounded bg-[#fff5f3] px-3 py-2 text-xs text-[#a93232]">{error}</p>
          )}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Fecha *</span>
              <input
                className="mt-1 w-full rounded border border-[#cfd8d3] px-2 py-1.5"
                defaultValue={today}
                name="fumigation_date"
                required
                type="date"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Producto</span>
              <input
                className="mt-1 w-full rounded border border-[#cfd8d3] px-2 py-1.5"
                maxLength={200}
                name="product_used"
                placeholder="ej. Glifosato 1L/ha"
                type="text"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Dosis (L/ha)</span>
              <input
                className="mt-1 w-full rounded border border-[#cfd8d3] px-2 py-1.5"
                min="0"
                name="dose_l_per_ha"
                step="0.1"
                type="number"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Área fumigada (m²)</span>
              <input
                className="mt-1 w-full rounded border border-[#cfd8d3] px-2 py-1.5"
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
                className="mt-1 w-full rounded border border-[#cfd8d3] px-2 py-1.5"
                min="0"
                name="duration_minutes"
                type="number"
              />
            </label>
            <label className="col-span-2 block">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Operador</span>
              <input
                className="mt-1 w-full rounded border border-[#cfd8d3] px-2 py-1.5"
                maxLength={100}
                name="recorded_by"
                placeholder="ej. Juan Pérez"
                type="text"
              />
            </label>
            <label className="col-span-2 block">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Agregar nota (opcional)</span>
              <textarea
                className="mt-1 w-full rounded border border-[#cfd8d3] px-2 py-1.5"
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
          <div className="flex gap-2">
            <button
              className="rounded-full bg-[#0b5f2d] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              disabled={submitting}
              type="submit"
            >
              {submitting ? "Guardando…" : "Guardar fumigación"}
            </button>
            <button
              className="rounded-full border border-[#cfd8d3] px-4 py-2 text-xs font-semibold text-[#4a5b50]"
              onClick={() => setShowForm(false)}
              type="button"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      {events.length === 0 ? (
        <EmptyState
          cta={{ label: "Registrar fumigación", onClick: () => setShowForm(true) }}
          description="Cuando registres la primera fumigación, la cadencia recomendada se calcula automáticamente y el panel se actualiza con la próxima fecha objetivo."
          size="sm"
          testId="parcel-fumigations-empty"
          title="Esta parcela aún no tiene fumigaciones"
        />
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
