"use client";

/**
 * AdminParcelsClient — UI de edición inline de los 4 campos V0.
 *
 * Patrón:
 *   - Para cada parcel, 4 inputs (client_name, farm_name, municipality,
 *     variety) inicializados con el valor actual de la BD.
 *   - Boton "Guardar" deshabilitado hasta que algo cambie.
 *   - Optimistic update: al click, cambiamos el UI inmediatamente
 *     y enviamos PATCH al server. Si falla, rollback + toast error.
 *   - Al success, NO recargamos la pagina completa (eso reinicia el
 *     state de TODOS los inputs en otras rows). En su lugar,
 *     `router.refresh()` re-fetcha los datos del server component y
 *     React reconcilia.
 *
 * El client component NO toca Supabase directo — va por el API route
 * `/api/admin/parcels/[id]/metadata` que valida + actualiza + invalida
 * caches. Esto mantiene el principio de "api/ es la unica capa de
 * data access" del AGENTS.md.
 *
 * Por que `useTransition` en lugar de `useState` para el loading:
 *   - `useTransition` marca la actualizacion como no-urgente, asi
 *     React puede intercalar renders y la UI no se congela al click.
 *   - El input sigue respondiendo a cambios mientras el PATCH corre.
 */

import { Check, Loader2, Plus, RotateCcw, Save, Search, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fmtDec } from "@/lib/format";
import type { DjiParcelRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AdminParcelsClientProps {
  initialData: DjiParcelRecord[];
  total: number;
  page: number;
  totalPages: number;
  pageSize: number;
  initialQuery: string;
  /**
   * Estado inicial de los filtros "mostrar solo con X vacío"
   * (QA gap cerrado 2026-08-02). El page server los parsea de
   * searchParams y los pasa acá. El client los refleja como
   * checkboxes que al cambiar hacen `router.push` con la nueva URL
   * (el server re-fetcha la lista con el filtro activo).
   */
  missingFilter: {
    client: boolean;
    farm: boolean;
    municipality: boolean;
    variety: boolean;
  };
}

interface Draft {
  client_name: string;
  farm_name: string;
  municipality: string;
  variety: string;
}

type Status = "idle" | "saving" | "saved" | "error";

export function AdminParcelsClient({
  initialData,
  total,
  page,
  totalPages,
  pageSize,
  initialQuery,
  missingFilter
}: AdminParcelsClientProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  // Filtros "missing_X" (QA 2026-08-02). Reflejan el state de la URL
  // (server-authoritative). El user cambia un checkbox → onClick
  // hace `go(1)` con la nueva URL → server re-fetcha → re-render.
  const [missing, setMissing] = useState(missingFilter);
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() => buildDrafts(initialData));
  const [statuses, setStatuses] = useState<Record<number, Status>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-hidratar drafts cuando el server fetcha datos nuevos (router.refresh).
  // Mantenemos los drafts en curso si los inputs cambiaron desde la BD.
  useEffect(() => {
    setDrafts((prev) => {
      const next = buildDrafts(initialData);
      // Preserva edits en curso del usuario (no los pisa con datos stale).
      for (const p of initialData) {
        const d = prev[p.id];
        if (!d) continue;
        // Solo conserva el draft si el usuario lo modifico (no es igual al valor server).
        const server = {
          client_name: p.client_name ?? "",
          farm_name: p.farm_name ?? "",
          municipality: p.municipality ?? "",
          variety: p.variety ?? ""
        };
        const userChanged = Object.keys(server).some((k) => d[k as keyof Draft] !== server[k as keyof Draft]);
        if (userChanged) next[p.id] = d;
      }
      return next;
    });
  }, [initialData]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initialData;
    return initialData.filter((p) => {
      const fields = [
        p.land_name ?? "",
        p.external_id,
        p.client_name ?? "",
        p.farm_name ?? "",
        p.municipality ?? "",
        p.variety ?? ""
      ];
      return fields.some((f) => f.toLowerCase().includes(q));
    });
  }, [initialData, query]);

  function updateDraft(id: number, key: keyof Draft, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? emptyDraft()), [key]: value }
    }));
    // Si el server respondio con "saved" y el usuario toca un campo,
    // limpiamos el badge para que el check no quede "viejo".
    if (statuses[id] === "saved" || statuses[id] === "error") {
      setStatuses((prev) => ({ ...prev, [id]: "idle" }));
      setErrors((prev) => ({ ...prev, [id]: "" }));
    }
  }

  function isDirty(parcel: DjiParcelRecord, d: Draft): boolean {
    return (
      (parcel.client_name ?? "") !== d.client_name ||
      (parcel.farm_name ?? "") !== d.farm_name ||
      (parcel.municipality ?? "") !== d.municipality ||
      (parcel.variety ?? "") !== d.variety
    );
  }

  async function save(parcel: DjiParcelRecord) {
    const draft = drafts[parcel.id];
    if (!draft) return;
    if (!isDirty(parcel, draft)) return;

    setStatuses((prev) => ({ ...prev, [parcel.id]: "saving" }));
    setErrors((prev) => ({ ...prev, [parcel.id]: "" }));

    // Construimos el patch: solo los campos que difieren de la BD.
    // Si el usuario dejo el input en "", mandamos "" (no null) para
    // distinguir "clear" de "no tocar" (en la BD el server usa
    // `params.push(patch.X ?? null)` asi que string "" vacio llega
    // como "" a la columna TEXT — no se guarda como null).
    const patch: Record<string, string> = {};
    if ((parcel.client_name ?? "") !== draft.client_name) patch.client_name = draft.client_name;
    if ((parcel.farm_name ?? "") !== draft.farm_name) patch.farm_name = draft.farm_name;
    if ((parcel.municipality ?? "") !== draft.municipality) patch.municipality = draft.municipality;
    if ((parcel.variety ?? "") !== draft.variety) patch.variety = draft.variety;

    try {
      const res = await fetch(`/api/admin/parcels/${parcel.id}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStatuses((prev) => ({ ...prev, [parcel.id]: "error" }));
        setErrors((prev) => ({
          ...prev,
          [parcel.id]: body.error ?? `HTTP ${res.status}`
        }));
        return;
      }
      setStatuses((prev) => ({ ...prev, [parcel.id]: "saved" }));
      // Refresh silencioso para que otras rows que dependan de este
      // valor (e.g. dropdowns de filter) se actualicen. Debounce para
      // no martillar el server si el usuario guarda 20 rows en 5 seg.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        startTransition(() => router.refresh());
      }, 800);
    } catch (err) {
      setStatuses((prev) => ({ ...prev, [parcel.id]: "error" }));
      setErrors((prev) => ({
        ...prev,
        [parcel.id]: err instanceof Error ? err.message : "error de red"
      }));
    }
  }

  function revert(parcel: DjiParcelRecord) {
    setDrafts((prev) => ({
      ...prev,
      [parcel.id]: {
        client_name: parcel.client_name ?? "",
        farm_name: parcel.farm_name ?? "",
        municipality: parcel.municipality ?? "",
        variety: parcel.variety ?? ""
      }
    }));
    setStatuses((prev) => ({ ...prev, [parcel.id]: "idle" }));
    setErrors((prev) => ({ ...prev, [parcel.id]: "" }));
  }

  // Paginacion. Incluye los filtros "missing_X" en la URL para
  // que persistan entre páginas. El handler del page server los
  // re-parsea (searchParams).
  function buildSearchParams(extraPage: number): URLSearchParams {
    const params = new URLSearchParams();
    params.set("page", String(extraPage));
    if (query) params.set("q", query);
    if (missing.client) params.set("missing_client", "1");
    if (missing.farm) params.set("missing_farm", "1");
    if (missing.municipality) params.set("missing_municipality", "1");
    if (missing.variety) params.set("missing_variety", "1");
    return params;
  }
  function go(p: number) {
    if (p < 1 || p > totalPages || p === page) return;
    router.push(`/admin/parcels?${buildSearchParams(p).toString()}`);
  }

  // Toggle de un filtro "missing_X". Re-fetcha a la primera página
  // (los filtros cambian el total, hay que resetear la paginación).
  function toggleMissing(field: keyof typeof missing) {
    const next = { ...missing, [field]: !missing[field] };
    setMissing(next);
    // Construir params con el nuevo state (no `missing` del closure,
    // que todavía tiene el valor anterior a setMissing).
    const params = new URLSearchParams();
    params.set("page", "1");
    if (query) params.set("q", query);
    if (next.client) params.set("missing_client", "1");
    if (next.farm) params.set("missing_farm", "1");
    if (next.municipality) params.set("missing_municipality", "1");
    if (next.variety) params.set("missing_variety", "1");
    router.push(`/admin/parcels?${params.toString()}`);
  }

  // Limpia todos los filtros missing. (El search input tiene su
  // propio state local — no se limpia acá porque no se borra
  // la query escrita por el user.)
  function clearMissingFilters() {
    setMissing({ client: false, farm: false, municipality: false, variety: false });
    const params = new URLSearchParams();
    params.set("page", "1");
    if (query) params.set("q", query);
    router.push(`/admin/parcels?${params.toString()}`);
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, ID externo, cliente, hacienda, municipio o variedad…"
            aria-label="Buscar parcela"
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-3">
          <p className="font-mono text-[11px] text-muted-foreground">
            {`${filtered.length} de ${total} parcelas · página ${page}/${totalPages || 1} · ${pageSize}/página`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  href="/admin/parcels/import"
                  aria-label="Importar parcelas desde archivo GIS (KML/SHP/GPKG)"
                >
                  <Upload className="size-3.5" aria-hidden />
                  Importar GIS
                </Link>
              }
            />
            <Button
              size="sm"
              nativeButton={false}
              render={
                <Link
                  href="/admin/parcels/new"
                  aria-label="Crear parcela nueva (alta manual)"
                >
                  <Plus className="size-3.5" aria-hidden />
                  Crear parcela
                </Link>
              }
            />
          </div>
        </div>
      </div>

      {/* Filtros "mostrar solo con X vacío" (QA 2026-08-02). El
          operador fumigador tiene 1213 parcelas y los 4 campos V0
          arrancan vacíos — sin este filtro tendría que ir página
          por página para encontrarlas. Cada checkbox dispara un
          `router.push` con la nueva URL; el server re-fetcha con
          el WHERE clause apropiado. El badge "X filtros activos"
          aparece a la derecha cuando hay alguno. */}
      <div
        role="group"
        aria-label="Filtrar parcelas con campos vacíos"
        className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3 sm:flex-row sm:flex-wrap sm:items-center"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Solo campos vacíos
        </span>
        <div className="flex flex-wrap items-center gap-3">
          {([
            { field: "client" as const, label: "Cliente", param: "missing_client" },
            { field: "farm" as const, label: "Hacienda", param: "missing_farm" },
            { field: "municipality" as const, label: "Municipio", param: "missing_municipality" },
            { field: "variety" as const, label: "Variedad", param: "missing_variety" }
          ]).map(({ field, label, param }) => (
            <label
              key={field}
              className="flex cursor-pointer items-center gap-1.5 text-xs"
            >
              <input
                type="checkbox"
                checked={missing[field]}
                onChange={() => toggleMissing(field)}
                aria-label={`Filtrar solo parcelas con ${label.toLowerCase()} vacío`}
                className="size-3.5 cursor-pointer accent-primary"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {(missing.client || missing.farm || missing.municipality || missing.variety) && (
          <button
            type="button"
            onClick={clearMissingFilters}
            className="ml-auto text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edición inline de metadata V0</CardTitle>
          <CardDescription>
            Toca un input y Guardar. El check verde confirma persistencia. La BD no
            recibe el cambio hasta que apretas Guardar — sin auto-save. Si el campo
            está vacío, el operador fumigador no lo llenó todavía.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="border-y border-border bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold">Parcela</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Cliente</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Hacienda</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Municipio</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Variedad</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const draft = drafts[p.id] ?? emptyDraft();
                  const status = statuses[p.id] ?? "idle";
                  const error = errors[p.id];
                  const dirty = isDirty(p, draft);
                  return (
                    <tr
                      key={p.id}
                      className={cn(
                        "border-b border-border/60 last:border-0 transition-colors",
                        status === "error" && "bg-destructive/5"
                      )}
                    >
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/parcelas/${p.id}`}
                          className="font-semibold text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
                          aria-label={`Ver detalle de ${p.land_name ?? "Parcela " + p.id}`}
                        >
                          {p.land_name ?? `Parcela #${p.id}`}
                        </Link>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {`#${p.id} · ${fmtDec(p.declared_area_ha ?? 0)} ha · ${p.field_type ?? "?"}`}
                        </p>
                      </td>
                      {(["client_name", "farm_name", "municipality", "variety"] as Array<keyof Draft>).map(
                        (k) => (
                          <td key={k} className="px-3 py-1.5">
                            <Input
                              value={draft[k]}
                              onChange={(e) => updateDraft(p.id, k, e.target.value)}
                              placeholder="(vacío)"
                              disabled={status === "saving"}
                              className="h-8 max-w-[180px] text-sm"
                              aria-label={`${p.land_name ?? "Parcela " + p.id} ${k}`}
                            />
                          </td>
                        )
                      )}
                      <td className="px-3 py-1.5">
                        <div className="flex items-center justify-end gap-1.5">
                          {status === "saved" && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-chart-1">
                              <Check className="size-3" aria-hidden /> Guardado
                            </span>
                          )}
                          {status === "saving" && (
                            <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Guardando" />
                          )}
                          {status === "error" && (
                            <span
                              className="font-mono text-[10px] text-destructive"
                              title={error}
                            >
                              {error?.substring(0, 32)}
                            </span>
                          )}
                          {dirty && status !== "saving" && (
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              onClick={() => revert(p)}
                              aria-label="Revertir cambios"
                              title="Revertir"
                            >
                              <RotateCcw className="size-3" aria-hidden />
                            </Button>
                          )}
                          <Button
                            size="icon-xs"
                            variant={dirty ? "default" : "outline"}
                            disabled={!dirty || status === "saving"}
                            onClick={() => save(p)}
                            aria-label="Guardar cambios"
                            title="Guardar"
                          >
                            <Save className="size-3" aria-hidden />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                      {query
                        ? `Ninguna parcela coincide con "${query}".`
                        : "No hay parcelas en esta página."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => go(page - 1)}
            disabled={page <= 1 || isPending}
          >
            ← Anterior
          </Button>
          <p className="font-mono text-xs text-muted-foreground">
            {`Página ${page} de ${totalPages} · ${isPending ? "cargando..." : "OK"}`}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => go(page + 1)}
            disabled={page >= totalPages || isPending}
          >
            Siguiente →
          </Button>
        </div>
      )}
    </section>
  );
}

function emptyDraft(): Draft {
  return { client_name: "", farm_name: "", municipality: "", variety: "" };
}

function buildDrafts(records: DjiParcelRecord[]): Record<number, Draft> {
  const out: Record<number, Draft> = {};
  for (const r of records) {
    out[r.id] = {
      client_name: r.client_name ?? "",
      farm_name: r.farm_name ?? "",
      municipality: r.municipality ?? "",
      variety: r.variety ?? ""
    };
  }
  return out;
}
