"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { DjiParcelRecord } from "@/lib/types";

interface ParcelEditPanelProps {
  parcel: DjiParcelRecord;
  /**
   * Modo controlado: si se provee `editing` + `onClose` + `onOpen`, el
   * componente NO mantiene estado interno — el padre es dueño del estado.
   * Esto permite que otros componentes (ej. botón "Editar" en la sección
   * Contexto del ParcelDetail) abran el mismo form sin refactorizar el
   * estado. Si NO se proveen, el componente usa estado interno (back-compat
   * para tests existentes que renderizan el panel sin props de control).
   */
  editing?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}

/**
 * Editor inline para los campos editables de una parcela (metadata).
 * Whitelist: land_name, field_type, declared_area_ha, spray_area_m2,
 *            crop_type, planting_date, owner_name, owner_contact, supervisor_notes.
 * El resto (external_id, geometrias, drone_model) viene del importer DJI y no se toca aqui.
 *
 * UX: boton "Editar" -> muestra form pre-poblado -> "Guardar" PUT /api/parcels/[id]
 *      -> "Cancelar" revierte. Errores se muestran inline.
 *
 * Sprint 2026-07-22: se agregaron crop_type, planting_date, owner_name,
 * owner_contact, supervisor_notes (metadata humana que DJI no expone).
 */
export function ParcelEditPanel({ parcel, editing: editingProp, onOpen, onClose }: ParcelEditPanelProps) {
  const router = useRouter();
  // Estado interno (back-compat) o controlado (cuando vienen props).
  const [internalEditing, setInternalEditing] = useState(false);
  const controlled = editingProp !== undefined;
  const editing = controlled ? editingProp : internalEditing;
  const setEditing = controlled
    ? (next: boolean) => {
        if (!next) onClose?.();
      }
    : setInternalEditing;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    land_name: parcel.land_name ?? "",
    field_type: parcel.field_type ?? "Farmland",
    declared_area_ha: parcel.declared_area_ha ?? null,
    spray_area_m2: parcel.spray_area_m2 ?? null,
    crop_type: parcel.crop_type ?? "",
    planting_date: parcel.planting_date ?? "",
    owner_name: parcel.owner_name ?? "",
    owner_contact: parcel.owner_contact ?? "",
    supervisor_notes: parcel.supervisor_notes ?? ""
  });

  function startEdit() {
    setForm({
      land_name: parcel.land_name ?? "",
      field_type: parcel.field_type ?? "Farmland",
      declared_area_ha: parcel.declared_area_ha ?? null,
      spray_area_m2: parcel.spray_area_m2 ?? null,
      crop_type: parcel.crop_type ?? "",
      planting_date: parcel.planting_date ?? "",
      owner_name: parcel.owner_name ?? "",
      owner_contact: parcel.owner_contact ?? "",
      supervisor_notes: parcel.supervisor_notes ?? ""
    });
    setError(null);
    if (controlled) {
      // El padre mantiene el estado de editing — avisamos que se pidió abrir.
      onOpen?.();
    } else {
      setInternalEditing(true);
    }
  }

  function cancel() {
    if (controlled) {
      onClose?.();
    } else {
      setInternalEditing(false);
    }
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      // Si vacio -> null (clear)
      // Si igual al original -> no incluir (no-op)
      const trim = (v: string) => (v.trim() === "" ? null : v.trim());

      const newLandName = trim(form.land_name);
      if (newLandName !== (parcel.land_name ?? null)) body.land_name = newLandName;
      if (form.field_type !== parcel.field_type) body.field_type = form.field_type;
      if (form.declared_area_ha !== parcel.declared_area_ha) body.declared_area_ha = form.declared_area_ha;
      if (form.spray_area_m2 !== parcel.spray_area_m2) body.spray_area_m2 = form.spray_area_m2;

      const newCropType = trim(form.crop_type);
      if (newCropType !== (parcel.crop_type ?? null)) body.crop_type = newCropType;
      const newPlantingDate = trim(form.planting_date);
      if (newPlantingDate !== (parcel.planting_date ?? null)) body.planting_date = newPlantingDate;
      const newOwnerName = trim(form.owner_name);
      if (newOwnerName !== (parcel.owner_name ?? null)) body.owner_name = newOwnerName;
      const newOwnerContact = trim(form.owner_contact);
      if (newOwnerContact !== (parcel.owner_contact ?? null)) body.owner_contact = newOwnerContact;
      const newSupervisorNotes = trim(form.supervisor_notes);
      if (newSupervisorNotes !== (parcel.supervisor_notes ?? null)) body.supervisor_notes = newSupervisorNotes;

      if (Object.keys(body).length === 0) {
        setEditing(false);
        setSaving(false);
        return;
      }

      const res = await fetch(`/api/parcels/${parcel.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Error ${res.status}`);
      }
      setEditing(false);
      router.refresh(); // re-fetch server component
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex justify-end">
        <button
          className="rounded-full border border-[#0b5f2d] px-4 py-1.5 text-xs font-semibold text-[#0b5f2d] transition hover:bg-[#0b5f2d] hover:text-white"
          data-testid="parcel-edit-metadata-button"
          onClick={startEdit}
          type="button"
        >
          Editar metadata
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#0b5f2d] bg-[#f7f9fb] p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0b5f2d]">Editar metadata</p>
        <p className="text-[10px] text-[#4a5b50]">DJI no expone estos datos. Los llena el supervisor una vez por parcela.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Nombre visible</span>
          <input
            className="mt-1 w-full rounded-lg border border-[#cfd8d3] bg-white px-3 py-2 text-sm"
            maxLength={200}
            onChange={(e) => setForm({ ...form, land_name: e.target.value })}
            placeholder="(vacio = sin nombre)"
            type="text"
            value={form.land_name}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Tipo</span>
          <select
            className="mt-1 w-full rounded-lg border border-[#cfd8d3] bg-white px-3 py-2 text-sm"
            onChange={(e) => setForm({ ...form, field_type: e.target.value })}
            value={form.field_type}
          >
            <option value="Farmland">Farmland (cultivo)</option>
            <option value="Orchards">Orchards (huerto)</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Cultivo</span>
          <input
            className="mt-1 w-full rounded-lg border border-[#cfd8d3] bg-white px-3 py-2 text-sm"
            maxLength={100}
            onChange={(e) => setForm({ ...form, crop_type: e.target.value })}
            placeholder="Caña de azúcar, maíz, arroz…"
            type="text"
            value={form.crop_type}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Fecha de siembra</span>
          <input
            className="mt-1 w-full rounded-lg border border-[#cfd8d3] bg-white px-3 py-2 text-sm"
            onChange={(e) => setForm({ ...form, planting_date: e.target.value })}
            type="date"
            value={form.planting_date}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Propietario</span>
          <input
            className="mt-1 w-full rounded-lg border border-[#cfd8d3] bg-white px-3 py-2 text-sm"
            maxLength={200}
            onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
            placeholder="Nombre del cañero / propietario"
            type="text"
            value={form.owner_name}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Contacto</span>
          <input
            className="mt-1 w-full rounded-lg border border-[#cfd8d3] bg-white px-3 py-2 text-sm"
            maxLength={200}
            onChange={(e) => setForm({ ...form, owner_contact: e.target.value })}
            placeholder="+57 300 123 4567 o email"
            type="text"
            value={form.owner_contact}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Area declarada (ha)</span>
          <input
            className="mt-1 w-full rounded-lg border border-[#cfd8d3] bg-white px-3 py-2 text-sm"
            max={100000}
            min={0}
            onChange={(e) => setForm({ ...form, declared_area_ha: e.target.value === "" ? null : Number(e.target.value) })}
            step="0.01"
            type="number"
            value={form.declared_area_ha ?? ""}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Area fumigable (m&sup2;)</span>
          <input
            className="mt-1 w-full rounded-lg border border-[#cfd8d3] bg-white px-3 py-2 text-sm"
            max={1e9}
            min={0}
            onChange={(e) => setForm({ ...form, spray_area_m2: e.target.value === "" ? null : Number(e.target.value) })}
            step="0.01"
            type="number"
            value={form.spray_area_m2 ?? ""}
          />
        </label>
        <label className="block md:col-span-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">Notas del supervisor</span>
          <textarea
            className="mt-1 w-full rounded-lg border border-[#cfd8d3] bg-white px-3 py-2 text-sm"
            maxLength={2000}
            onChange={(e) => setForm({ ...form, supervisor_notes: e.target.value })}
            placeholder="Contexto, restricciones, acuerdos con el propietario, etc."
            rows={3}
            value={form.supervisor_notes}
          />
        </label>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#a93232]">{error}</p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          className="rounded-full bg-[#0b5f2d] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0e7a3c] disabled:opacity-50"
          disabled={saving}
          onClick={save}
          type="button"
        >
          {saving ? "Guardando..." : "Guardar"}
        </button>
        <button
          className="rounded-full border border-[#cfd8d3] px-4 py-2 text-sm font-semibold text-[#4a5b50] transition hover:bg-white"
          disabled={saving}
          onClick={cancel}
          type="button"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}