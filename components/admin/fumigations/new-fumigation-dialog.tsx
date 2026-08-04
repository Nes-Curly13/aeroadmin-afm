"use client";

/**
 * NewFumigationDialog — wizard para registrar una fumigación manual
 * desde /fumigaciones, eligiendo o dibujando la parcela en el mismo flow.
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding. Antes el operador
 * tenia que: (1) ir a /parcelas, (2) abrir la parcela, (3) usar el
 * form del detail. Con este wizard todo se hace en un solo lugar.
 *
 * Estructura (2 steps):
 *   Step 1 — Seleccionar parcela:
 *     - Tab "Existente": combobox con búsqueda live (fetch a
 *       /api/admin/parcels/search). El operador escribe y ve
 *       sugerencias de land_name, municipality, etc.
 *     - Tab "Nueva": form mínimo (land_name + field_type) + ParcelDrawer
 *       para dibujar el polígono. La parcela se crea al submit.
 *   Step 2 — Datos de la fumigación:
 *     - Form reusado (RegisterFumigationForm) con parcelId ya setado
 *       al id de la parcela elegida o al id de la parcela recién creada.
 *
 * Auth: este dialog es client component; el auth lo verifica el
 * /api/admin/fumigations y /api/admin/parcels (admin o supervisor).
 *
 * Patrón de dialog: usa @base-ui/react Dialog (no Radix Dialog). El
 * Trigger es un Button con `render={...}` que abre el dialog.
 */

import "maplibre-gl/dist/maplibre-gl.css";
import { Dialog } from "@base-ui/react/dialog";
import {
  Earth,
  Loader2,
  Plus,
  Search,
  Sprout
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RegisterFumigationForm } from "@/components/parcels/register-fumigation-form";
import { ParcelDrawer } from "@/components/admin/parcels/parcel-drawer";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Parcel = {
  id: number;
  land_name: string | null;
  external_id: string;
  source: string;
  client_name: string | null;
  farm_name: string | null;
  municipality: string | null;
};

type PolygonGeom = { type: "Polygon"; coordinates: number[][][] };

interface NewFumigationDialogProps {
  /**
   * Si se pasa `defaultParcelId`, el wizard arranca en step 2 con
   * esa parcela ya elegida (modo "uso rapido" desde la tabla de
   * fumigaciones). Si NO se pasa, arranca en step 1.
   */
  defaultParcelId?: number;
}

export function NewFumigationDialog({ defaultParcelId }: NewFumigationDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Step 1: source de la parcela
  const [parcelSource, setParcelSource] = useState<"existing" | "new">("existing");
  // Parcela elegida (existente) — su id viaja al form en step 2
  const [chosenParcel, setChosenParcel] = useState<Parcel | null>(null);
  // Parcela recién creada (nueva) — su id viaja al form en step 2
  const [newParcelId, setNewParcelId] = useState<number | null>(null);
  // Si el operador eligio parcela existente, defaultParcelId lo pre-setea
  useEffect(() => {
    if (defaultParcelId && !chosenParcel) {
      setChosenParcel({ id: defaultParcelId, land_name: null, external_id: "", source: "dji", client_name: null, farm_name: null, municipality: null });
    }
  }, [defaultParcelId, chosenParcel]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={
          <Button
            type="button"
            size="sm"
            aria-label="Registrar nueva fumigación"
          >
            <Plus className="size-3.5" aria-hidden />
            Nueva fumigación
          </Button>
        }
      />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center p-4">
          <Dialog.Popup className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-6 text-card-foreground shadow-2xl">
            <Dialog.Title className="flex items-center gap-2 text-lg font-bold">
              <Plus className="size-5 text-primary" aria-hidden />
              Registrar fumigación
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              Elegí o dibujá la parcela a la que se le hizo la fumigación.
            </Dialog.Description>
            <div className="mt-6">
              {chosenParcel || newParcelId ? (
                <FumigationFormStep
                  parcelId={chosenParcel?.id ?? newParcelId!}
                  onBack={() => {
                    setChosenParcel(null);
                    setNewParcelId(null);
                  }}
                  onSuccess={() => {
                    setOpen(false);
                    setChosenParcel(null);
                    setNewParcelId(null);
                    router.refresh();
                  }}
                />
              ) : (
                <ParcelSelectionStep
                  source={parcelSource}
                  onSourceChange={setParcelSource}
                  onChooseExisting={setChosenParcel}
                  onCreatedNew={setNewParcelId}
                />
              )}
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ============================================================
// Step 1: Seleccionar parcela
// ============================================================

function ParcelSelectionStep({
  source,
  onSourceChange,
  onChooseExisting,
  onCreatedNew
}: {
  source: "existing" | "new";
  onSourceChange: (s: "existing" | "new") => void;
  onChooseExisting: (p: Parcel) => void;
  onCreatedNew: (id: number) => void;
}) {
  return (
    <div>
      {/* Tabs: Existente | Nueva */}
      <div
        role="tablist"
        aria-label="Origen de la parcela"
        className="mb-4 inline-flex rounded-md border border-border bg-muted/40 p-1 text-xs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={source === "existing"}
          onClick={() => onSourceChange("existing")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 font-medium transition-colors",
            source === "existing"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Search className="size-3.5" aria-hidden />
          Parcela existente
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={source === "new"}
          onClick={() => onSourceChange("new")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 font-medium transition-colors",
            source === "new"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Earth className="size-3.5" aria-hidden />
          Dibujar nueva
        </button>
      </div>

      {source === "existing" ? (
        <ParcelCombobox onChoose={onChooseExisting} />
      ) : (
        <NewParcelForm onCreated={onCreatedNew} />
      )}
    </div>
  );
}

// ----- Subcomponente: ParcelCombobox -----

function ParcelCombobox({ onChoose }: { onChoose: (p: Parcel) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Parcel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced search. Carga el dropdown después de 250ms de inactividad.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 1) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const res = await fetch(
          `/api/admin/parcels/search?q=${encodeURIComponent(query)}&limit=10`
        );
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data = (await res.json()) as { parcels: Parcel[] };
        setResults(data.parcels);
        setIsOpen(true);
      } finally {
        setIsLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Cerrar dropdown cuando se hace click fuera.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Buscar por nombre, ID, cliente, hacienda, municipio…"
          className="pl-8"
          aria-label="Buscar parcela existente"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls="parcel-suggestions"
        />
        {isLoading ? (
          <Loader2
            className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : null}
      </div>
      {isOpen && query.length > 0 ? (
        <ul
          id="parcel-suggestions"
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-card p-1 shadow-lg"
        >
          {results.length === 0 && !isLoading ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              Sin resultados para &quot;{query}&quot;.
            </li>
          ) : (
            results.map((p) => (
              <li key={p.id} role="option" aria-selected="false">
                <button
                  type="button"
                  onClick={() => {
                    onChoose(p);
                    setIsOpen(false);
                  }}
                  className="flex w-full flex-col items-start gap-0.5 rounded-sm px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                >
                  <div className="flex w-full items-center gap-2">
                    <span className="font-semibold">
                      {p.land_name ?? `Parcela #${p.id}`}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      #{p.id}
                    </span>
                    {p.source === "manual" ? (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                        manual
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {[p.client_name, p.farm_name, p.municipality]
                      .filter(Boolean)
                      .join(" · ") || p.external_id}
                  </p>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

// ----- Subcomponente: NewParcelForm (dibujar + crear) -----

function NewParcelForm({ onCreated }: { onCreated: (id: number) => void }) {
  const [landName, setLandName] = useState("");
  const [fieldType, setFieldType] = useState("Farmland");
  const [geometry, setGeometry] = useState<PolygonGeom | null>(null);
  const [error, setError] = useState<string | null>(null);
  // useState local para isPending (mismo patron que en new-parcel-form,
  // NO usar useTransition con async — bug conocido del form anterior).
  const [isPending, setIsPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!landName.trim()) {
      setError("Nombre del lote es obligatorio");
      return;
    }
    if (!geometry) {
      setError("Dibujá el polígono de la parcela en el mapa");
      return;
    }
    setIsPending(true);
    try {
      const res = await fetch("/api/admin/parcels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          land_name: landName.trim(),
          field_type: fieldType,
          geometry
        })
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { parcel: { id: number } };
      onCreated(data.parcel.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "error de red");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive"
        >
          {error}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Nombre del lote *
          </span>
          <Input
            value={landName}
            onChange={(e) => setLandName(e.target.value)}
            placeholder="ej. Lote 12 — Suerte 3"
            required
            maxLength={200}
            disabled={isPending}
            aria-required="true"
            aria-label="Nombre del lote"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Tipo *
          </span>
          <FieldSelect
            label="Tipo"
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value)}
            disabled={isPending}
          >
            <option value="Farmland">Tierra de cultivo</option>
            <option value="Orchards">Huerto / plantación</option>
          </FieldSelect>
        </label>
      </div>
      {/* El ParcelDrawer ya tiene su propio hint "Hacé click en los vértices…"
          y su botón "Limpiar". Evitamos duplicar la UI acá. */}
      <div className="rounded-md border border-border bg-muted/30 p-2">
        <ParcelDrawer onPolygonChange={setGeometry} />
        {geometry ? (
          <p className="mt-1 text-[10px] text-muted-foreground">
            Polígono listo ({geometry.coordinates[0].length - 1} vértices).
          </p>
        ) : null}
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Creando…
            </>
          ) : (
            <>
              <Plus className="size-3.5" aria-hidden />
              Crear y usar esta parcela
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

// ============================================================
// Step 2: Form de fumigación (reuso de RegisterFumigationForm)
// ============================================================

function FumigationFormStep({
  parcelId,
  onBack,
  onSuccess
}: {
  parcelId: number;
  onBack: () => void;
  onSuccess: () => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        <Sprout className="size-4 text-primary" aria-hidden />
        <span className="font-semibold">Parcela #{parcelId}</span>
        <button
          type="button"
          onClick={onBack}
          className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          ← Cambiar parcela
        </button>
      </div>
      {/* Reuso del form existente. El form ya hace router.refresh()
          en su onSuccess interno, asi que pasamos onSuccess solo
          para cerrar el dialog. */}
      <RegisterFumigationFormWrapper parcelId={parcelId} onSuccess={onSuccess} />
    </div>
  );
}

// Wrapper porque RegisterFumigationForm solo hace router.refresh()
// y no tiene callback onSuccess. Hacemos un wrapper que simula el
// submit exitoso observando el banner verde de "Fumigación #N
// registrada" en el DOM.
function RegisterFumigationFormWrapper({
  parcelId,
  onSuccess
}: {
  parcelId: number;
  onSuccess: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Observamos el banner de success (role="status" con texto
  // "Fumigación #N registrada"). Cuando aparece, cerramos el dialog.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new MutationObserver(() => {
      const banner = el.querySelector('[role="status"]');
      if (banner && /Fumigaci[oó]n #\d+ registrada/.test(banner.textContent ?? "")) {
        // Pequeño delay para que el usuario vea el banner antes de
        // cerrar el dialog.
        setTimeout(onSuccess, 600);
      }
    });
    obs.observe(el, { childList: true, subtree: true, characterData: true });
    return () => obs.disconnect();
  }, [onSuccess]);
  return (
    <div ref={containerRef}>
      <RegisterFumigationForm parcelId={parcelId} />
    </div>
  );
}
