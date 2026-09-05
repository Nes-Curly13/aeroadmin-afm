"use client";

/**
 * AdminParcelsClient — UI de edición inline de metadata V0 + Cliente/Finca FK.
 *
 * Sprint S11+ / PLAN-FUMIGACIONES-V2 / Fase 3.B (2026-09-05):
 *   - Agrega dropdowns de Cliente (FK → clients) y Finca (FK → farms) por
 *     parcela. Cuando el operator elige un FK, el repo auto-deriva el
 *     name denormalizado (`client_name` / `farm_name`) desde la tabla
 *     referenciada — el text input sigue siendo la "vista" del name.
 *   - Banner de "X parcelas sin asignar" arriba (filtro rapido para que
 *     el operator pueda enfocar la operatoria de backfill).
 *   - Loading state: spinner mientras cargan las listas de clients/farms.
 *   - Cache local de las listas (no re-fetch en cada keystroke).
 *
 * Patrón (heredado de S8.2):
 *   - Por cada parcela, drafts locales; "Guardar" deshabilitado hasta
 *     que algo cambie.
 *   - Optimistic update: PATCH al server. Si falla, rollback + toast
 *     error. Si OK, debounce + `router.refresh()` para que otras rows
 *     que dependan del valor (e.g. dropdowns) se actualicen.
 *
 * El client NO toca Supabase directo — va por el API route
 * `/api/admin/parcels/[id]/metadata` que valida + actualiza + invalida
 * caches. Mantiene el principio de "api/ es la unica capa de data access"
 * del AGENTS.md.
 */

import {
  Check,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Search,
  Upload,
  AlertTriangle,
  ChevronDown
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fmtDec } from "@/lib/format";
import type { DjiParcelRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Client {
  id: number;
  name: string;
}

interface Farm {
  id: number;
  client_id: number;
  name: string;
}

interface AdminParcelsClientProps {
  initialData: DjiParcelRecord[];
  total: number;
  page: number;
  totalPages: number;
  pageSize: number;
  initialQuery: string;
  missingFilter: {
    client: boolean;
    farm: boolean;
    municipality: boolean;
    variety: boolean;
  };
  // S11+ / Fase 3.B — pre-cargado del server (initial render sin spinner).
  initialClients: Client[];
  initialUnassignedCount: number;
}

interface Draft {
  client_name: string;
  farm_name: string;
  municipality: string;
  variety: string;
  client_id: number | null;
  farm_id: number | null;
  // S11+ / Fase 4.4 — data quality metadata.
  data_validity: "fresh" | "needs_review" | "stale" | "unknown";
  last_validated_at: string | null;
  validated_by_email: string | null;
}

type Status = "idle" | "saving" | "saved" | "error";

function emptyDraft(): Draft {
  return {
    client_name: "",
    farm_name: "",
    municipality: "",
    variety: "",
    client_id: null,
    farm_id: null,
    data_validity: "unknown",
    last_validated_at: null,
    validated_by_email: null
  };
}

function buildDrafts(parcels: DjiParcelRecord[]): Record<number, Draft> {
  const out: Record<number, Draft> = {};
  for (const p of parcels) {
    out[p.id] = {
      client_name: p.client_name ?? "",
      farm_name: p.farm_name ?? "",
      municipality: p.municipality ?? "",
      variety: p.variety ?? "",
      client_id: p.client_id ?? null,
      farm_id: p.farm_id ?? null,
      data_validity: p.data_validity ?? "unknown",
      last_validated_at: p.last_validated_at ?? null,
      validated_by_email: p.validated_by_email ?? null
    };
  }
  return out;
}

export function AdminParcelsClient({
  initialData,
  total,
  page,
  totalPages,
  pageSize,
  initialQuery,
  missingFilter,
  initialClients,
  initialUnassignedCount
}: AdminParcelsClientProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [missing, setMissing] = useState(missingFilter);
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() => buildDrafts(initialData));
  const [statuses, setStatuses] = useState<Record<number, Status>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // S11+ / Fase 3.B — listas de lookup. Las pre-cargamos del server para
  // evitar spinner en el initial render. Se re-fetchean despues de cada
  // save exitoso (porque el server pudo haber creado/validado un nuevo
  // cliente).
  const [clients, setClients] = useState<Client[]>(initialClients);
  const [farms, setFarms] = useState<Farm[]>([]);
  const [unassignedCount, setUnassignedCount] = useState(initialUnassignedCount);
  const [lookupLoading, setLookupLoading] = useState(false);

  // Re-hidratar drafts cuando el server fetcha datos nuevos (router.refresh).
  useEffect(() => {
    setDrafts((prev) => {
      const next = buildDrafts(initialData);
      for (const p of initialData) {
        const d = prev[p.id];
        if (!d) continue;
        const server = next[p.id];
        const userChanged = Object.keys(server).some(
          (k) => d[k as keyof Draft] !== server[k as keyof Draft]
        );
        if (userChanged) next[p.id] = d;
      }
      return next;
    });
  }, [initialData]);

  // Carga inicial de farms (la lista de clients viene pre-cargada del
  // server). Las farms necesitan clientId filter — cargamos TODAS las
  // farms top-N y filtramos en cliente. Para >50 farms del mismo client
  // hay que usar el search, pero el caso comun es 1-5 farms por client.
  useEffect(() => {
    let cancelled = false;
    async function loadFarms() {
      setLookupLoading(true);
      try {
        const res = await fetch("/api/admin/farms?limit=200", { cache: "no-store" });
        if (!res.ok) throw new Error(`farms ${res.status}`);
        const data = (await res.json()) as { farms: Farm[] };
        if (!cancelled) setFarms(data.farms);
      } catch (e) {
        if (!cancelled) {
          console.error("loadFarms failed", e);
        }
      } finally {
        if (!cancelled) setLookupLoading(false);
      }
    }
    loadFarms();
    return () => {
      cancelled = true;
    };
  }, []);

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

  function updateDraft(id: number, key: keyof Draft, value: string | number | null) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? emptyDraft()), [key]: value }
    }));
    if (statuses[id] === "saved" || statuses[id] === "error") {
      setStatuses((prev) => ({ ...prev, [id]: "idle" }));
      setErrors((prev) => ({ ...prev, [id]: "" }));
    }
  }

  /**
   * Cuando el operator elige un Client del dropdown, auto-pobla el
   * `client_name` denormalizado con el name del client (el server
   * tambien lo haria via FK resolution, pero la UI lo refleja
   * inmediatamente para mejor UX). Si el client cambia y el farm_id
   * actual no pertenece al nuevo client, limpiamos farm_id/farm_name.
   */
  function setClient(parcelId: number, clientId: number | null) {
    setDrafts((prev) => {
      const cur = prev[parcelId] ?? emptyDraft();
      const client = clientId !== null ? clients.find((c) => c.id === clientId) : null;
      const next: Draft = {
        ...cur,
        client_id: clientId,
        client_name: client?.name ?? (clientId === null ? "" : cur.client_name)
      };
      // Si el farm actual no pertenece al nuevo client, clear.
      if (clientId !== null && cur.farm_id !== null) {
        const farm = farms.find((f) => f.id === cur.farm_id);
        if (!farm || farm.client_id !== clientId) {
          next.farm_id = null;
          next.farm_name = "";
        }
      } else if (clientId === null) {
        next.farm_id = null;
        next.farm_name = "";
      }
      return { ...prev, [parcelId]: next };
    });
    if (statuses[parcelId] === "saved" || statuses[parcelId] === "error") {
      setStatuses((prev) => ({ ...prev, [parcelId]: "idle" }));
      setErrors((prev) => ({ ...prev, [parcelId]: "" }));
    }
  }

  function setFarm(parcelId: number, farmId: number | null) {
    setDrafts((prev) => {
      const cur = prev[parcelId] ?? emptyDraft();
      const farm = farmId !== null ? farms.find((f) => f.id === farmId) : null;
      return {
        ...prev,
        [parcelId]: {
          ...cur,
          farm_id: farmId,
          farm_name: farm?.name ?? (farmId === null ? "" : cur.farm_name)
        }
      };
    });
    if (statuses[parcelId] === "saved" || statuses[parcelId] === "error") {
      setStatuses((prev) => ({ ...prev, [parcelId]: "idle" }));
      setErrors((prev) => ({ ...prev, [parcelId]: "" }));
    }
  }

  function isDirty(parcel: DjiParcelRecord, d: Draft): boolean {
    return (
      (parcel.client_name ?? "") !== d.client_name ||
      (parcel.farm_name ?? "") !== d.farm_name ||
      (parcel.municipality ?? "") !== d.municipality ||
      (parcel.variety ?? "") !== d.variety ||
      (parcel.client_id ?? null) !== d.client_id ||
      (parcel.farm_id ?? null) !== d.farm_id ||
      (parcel.data_validity ?? "unknown") !== d.data_validity
    );
  }

  async function save(parcel: DjiParcelRecord) {
    const draft = drafts[parcel.id];
    if (!draft) return;
    if (!isDirty(parcel, draft)) return;

    setStatuses((prev) => ({ ...prev, [parcel.id]: "saving" }));
    setErrors((prev) => ({ ...prev, [parcel.id]: "" }));

    const patch: Record<string, unknown> = {};
    if ((parcel.client_name ?? "") !== draft.client_name) patch.client_name = draft.client_name;
    if ((parcel.farm_name ?? "") !== draft.farm_name) patch.farm_name = draft.farm_name;
    if ((parcel.municipality ?? "") !== draft.municipality) patch.municipality = draft.municipality;
    if ((parcel.variety ?? "") !== draft.variety) patch.variety = draft.variety;
    // FKs: solo mandamos si difieren del server. Si client_id pasa de
    // null a un valor, el server auto-deriva client_name del FK.
    if ((parcel.client_id ?? null) !== draft.client_id) {
      patch.client_id = draft.client_id;
      // Si estamos seteando el client_id por primera vez y el name del
      // draft coincide con el del client, NO mandamos client_name —
      // dejamos que el server lo derive. Si difieren, mandamos ambos.
      if (draft.client_id !== null) {
        const client = clients.find((c) => c.id === draft.client_id);
        if (client && draft.client_name !== client.name) {
          patch.client_name = draft.client_name;
        }
      } else {
        // Limpiando: si el draft tiene client_name custom, mandalo
        if (draft.client_name) patch.client_name = draft.client_name;
      }
    }
    if ((parcel.farm_id ?? null) !== draft.farm_id) {
      patch.farm_id = draft.farm_id;
      if (draft.farm_id !== null) {
        const farm = farms.find((f) => f.id === draft.farm_id);
        if (farm && draft.farm_name !== farm.name) {
          patch.farm_name = draft.farm_name;
        }
      } else {
        if (draft.farm_name) patch.farm_name = draft.farm_name;
      }
    }
    if ((parcel.data_validity ?? "unknown") !== draft.data_validity) {
      patch.data_validity = draft.data_validity;
    }

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
      // Refresh silencioso. Debounce para no martillar el server.
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
    setDrafts((prev) => ({ ...prev, [parcel.id]: buildDrafts([parcel])[parcel.id] }));
    setStatuses((prev) => ({ ...prev, [parcel.id]: "idle" }));
    setErrors((prev) => ({ ...prev, [parcel.id]: "" }));
  }

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
  function toggleMissing(field: keyof typeof missing) {
    const next = { ...missing, [field]: !missing[field] };
    setMissing(next);
    const params = new URLSearchParams();
    params.set("page", "1");
    if (query) params.set("q", query);
    if (next.client) params.set("missing_client", "1");
    if (next.farm) params.set("missing_farm", "1");
    if (next.municipality) params.set("missing_municipality", "1");
    if (next.variety) params.set("missing_variety", "1");
    router.push(`/admin/parcels?${params.toString()}`);
  }
  function clearMissingFilters() {
    setMissing({ client: false, farm: false, municipality: false, variety: false });
    const params = new URLSearchParams();
    params.set("page", "1");
    if (query) params.set("q", query);
    router.push(`/admin/parcels?${params.toString()}`);
  }

  // Farms filtradas por el client_id actual de la row (cascada).
  function farmsForClient(clientId: number | null): Farm[] {
    if (clientId === null) return [];
    return farms.filter((f) => f.client_id === clientId);
  }

  return (
    <section className="flex flex-col gap-4">
      {/* S11+ / Fase 3.B — banner de parcelas sin asignar. Muestra
          el total de parcelas con `client_id IS NULL` y provee un
          link rapido a un filtro `missing_client=1`. El operator ve
          de un vistazo cuantas le faltan. */}
      {unassignedCount > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            <p className="text-sm">
              <strong>{unassignedCount}</strong>{" "}
              {unassignedCount === 1 ? "parcela sin" : "parcelas sin"} cliente asignado.
              {" "}
              <span className="text-muted-foreground">
                (Fase 3.B — backfill manual-assisted)
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const params = new URLSearchParams();
                params.set("page", "1");
                params.set("missing_client", "1");
                router.push(`/admin/parcels?${params.toString()}`);
              }}
              aria-label="Filtrar parcelas sin cliente asignado"
            >
              Ver sin asignar
            </Button>
          </div>
        </div>
      )}

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
            {`${filtered.length} de ${total} parcelas · página ${page}/${totalPages || 1} · ${pageSize}/página${lookupLoading ? " · cargando lookups…" : ""}`}
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
            { field: "client" as const, label: "Cliente" },
            { field: "farm" as const, label: "Hacienda" },
            { field: "municipality" as const, label: "Municipio" },
            { field: "variety" as const, label: "Variedad" }
          ]).map(({ field, label }) => (
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
          <CardTitle className="text-base">Edición inline de metadata V0 + Cliente/Finca</CardTitle>
          <CardDescription>
            Toca un input y Guardar. El check verde confirma persistencia. Los dropdowns de
            Cliente/Finca se persisten como FK (clients.id / farms.id) y el repo
            auto-deriva el name denormalizado desde la tabla referenciada.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1400px] text-sm">
              <thead className="border-y border-border bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold">Parcela</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Cliente (FK)</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Hacienda (FK)</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Cliente (denorm)</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Hacienda (denorm)</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Municipio</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Variedad</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Vigencia</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const draft = drafts[p.id] ?? emptyDraft();
                  const status = statuses[p.id] ?? "idle";
                  const error = errors[p.id];
                  const dirty = isDirty(p, draft);
                  const farmsForRow = farmsForClient(draft.client_id);
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
                      {/* Cliente FK — dropdown poblado con la lista global. */}
                      <td className="px-3 py-1.5">
                        <div className="relative">
                          <select
                            value={draft.client_id ?? ""}
                            onChange={(e) =>
                              setClient(
                                p.id,
                                e.target.value ? Number(e.target.value) : null
                              )
                            }
                            disabled={status === "saving"}
                            className="h-8 w-full max-w-[200px] appearance-none rounded-md border border-input bg-background pl-2 pr-7 text-sm"
                            aria-label={`Cliente (FK) de ${p.land_name ?? "Parcela " + p.id}`}
                          >
                            <option value="">(sin asignar)</option>
                            {clients.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                        </div>
                      </td>
                      {/* Finca FK — dropdown cascada: solo farms del client_id actual. */}
                      <td className="px-3 py-1.5">
                        <div className="relative">
                          <select
                            value={draft.farm_id ?? ""}
                            onChange={(e) =>
                              setFarm(
                                p.id,
                                e.target.value ? Number(e.target.value) : null
                              )
                            }
                            disabled={
                              status === "saving" ||
                              draft.client_id === null ||
                              farmsForRow.length === 0
                            }
                            className="h-8 w-full max-w-[200px] appearance-none rounded-md border border-input bg-background pl-2 pr-7 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label={`Finca (FK) de ${p.land_name ?? "Parcela " + p.id}`}
                          >
                            <option value="">
                              {draft.client_id === null
                                ? "(elegí cliente primero)"
                                : farmsForRow.length === 0
                                ? "(este cliente no tiene fincas)"
                                : "(sin asignar)"}
                            </option>
                            {farmsForRow.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                        </div>
                      </td>
                      {/* Cliente name — text input derivado. Si el FK esta
                          seteado y el name coincide, se ve read-only-ish. */}
                      <td className="px-3 py-1.5">
                        <Input
                          value={draft.client_name}
                          onChange={(e) => updateDraft(p.id, "client_name", e.target.value)}
                          placeholder="(auto desde FK)"
                          disabled={status === "saving"}
                          className="h-8 max-w-[180px] text-sm"
                          aria-label={`Cliente (denormalizado) de ${p.land_name ?? "Parcela " + p.id}`}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <Input
                          value={draft.farm_name}
                          onChange={(e) => updateDraft(p.id, "farm_name", e.target.value)}
                          placeholder="(auto desde FK)"
                          disabled={status === "saving"}
                          className="h-8 max-w-[180px] text-sm"
                          aria-label={`Finca (denormalizada) de ${p.land_name ?? "Parcela " + p.id}`}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <Input
                          value={draft.municipality}
                          onChange={(e) => updateDraft(p.id, "municipality", e.target.value)}
                          placeholder="(vacío)"
                          disabled={status === "saving"}
                          className="h-8 max-w-[180px] text-sm"
                          aria-label={`Municipio de ${p.land_name ?? "Parcela " + p.id}`}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <Input
                          value={draft.variety}
                          onChange={(e) => updateDraft(p.id, "variety", e.target.value)}
                          placeholder="(vacío)"
                          disabled={status === "saving"}
                          className="h-8 max-w-[180px] text-sm"
                          aria-label={`Variedad de ${p.land_name ?? "Parcela " + p.id}`}
                        />
                      </td>
                      {/* Vigencia — dropdown Capa de Gestión (Fase 4.4). */}
                      <td className="px-3 py-1.5">
                        <div className="relative">
                          <select
                            value={draft.data_validity}
                            onChange={(e) =>
                              updateDraft(
                                p.id,
                                "data_validity",
                                e.target.value as Draft["data_validity"]
                              )
                            }
                            disabled={status === "saving"}
                            className={cn(
                              "h-8 w-full max-w-[140px] appearance-none rounded-md border pl-2 pr-7 text-sm",
                              draft.data_validity === "fresh" && "border-emerald-500/40 bg-emerald-500/5",
                              draft.data_validity === "needs_review" && "border-amber-500/40 bg-amber-500/5",
                              draft.data_validity === "stale" && "border-red-500/40 bg-red-500/5",
                              draft.data_validity === "unknown" && "border-input bg-background"
                            )}
                            aria-label={`Vigencia de ${p.land_name ?? "Parcela " + p.id}`}
                          >
                            <option value="fresh">fresh</option>
                            <option value="needs_review">needs_review</option>
                            <option value="stale">stale</option>
                            <option value="unknown">unknown</option>
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                        </div>
                      </td>
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
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <p className="font-mono text-[10px] text-muted-foreground">
        {`Página ${page} de ${totalPages || 1}`}
        {totalPages > 1 ? " · " : ""}
        {page < totalPages && (
          <button
            type="button"
            onClick={() => go(page + 1)}
            className="underline-offset-2 hover:underline"
          >
            siguiente →
          </button>
        )}
        {isPending && <span className="ml-2 inline-flex items-center gap-1 text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden /> refrescando
        </span>}
      </p>
    </section>
  );
}
