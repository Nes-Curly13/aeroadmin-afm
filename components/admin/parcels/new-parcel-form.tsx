"use client";

/**
 * NewParcelForm — form completo para alta manual de una parcela.
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding (sub-sprint 1).
 *
 * Layout: 2 columnas en desktop, 1 columna en mobile.
 *   - Izquierda: form alfanumérico (land_name, field_type, suerte, etc.)
 *   - Derecha: mapa con ParcelDrawer para dibujar el polígono
 *
 * Estado:
 *   - `form` — los 11 campos alfanuméricos
 *   - `geometry` — el polígono GeoJSON (null hasta que el operador dibuja)
 *   - `error` / `success` — banners
 *   - `isPending` — durante el POST
 *
 * Al success (201), redirige a /admin/parcels/{id} para ver el detalle
 * de la parcela recién creada.
 *
 * Auth: usa la sesión actual (NextAuth). El route handler valida que
 * sea admin. El cliente NO envía nada de auth — la cookie va sola.
 *
 * Por qué "use client":
 *   - Necesita useState (form + geometry), useTransition (no bloquear
 *     la UI durante el POST), useRouter (redirect).
 *   - El ParcelDrawer también es client (MapLibre + terra-draw son
 *     client-only).
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldSelect } from "@/components/ui/field-select";
import { ParcelDrawer } from "./parcel-drawer";
import { Loader2, Save } from "lucide-react";

interface FormState {
  land_name: string;
  field_type: string;
  luck_name: string;
  client_name: string;
  farm_name: string;
  municipality: string;
  variety: string;
  crop_type: string;
  planting_date: string;
  owner_name: string;
  owner_contact: string;
  supervisor_notes: string;
  /**
   * Si está marcado, después de crear la parcela redirigimos al
   * detalle con foco en el form de fumigación (sprint 2026-08-04,
   * sub-sprint 3 — wizard integrado de alta + fumigación inicial).
   */
  fumigar_ahora: boolean;
}

function emptyForm(): FormState {
  return {
    land_name: "",
    field_type: "Farmland",
    luck_name: "",
    client_name: "",
    farm_name: "",
    municipality: "",
    variety: "",
    crop_type: "",
    planting_date: "",
    owner_name: "",
    owner_contact: "",
    supervisor_notes: "",
    fumigar_ahora: false
  };
}

const FIELD_TYPE_OPTIONS = [
  { value: "Farmland", label: "Tierra de cultivo" },
  { value: "Orchards", label: "Huerto / plantación" }
];

export function NewParcelForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [geometry, setGeometry] = useState<{
    type: "Polygon";
    coordinates: number[][][];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // useState local para isPending (no useTransition — el await fetch
  // adentro de startTransition era el bug que rompía el form de
  // fumigación manual en S8). Ver docs del fix.
  const [isPending, setIsPending] = useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!geometry) {
      setError("Tenés que dibujar el polígono de la parcela en el mapa");
      return;
    }

    // Trim de strings vacíos → null (server espera `string | null`).
    const body: Record<string, unknown> = {
      land_name: form.land_name.trim(),
      field_type: form.field_type,
      geometry
    };
    for (const key of [
      "luck_name",
      "client_name",
      "farm_name",
      "municipality",
      "variety",
      "crop_type",
      "planting_date",
      "owner_name",
      "owner_contact",
      "supervisor_notes"
    ] as const) {
      const v = form[key].trim();
      if (v) body[key] = v;
    }

    setIsPending(true);
    try {
      const res = await fetch("/api/admin/parcels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { parcel: { id: number } };
      // Redirigir al detalle de la parcela recién creada.
      // Si el operador marcó "Fumigar inmediatamente", agregamos el
      // query param `?action=fumigar` para que el detail page haga
      // scroll al form de fumigación y lo enfoque. Esto cierra el
      // sub-sprint 3 del wizard integrado (alta + fumigación inicial).
      const dest = form.fumigar_ahora
        ? `/parcelas/${data.parcel.id}?action=fumigar`
        : `/parcelas/${data.parcel.id}`;
      router.push(dest);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "error de red");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-6 lg:grid-cols-2"
      aria-label="Alta manual de parcela"
    >
      {/* Columna izquierda: form alfanumérico */}
      <div className="flex flex-col gap-3">
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive"
          >
            {error}
          </p>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Nombre del lote *
          </span>
          <Input
            type="text"
            value={form.land_name}
            onChange={(e) => update("land_name", e.target.value)}
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
            value={form.field_type}
            onChange={(e) => update("field_type", e.target.value)}
            disabled={isPending}
          >
            {FIELD_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </FieldSelect>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Suerte
            </span>
            <Input
              type="text"
              value={form.luck_name}
              onChange={(e) => update("luck_name", e.target.value)}
              placeholder="ej. Suerte 3"
              maxLength={100}
              disabled={isPending}
              aria-label="Suerte (división interna de la hacienda)"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Variedad
            </span>
            <Input
              type="text"
              value={form.variety}
              onChange={(e) => update("variety", e.target.value)}
              placeholder="ej. CC 85-92"
              maxLength={100}
              disabled={isPending}
              aria-label="Variedad de caña"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Cliente / Ingenio
            </span>
            <Input
              type="text"
              value={form.client_name}
              onChange={(e) => update("client_name", e.target.value)}
              placeholder="ej. Ingenio La Cabaña"
              maxLength={200}
              disabled={isPending}
              aria-label="Cliente o ingenio"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Hacienda
            </span>
            <Input
              type="text"
              value={form.farm_name}
              onChange={(e) => update("farm_name", e.target.value)}
              placeholder="ej. Hacienda El Edén"
              maxLength={200}
              disabled={isPending}
              aria-label="Nombre de la hacienda"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Municipio
            </span>
            <Input
              type="text"
              value={form.municipality}
              onChange={(e) => update("municipality", e.target.value)}
              placeholder="ej. Palmira"
              maxLength={100}
              disabled={isPending}
              aria-label="Municipio"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Cultivo
            </span>
            <Input
              type="text"
              value={form.crop_type}
              onChange={(e) => update("crop_type", e.target.value)}
              placeholder="ej. Caña de azúcar"
              maxLength={100}
              disabled={isPending}
              aria-label="Tipo de cultivo"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Fecha de siembra
            </span>
            <Input
              type="date"
              value={form.planting_date}
              onChange={(e) => update("planting_date", e.target.value)}
              disabled={isPending}
              aria-label="Fecha de siembra"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Propietario
            </span>
            <Input
              type="text"
              value={form.owner_name}
              onChange={(e) => update("owner_name", e.target.value)}
              placeholder="ej. Juan Pérez"
              maxLength={200}
              disabled={isPending}
              aria-label="Nombre del propietario"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Contacto del propietario
          </span>
          <Input
            type="text"
            value={form.owner_contact}
            onChange={(e) => update("owner_contact", e.target.value)}
            placeholder="ej. +57 300 123 4567"
            maxLength={200}
            disabled={isPending}
            aria-label="Contacto del propietario"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Notas del supervisor
          </span>
          <textarea
            value={form.supervisor_notes}
            onChange={(e) => update("supervisor_notes", e.target.value)}
            rows={3}
            maxLength={2000}
            disabled={isPending}
            placeholder="Contexto, restricciones, acuerdos especiales..."
            className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
            aria-label="Notas del supervisor"
          />
        </label>

        {/* Sub-sprint 3: checkbox "Fumigar inmediatamente". Si está
            marcado, después de crear la parcela redirigimos al detail
            con foco en el form de fumigación. El operador llena
            parcela + fumigación inicial en un solo flujo.

            NOTA: usamos un <div> como wrapper (no <label>) para evitar
            un bug de React 19 con <label><input type=checkbox/></label>
            en el que el click resetea el state del form completo. */}
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          <input
            id="fumigar-ahora"
            type="checkbox"
            checked={form.fumigar_ahora}
            onChange={(e) => {
              const checked = e.target.checked;
              setForm((prev) => ({ ...prev, fumigar_ahora: checked }));
            }}
            disabled={isPending}
            className="size-4 accent-primary"
            aria-describedby="fumigar-ahora-help"
          />
          <label htmlFor="fumigar-ahora" className="flex-1 cursor-pointer">
            <span className="font-medium">Fumigar inmediatamente después</span>
            <span id="fumigar-ahora-help" className="ml-2 text-xs text-muted-foreground">
              Después de crear la parcela, te llevo al form de fumigación con la parcela ya elegida.
            </span>
          </label>
        </div>

        <div className="flex justify-end pt-2">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Guardando…
              </>
            ) : (
              <>
                <Save className="size-3.5" aria-hidden />
                Crear parcela
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Columna derecha: mapa con drawing tool */}
      <div className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
        <h3 className="text-sm font-semibold">Geometría de la parcela</h3>
        <p className="text-xs text-muted-foreground">
          Dibujá el polígono del lote. La geometría se puede re-dibujar después
          desde el detalle de la parcela.
        </p>
        <ParcelDrawer onPolygonChange={setGeometry} />
      </div>
    </form>
  );
}
