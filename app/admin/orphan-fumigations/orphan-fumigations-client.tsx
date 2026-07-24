"use client";

// app/admin/orphan-fumigations/orphan-fumigations-client.tsx
//
// Sprint G1 — cliente de la página de huérfanas.
//
// Tabla con 1 fila por fumigación huérfana + selector de parcela + botón
// "Vincular". Al vincular, hace POST al endpoint
// /api/fumigations/[id]/link y, si el server responde `linked`, refresca
// la página con router.refresh() para que la fila desaparezca.
//
// Decisiones:
//   - Sin paginación client-side: las huérfanas son pocas (en este
//     dataset son 30). Si llegan a más de 100, agregamos
//     react-paginate o links de página siguiente/anterior.
//   - El select usa `<option>` nativos en vez de un combobox custom
//     (mantengo el bundle chico y la UX es buena con 200 opciones).
//   - El botón muestra un spinner mientras la request está en vuelo
//     y deshabilita para evitar doble submit.

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";

import { toDateString } from "@/lib/format";
import type { DjiFumigationEvent } from "@/lib/types";

interface ParcelOption {
  id: number;
  label: string;
}

interface DbStats {
  total: number;
  orphan: number;
  manual: number;
  import: number;
  djiscraper: number;
  parcelasConFumigacion: number;
  totalParcelas: number;
  coberturaPct: number;
}

interface OrphanFumigationsClientProps {
  initialRows: DjiFumigationEvent[];
  total: number;
  totalPages: number;
  initialPage: number;
  parcelOptions: ParcelOption[];
  dbStats: DbStats;
}

export function OrphanFumigationsClient({
  initialRows,
  total,
  totalPages,
  initialPage,
  parcelOptions,
  dbStats
}: OrphanFumigationsClientProps) {
  const router = useRouter();
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [selectedParcel, setSelectedParcel] = useState<Record<number, number | "">>({});
  const [, startTransition] = useTransition();

  async function handleLink(fumigationId: number) {
    const parcelId = selectedParcel[fumigationId];
    if (!parcelId) {
      setError("Seleccioná una parcela antes de vincular.");
      return;
    }
    setError(null);
    setInfo(null);
    setSubmittingId(fumigationId);
    try {
      const res = await fetch(`/api/fumigations/${fumigationId}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parcel_id: parcelId })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      if (body.status === "linked") {
        setInfo("Vinculada. Refrescando…");
        // router.refresh() re-fetcha la page en el server (re-llama al
        // repository con el parcel_id nuevo). La fila desaparece
        // automáticamente porque la query filtra parcel_id IS NULL.
        startTransition(() => router.refresh());
      } else if (body.status === "already_assigned") {
        setError("Esta fumigación ya estaba asignada. Refrescando…");
        startTransition(() => router.refresh());
      } else if (body.status === "not_found") {
        setError("No se encontró la fumigación o la parcela. Refrescando…");
        startTransition(() => router.refresh());
      } else {
        setError(`Estado inesperado: ${body.status ?? "(vacío)"}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al vincular");
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div className="space-y-5" data-testid="orphan-fumigations-page">
      {/* KPIs globales — da contexto de por qué importa esto */}
      <section
        aria-label="Estadísticas globales"
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <Kpi label="Fumigaciones totales" value={dbStats.total.toLocaleString("es-CO")} />
        <Kpi
          label="Huérfanas (sin parcela)"
          tone="warn"
          value={dbStats.orphan.toLocaleString("es-CO")}
        />
        <Kpi
          label="Cobertura"
          value={`${dbStats.coberturaPct.toFixed(1)}%`}
        />
        <Kpi
          label="Manuales (operador)"
          value={dbStats.manual.toLocaleString("es-CO")}
        />
      </section>

      {error ? (
        <p
          className="rounded-lg bg-[#fff5f3] px-3 py-2 text-xs text-[#a93232]"
          data-testid="orphan-fumigations-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {info ? (
        <p
          className="rounded-lg bg-[#0b5f2d]/10 px-3 py-2 text-xs text-[#0b5f2d]"
          data-testid="orphan-fumigations-info"
          role="status"
        >
          {info}
        </p>
      ) : null}

      {initialRows.length === 0 ? (
        <p
          className="rounded-2xl border border-[#d2ddd6] bg-white p-5 text-sm text-[#4a5b50]"
          data-testid="orphan-fumigations-empty"
        >
          No quedan fumigaciones huérfanas. Todas las fumigaciones del import están asignadas a una parcela. 🎉
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#d2ddd6] bg-white">
          <table className="w-full text-sm" data-testid="orphan-fumigations-table">
            <thead className="bg-[#f4f7f4] text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Área (m²)</th>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-left">Vincular a</th>
                <th className="px-3 py-2 text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {initialRows.map((row) => {
                const date = toDateString(row.fumigation_date) ?? "—";
                const isSubmitting = submittingId === row.id;
                return (
                  <tr
                    className="border-t border-[#eef2ee] align-top"
                    data-testid="orphan-fumigations-row"
                    key={row.id}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{date}</td>
                    <td className="px-3 py-2 text-[#4a5b50]">
                      {row.area_fumigated_m2?.toLocaleString("es-CO", { maximumFractionDigits: 0 }) ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-[#4a5b50]">
                      {row.product_used ?? <span className="italic text-[#587064]">(no registrado)</span>}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        aria-label="Parcela destino"
                        className="w-full max-w-[320px] rounded border border-[#cfd8d3] px-2 py-1 text-xs disabled:opacity-50"
                        data-testid="orphan-fumigations-select"
                        disabled={isSubmitting}
                        onChange={(e) =>
                          setSelectedParcel((prev) => ({
                            ...prev,
                            [row.id]: e.target.value ? Number(e.target.value) : ""
                          }))
                        }
                        value={selectedParcel[row.id] ?? ""}
                      >
                        <option value="">— Elegir parcela —</option>
                        {parcelOptions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        className="rounded-full bg-[#0b5f2d] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                        data-testid="orphan-fumigations-link-button"
                        disabled={isSubmitting || !selectedParcel[row.id]}
                        onClick={() => handleLink(row.id)}
                        type="button"
                      >
                        {isSubmitting ? "Vinculando…" : "Vincular"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginación: solo si hay más de 1 página */}
      {totalPages > 1 ? (
        <nav
          aria-label="Paginación"
          className="flex items-center justify-between text-xs text-[#4a5b50]"
        >
          <span>
            Página {initialPage} de {totalPages} ({total.toLocaleString("es-CO")} huérfanas en total)
          </span>
          <div className="flex items-center gap-2">
            {initialPage > 1 ? (
              <Link
                className="rounded-full border border-[#cfd8d3] px-3 py-1.5 font-semibold text-[#0b5f2d]"
                href={`/admin/orphan-fumigations?page=${initialPage - 1}`}
              >
                ← Anterior
              </Link>
            ) : null}
            {initialPage < totalPages ? (
              <Link
                className="rounded-full border border-[#cfd8d3] px-3 py-1.5 font-semibold text-[#0b5f2d]"
                href={`/admin/orphan-fumigations?page=${initialPage + 1}`}
              >
                Siguiente →
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        tone === "warn"
          ? "border-[#d4b23c]/40 bg-[#fdf6e3]"
          : "border-[#d2ddd6] bg-white"
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]">
        {label}
      </p>
      <p
        className={`mt-1 text-xl font-bold ${
          tone === "warn" ? "text-[#7a5f0d]" : "text-[#121815]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
