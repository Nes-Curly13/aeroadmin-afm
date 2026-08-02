"use client";

/**
 * RegisterFumigationForm — form para que el operador fumigador
 * registre una fumigación MANUAL (no escrapeda de DJI).
 *
 * Sprint 2026-08-02 — feature/manual-fumigation-ui. Cierra el
 * gap #1 del QA review: antes de este form, el operador no
 * podía registrar una fumigación que DJI no había reportado
 * (e.g. aplicación manual, fuera del rango de fechas, re-tratamiento)
 * sin correr INSERT INTO dji_fumigations … desde SQL.
 *
 * Campos:
 *   - fumigation_date (required, default = hoy en local)
 *   - product_used (required, texto libre, ej "Glifosato 48%")
 *   - dose_l_per_ha (required, número positivo)
 *   - area_fumigated_m2 (opcional)
 *   - duration_minutes (opcional)
 *   - drone_code_used (opcional, dropdown de DRONE_MODELS)
 *   - notes (opcional, textarea)
 *   - product_registered_ica (opcional, ICA compliance)
 *   - pilot_license (opcional, Aerocivil compliance)
 *
 * Después de registrar OK:
 *   - Muestra banner verde "Fumigación registrada" con el ID
 *   - Llama router.refresh() para que el server component
 *     (fumigations + timeline + summary) re-fetcheen y muestren
 *     el nuevo evento
 *   - NO limpia el form (el operador suele querer ver el ID
 *     confirmado antes de seguir)
 *
 * Si falla:
 *   - Banner rojo con el error del server (validación o BD)
 *   - El form mantiene los valores para que el operador corrija
 *
 * Auth: usa la sesión actual (cookie de NextAuth). El route
 * handler valida que sea admin o supervisor. El cliente NO
 * envía `recorded_by` (lo inyecta el server desde session).
 *
 * Por qué "use client":
 *   - Necesita useState (form state) + useTransition (no
 *     bloquear la UI durante POST) + useRouter (refresh).
 *   - El form es chico, no amerita server actions.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldSelect } from "@/components/ui/field-select";
import { DRONE_MODELS } from "@/lib/data-constants";
import { Loader2, Plus, X } from "lucide-react";

interface RegisterFumigationFormProps {
  parcelId: number;
}

interface FormState {
  fumigation_date: string;
  product_used: string;
  dose_l_per_ha: string;
  area_fumigated_m2: string;
  duration_minutes: string;
  drone_code_used: string;
  notes: string;
  product_registered_ica: string;
  pilot_license: string;
}

function todayISO(): string {
  // YYYY-MM-DD en local time. El server recibe esto como DATE.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyForm(): FormState {
  return {
    fumigation_date: todayISO(),
    product_used: "",
    dose_l_per_ha: "",
    area_fumigated_m2: "",
    duration_minutes: "",
    drone_code_used: "0",
    notes: "",
    product_registered_ica: "",
    pilot_license: ""
  };
}

export function RegisterFumigationForm({ parcelId }: RegisterFumigationFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // `isPending` lo manejamos con useState local (no con useTransition
  // — ese es solo para transiciones no-bloqueantes de React, y
  // nuestro POST es un await explícito). `startTransition` se usa
  // solo para envolver el router.refresh() y no bloquear la UI.
  const [isPending, setIsPending] = useState(false);
  const [, startTransition] = useTransition();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function reset() {
    setForm(emptyForm());
    setError(null);
    setSuccess(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsPending(true);

    // Construir body con solo los campos provistos. Convertir
    // strings vacíos a null (server espera `string | null`).
    const body: Record<string, unknown> = {
      parcel_id: parcelId,
      fumigation_date: form.fumigation_date,
      product_used: form.product_used.trim(),
      dose_l_per_ha: Number(form.dose_l_per_ha)
    };
    if (form.area_fumigated_m2.trim() !== "") {
      body.area_fumigated_m2 = Number(form.area_fumigated_m2);
    }
    if (form.duration_minutes.trim() !== "") {
      body.duration_minutes = Number(form.duration_minutes);
    }
    if (form.drone_code_used !== "0") {
      body.drone_code_used = Number(form.drone_code_used);
    }
    if (form.notes.trim() !== "") {
      body.notes = form.notes.trim();
    }
    if (form.product_registered_ica.trim() !== "") {
      body.product_registered_ica = form.product_registered_ica.trim();
    }
    if (form.pilot_license.trim() !== "") {
      body.pilot_license = form.pilot_license.trim();
    }

    try {
      const res = await fetch("/api/admin/fumigations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { fumigation?: { id: number } };
      setSuccess(
        data.fumigation
          ? `Fumigación #${data.fumigation.id} registrada. El timeline se actualizará al recargar.`
          : "Fumigación registrada."
      );
      // Refetch de la parcel detail (server component) para que el
      // timeline + intervalo + próxima-cadencia reflejen el nuevo
      // evento. Usamos startTransition para no bloquear la UI.
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "error de red");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3"
      aria-label="Registrar fumigación manual"
    >
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive"
        >
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-medium text-primary"
        >
          {success}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Fecha *
          </span>
          <Input
            type="date"
            value={form.fumigation_date}
            onChange={(e) => update("fumigation_date", e.target.value)}
            required
            disabled={isPending}
            aria-required="true"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Dron usado
          </span>
          <FieldSelect
            label="Dron usado"
            value={form.drone_code_used}
            onChange={(e) => update("drone_code_used", e.target.value)}
            disabled={isPending}
          >
            {DRONE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === 0 ? "Sin asignar" : `${m.name} (${m.tank_l} L)`}
              </option>
            ))}
          </FieldSelect>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Producto comercial *
        </span>
        <Input
          type="text"
          value={form.product_used}
          onChange={(e) => update("product_used", e.target.value)}
          placeholder="ej. Glifosato 48%, Imidacloprid 35% SC"
          required
          maxLength={200}
          disabled={isPending}
          aria-required="true"
          aria-label="Producto comercial usado"
        />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Dosis (L/ha) *
          </span>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            max="1000"
            value={form.dose_l_per_ha}
            onChange={(e) => update("dose_l_per_ha", e.target.value)}
            placeholder="ej. 2.5"
            required
            disabled={isPending}
            aria-required="true"
            aria-label="Dosis en litros por hectárea"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Área fumigada (m²)
          </span>
          <Input
            type="number"
            step="1"
            min="0"
            value={form.area_fumigated_m2}
            onChange={(e) => update("area_fumigated_m2", e.target.value)}
            placeholder="opcional"
            disabled={isPending}
            aria-label="Área fumigada en metros cuadrados"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Duración (min)
        </span>
        <Input
          type="number"
          step="1"
          min="0"
          value={form.duration_minutes}
          onChange={(e) => update("duration_minutes", e.target.value)}
          placeholder="opcional"
          disabled={isPending}
          aria-label="Duración de la fumigación en minutos"
        />
      </label>

      <details className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
        <summary className="cursor-pointer font-semibold text-muted-foreground">
          Compliance (opcional pero recomendado para auditoría)
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Registro ICA del producto
            </span>
            <Input
              type="text"
              value={form.product_registered_ica}
              onChange={(e) => update("product_registered_ica", e.target.value)}
              placeholder="ej. ICA-1234-PN"
              maxLength={50}
              disabled={isPending}
              pattern="[A-Za-z0-9-]+"
              aria-label="Número de registro ICA del producto"
            />
            <span className="text-[10px] text-muted-foreground">
              Formato: letras, números y guiones. 3-50 caracteres.
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Licencia del piloto (Aerocivil)
            </span>
            <Input
              type="text"
              value={form.pilot_license}
              onChange={(e) => update("pilot_license", e.target.value)}
              placeholder="ej. PCA-12345"
              maxLength={20}
              disabled={isPending}
              pattern="[A-Za-z0-9-]+"
              aria-label="Número de licencia del piloto"
            />
            <span className="text-[10px] text-muted-foreground">
              Formato: letras, números y guiones. 4-20 caracteres.
            </span>
          </label>
        </div>
      </details>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Notas operativas
        </span>
        <textarea
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          rows={2}
          maxLength={2000}
          disabled={isPending}
          placeholder="ej. Aplicación manual por re-tratamiento. Sin dron en el rango de fechas DJI."
          className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
          aria-label="Notas operativas de la fumigación"
        />
      </label>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={isPending}
        >
          <X className="size-3.5" aria-hidden />
          Limpiar
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={isPending}
        >
          {isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Guardando…
            </>
          ) : (
            <>
              <Plus className="size-3.5" aria-hidden />
              Registrar fumigación
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
