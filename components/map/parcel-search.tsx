"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ParcelSelector } from "@/components/map/parcel-selector";
import type { DjiParcelRecord } from "@/lib/types";

export interface ParcelSearchProps {
  parcels: DjiParcelRecord[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

/**
 * Search + selector de parcelas para el panel del mapa.
 *
 * Filtra `parcels` por `land_name` (case-insensitive, includes) y delega el
 * render del `<select>` al `ParcelSelector` existente. El atajo de teclado `/`
 * enfoca el input de búsqueda cuando el usuario NO está escribiendo en otro
 * input/textarea (estilo GitHub).
 *
 * (Q3 / audit 4.6) Antes el operador tenía que scrollear el dropdown cuando
 * el catálogo crecía. Con la búsqueda, acceder a cualquier parcela es O(1)
 * en cantidad de tecleos.
 */
export function ParcelSearch({ parcels, selectedId, onSelect }: ParcelSearchProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmedQuery = query.trim();
  const filtered = useMemo(() => {
    if (!trimmedQuery) return parcels;
    const needle = trimmedQuery.toLowerCase();
    return parcels.filter((p) => (p.land_name ?? "").toLowerCase().includes(needle));
  }, [parcels, trimmedQuery]);

  // Atajo de teclado: "/" enfoca el input de búsqueda (estilo GitHub).
  // No se dispara si el foco está en otro input/textarea/contenteditable.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "/") return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Sin parcelas en el catálogo: delegamos al ParcelSelector para que muestre
  // su propio empty state ("no hay parcelas importadas"). No tiene sentido
  // mostrar el input de búsqueda si no hay nada que filtrar.
  if (parcels.length === 0) {
    return <ParcelSelector onSelect={onSelect} parcels={parcels} selectedId={selectedId} />;
  }

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="sr-only">Buscar parcela por nombre</span>
        <input
          aria-label="Buscar parcela por nombre"
          className="w-full rounded-lg border border-[#cfd8d3] p-2 text-sm"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar parcela por nombre…"
          ref={inputRef}
          type="search"
          value={query}
        />
      </label>

      {trimmedQuery && filtered.length === 0 ? (
        <div className="rounded-xl border border-[#eef2ee] bg-[#f4f7f4] p-4 text-sm text-[#4a5b50]">
          Sin coincidencias para «{trimmedQuery}»
        </div>
      ) : (
        <ParcelSelector onSelect={onSelect} parcels={filtered} selectedId={selectedId} />
      )}
    </div>
  );
}
