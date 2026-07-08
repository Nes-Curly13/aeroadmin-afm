"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CadenceEditorProps {
  parcelId: number;
  currentCadence: number;
}

/**
 * Editor inline para la cadencia esperada (recommended_cadence_days).
 * PATCH /api/fumigation-schedule/[parcelId].
 * Crea el schedule si no existe, lo actualiza si existe.
 */
export function CadenceEditor({ parcelId, currentCadence }: CadenceEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(currentCadence);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/fumigation-schedule/${parcelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommended_cadence_days: value })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Error ${res.status}`);
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        className="rounded-full border border-[#cfd8d3] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#0b5f2d] transition hover:bg-[#dbe7df]"
        onClick={() => {
          setValue(currentCadence);
          setError(null);
          setEditing(true);
        }}
        type="button"
      >
        Editar cadencia
      </button>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-[#0b5f2d] bg-white p-3">
      <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">
        Cadencia (días)
      </label>
      <input
        className="w-20 rounded-lg border border-[#cfd8d3] px-2 py-1 text-sm"
        max={365}
        min={1}
        onChange={(e) => setValue(Number(e.target.value))}
        type="number"
        value={value}
      />
      <button
        className="rounded-full bg-[#0b5f2d] px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
        disabled={saving}
        onClick={save}
        type="button"
      >
        {saving ? "..." : "OK"}
      </button>
      <button
        className="rounded-full border border-[#cfd8d3] px-3 py-1 text-xs font-semibold text-[#4a5b50] disabled:opacity-50"
        disabled={saving}
        onClick={() => setEditing(false)}
        type="button"
      >
        Cancelar
      </button>
      {error ? <span className="text-[11px] text-[#a93232]">{error}</span> : null}
    </div>
  );
}