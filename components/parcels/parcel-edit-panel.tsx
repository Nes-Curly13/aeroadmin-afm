"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { DjiParcelRecord } from "@/lib/types";

interface ParcelEditPanelProps {
  parcel: DjiParcelRecord;
}

/**
 * Editor inline para los campos editables de una parcela (metadata).
 * Whitelist: land_name, field_type, declared_area_ha, spray_area_m2.
 * El resto (external_id, geometrias, drone_model) viene del importer DJI y no se toca aqui.
 *
 * UX: boton "Editar" -> muestra form pre-poblado -> "Guardar" PUT /api/parcels/[id]
 *      -> "Cancelar" revierte. Errores se muestran inline.
 */
export function ParcelEditPanel({ parcel }: ParcelEditPanelProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    land_name: parcel.land_name ?? "",
    field_type: parcel.field_type ?? "Farmland",
    declared_area_ha: parcel.declared_area_ha ?? null,
    spray_area_m2: parcel.spray_area_m2 ?? null
  });

  function startEdit() {
    setForm({
      land_name: parcel.land_name ?? "",
      field_type: parcel.field_type ?? "Farmland",
      declared_area_ha: parcel.declared_area_ha ?? null,
      spray_area_m2: parcel.spray_area_m2 ?? null
    });
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      // Si land_name vacio -> null (clear)
      // Si igual al original -> no incluir (no-op)
      const newLandName = form.land_name.trim() === "" ? null : form.land_name.trim();
      if (newLandName !== (parcel.land_name ?? null)) body.land_name = newLandName;
      if (form.field_type !== parcel.field_type) body.field_type = form.field_type;
      if (form.declared_area_ha !== parcel.declared_area_ha) body.declared_area_ha = form.declared_area_ha;
      if (form.spray_area_m2 !== parcel.spray_area_m2) body.spray_area_m2 = form.spray_area_m2;

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
        <p className="text-[10px] text-[#4a5b50]">Solo nombre visible, tipo y areas. Geometrias DJI no se tocan.</p>
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