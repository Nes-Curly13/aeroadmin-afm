"use client";

/**
 * RegisterFumigationForm — form para que el operador fumigador
 * registre O EDITE una fumigación.
 *
 * Sprint 2026-08-02 — feature/manual-fumigation-ui. Cierra el
 * gap #1 del QA review: antes de este form, el operador no
 * podía registrar una fumigación que DJI no había reportado
 * (e.g. aplicación manual, fuera del rango de fechas, re-tratamiento)
 * sin correr INSERT INTO dji_fumigations … desde SQL.
 *
 * Sprint 2026-08-13 — feature/fumigacion-detail-v2 / sub-3. Refactor
 * para soportar mode="create" | "edit". En mode="edit", el form se
 * inicializa con los valores del `initialFumigation` y hace PATCH en
 * lugar de POST. Esto permite editar fumigaciones una a una (no bulk)
 * desde /fumigacion/[id]/edit, sin perder trazabilidad (el id se
 * mantiene, el `recorded_by` original no se toca, etc.).
 *
 * Campos editables (ambos modos):
 *   - fumigation_date
 *   - product_used
 *   - product_id (Sprint S9 — feature/s9-product-picker-wireup)
 *   - dose_l_per_ha
 *   - area_fumigated_m2
 *   - duration_minutes
 *   - drone_code_used
 *   - notes
 *   - product_registered_ica
 *   - pilot_license
 *   - category_id
 *   - application_type_id (Sprint S7)
 *
 * Campos INMUTABLES (rechazados por el PATCH handler):
 *   - parcel_id, source, recorded_by, flight_ids, recorded_at
 *
 * Después de registrar/editar OK:
 *   - Muestra banner verde con el ID
 *   - Modo create: llama router.refresh() y queda en la misma página
 *   - Modo edit: llama router.push(`/fumigacion/${id}`) para volver
 *     al detail (que re-fetchea con el JOIN de categoría)
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
 *     bloquear la UI durante POST) + useRouter (refresh/push).
 *   - El form es chico, no amerita server actions.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldSelect } from "@/components/ui/field-select";
import { SpinnerInline } from "@/components/ui/loading";
import { DRONE_MODELS, FUMIGATION_CATEGORIES, APPLICATION_TYPES } from "@/lib/data-constants";
import { VehiclePicker } from "@/components/fumigations/vehicle-picker";
import { ProductPicker } from "@/components/fumigations/product-picker";
import { Plus, Save, X } from "lucide-react";
import type { DjiFumigationEvent } from "@/lib/types";

interface RegisterFumigationFormProps {
  parcelId: number;
  /**
   * "create" → POST /api/admin/fumigations (default si no se pasa).
   * "edit"   → PATCH /api/admin/fumigations/[id], usando initialFumigation
   *            para inicializar el form y como id destino.
   */
  mode?: "create" | "edit";
  /**
   * Requerido en mode="edit". Contiene los valores actuales de la
   * fumigación que se está editando. El parcel_id, source, recorded_by,
   * flight_ids, recorded_at NO se exponen en el form (son inmutables).
   */
  initialFumigation?: DjiFumigationEvent;
}

interface FormState {
  fumigation_date: string;
  /** Sprint 2026-08-13 — sub-2. "" = sin clasificar, "1".."7" = id de FUMIGATION_CATEGORIES. */
  category_id: string;
  /**
   * Sprint S7 — feature/s7-schema-extension / Fase 1 (PR-A).
   * Ortogonal a category_id (producto vs fase/uso).
   * "" = sin clasificar, "1".."4" = id de APPLICATION_TYPES.
   */
  application_type_id: string;
  /**
   * Sprint S7 / Fase 1 (PR-B) — placa del vehículo de transporte.
   * "" = sin asignar, "ABC-1234" = placa. La BD la guarda en
   * `dji_fumigations.vehicle_plate` (columna propia). El picker
   * (`VehiclePicker`) sugiere desde `dji_vehicles` y crea on-the-fly
   * si la placa no existe. El server normaliza a UPPER.
   */
  vehicle_plate: string;
  product_used: string;
  /**
   * Sprint S9 (2026-08-29) — feature/s9-product-picker-wireup. FK a
   * `products.id`. null = texto libre sin catálogo (legacy), id =
   * producto seleccionado via `ProductPicker`. Se setea desde el
   * picker (onChange) y se incluye en el body del POST/PATCH.
   */
  product_id: number | null;
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
    category_id: "",
    application_type_id: "",
    vehicle_plate: "",
    product_used: "",
    product_id: null,
    dose_l_per_ha: "",
    area_fumigated_m2: "",
    duration_minutes: "",
    drone_code_used: "0",
    notes: "",
    product_registered_ica: "",
    pilot_license: ""
  };
}

/**
 * Mapea un DjiFumigationEvent (row de BD) al FormState del componente.
 * En edit, normaliza nulls → strings vacíos y numbers → strings para
 * que los inputs nativos funcionen. `human_notes` se ignora (no es
 * editable vía este form — es un campo separado del operador fumigador
 * que vive en otra tabla en sprints futuros, fuera de scope).
 */
function fromFumigation(f: DjiFumigationEvent): FormState {
  return {
    fumigation_date: f.fumigation_date || todayISO(),
    category_id: f.category_id != null ? String(f.category_id) : "",
    application_type_id: f.application_type_id != null ? String(f.application_type_id) : "",
    vehicle_plate: f.vehicle_plate ?? "",
    product_used: f.product_used ?? "",
    // Sprint S9 — el ProductPicker pre-carga la FK del catálogo.
    // product_used queda como texto (puede diferir del nombre del
    // catálogo si el operador tipeó un nombre custom).
    product_id: f.product_id ?? null,
    dose_l_per_ha: f.dose_l_per_ha != null ? String(f.dose_l_per_ha) : "",
    area_fumigated_m2: f.area_fumigated_m2 != null ? String(f.area_fumigated_m2) : "",
    duration_minutes: f.duration_minutes != null ? String(f.duration_minutes) : "",
    drone_code_used: f.drone_code_used != null ? String(f.drone_code_used) : "0",
    notes: f.notes ?? "",
    product_registered_ica: f.product_registered_ica ?? "",
    pilot_license: f.pilot_license ?? ""
  };
}

export function RegisterFumigationForm({
  parcelId,
  mode = "create",
  initialFumigation
}: RegisterFumigationFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() =>
    mode === "edit" && initialFumigation
      ? fromFumigation(initialFumigation)
      : emptyForm()
  );
  /**
   * Sprint S9 (2026-08-29) — feature/s9-product-picker-wireup.
   * Incrementar este contador al hacer `reset()` fuerza al
   * `ProductPicker` a re-mountar con estado interno limpio. Sin esto,
   * el picker mantiene su `query` interno aunque el form ya esté
   * reseteado (el `query` no es prop controlado del form).
   */
  const [pickerResetKey, setPickerResetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // `isPending` lo manejamos con useState local (no con useTransition
  // — ese es solo para transiciones no-bloqueantes de React, y
  // nuestro POST/PATCH es un await explícito). `startTransition` se usa
  // solo para envolver el router.refresh() y no bloquear la UI.
  const [isPending, setIsPending] = useState(false);
  const [, startTransition] = useTransition();

  // Validación de props en dev (no rompemos en prod — solo log).
  if (mode === "edit" && !initialFumigation) {
    // En prod esto se renderiza como un form vacío que va a fallar
    // al hacer PATCH (id undefined). Es preferible al crashear la
    // página entera; el caller (la página /fumigacion/[id]/edit) se
    // asegura de pasar initialFumigation.
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error("RegisterFumigationForm: mode=edit requiere initialFumigation");
    }
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function reset() {
    if (mode === "edit" && initialFumigation) {
      setForm(fromFumigation(initialFumigation));
    } else {
      setForm(emptyForm());
    }
    // Sprint S9 — fuerza al ProductPicker a re-mountar con su query
    // interno vacío. Sin esto, el input del picker mostraría el
    // texto que el operador tipeó antes del reset.
    setPickerResetKey((k) => k + 1);
    setError(null);
    setSuccess(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsPending(true);

    // Construir body según el modo.
    //   - create: incluye parcel_id + todos los campos provistos
    //   - edit: NO incluye parcel_id (es immutable); manda SOLO los
    //     campos que difieren del initialFumigation (PATCH sparse).
    //     Para "mismo valor", no mandamos el campo (server no-op).
    const body: Record<string, unknown> = {};

    if (mode === "create") {
      body.parcel_id = parcelId;
      body.fumigation_date = form.fumigation_date;
      body.product_used = form.product_used.trim();
      // Sprint S9 — product_id (FK al catálogo). Se manda solo si no
      // es null (operador seleccionó del picker o lo creó on-the-fly).
      // Si el operador tipeó texto libre sin seleccionar, queda null
      // y la fumigación persiste solo con product_used (legacy).
      if (form.product_id != null) {
        body.product_id = form.product_id;
      }
      body.dose_l_per_ha = Number(form.dose_l_per_ha);
    } else {
      // mode === "edit"
      if (form.fumigation_date !== (initialFumigation?.fumigation_date ?? "")) {
        body.fumigation_date = form.fumigation_date;
      }
      const productTrimmed = form.product_used.trim();
      const productOriginal = initialFumigation?.product_used ?? "";
      if (productTrimmed !== productOriginal) {
        body.product_used = productTrimmed;
      }
      // Sprint S9 — product_id: sparse PATCH. Se manda solo si
      // difiere del initialFumigation.product_id (incluye null →
      // number y number → null).
      if (form.product_id !== (initialFumigation?.product_id ?? null)) {
        body.product_id = form.product_id;
      }
      const doseNum = Number(form.dose_l_per_ha);
      if (
        form.dose_l_per_ha.trim() !== "" &&
        doseNum !== (initialFumigation?.dose_l_per_ha ?? null)
      ) {
        body.dose_l_per_ha = doseNum;
      }
    }

    // Numéricos opcionales con default 0
    const numOpt = (
      v: string,
      original: number | null | undefined
    ): { send: boolean; value: number | null } => {
      const t = v.trim();
      if (t === "") return { send: false, value: null };
      const n = Number(t);
      if (Number.isNaN(n)) return { send: false, value: null };
      if (n === (original ?? null)) return { send: false, value: null };
      return { send: true, value: n };
    };

    if (mode === "create") {
      const a = numOpt(form.area_fumigated_m2, null);
      if (a.send) body.area_fumigated_m2 = a.value;
      const d = numOpt(form.duration_minutes, null);
      if (d.send) body.duration_minutes = d.value;
      if (form.drone_code_used !== "0") {
        body.drone_code_used = Number(form.drone_code_used);
      }
    } else {
      const a = numOpt(form.area_fumigated_m2, initialFumigation?.area_fumigated_m2);
      if (a.send) body.area_fumigated_m2 = a.value;
      const d = numOpt(form.duration_minutes, initialFumigation?.duration_minutes);
      if (d.send) body.duration_minutes = d.value;
      const droneNum = Number(form.drone_code_used);
      if (droneNum !== (initialFumigation?.drone_code_used ?? 0)) {
        body.drone_code_used = droneNum > 0 ? droneNum : null;
      }
    }

    // Strings opcionales
    const strOpt = (
      v: string,
      original: string | null | undefined
    ): { send: boolean; value: string | null } => {
      const t = v.trim();
      if (t === "" && (original ?? "") === "") return { send: false, value: null };
      if (t === (original ?? "")) return { send: false, value: null };
      return { send: true, value: t === "" ? null : t };
    };
    const notesRes = strOpt(form.notes, initialFumigation?.notes);
    if (notesRes.send) body.notes = notesRes.value;
    const icaRes = strOpt(form.product_registered_ica, initialFumigation?.product_registered_ica);
    if (icaRes.send) body.product_registered_ica = icaRes.value;
    const licRes = strOpt(form.pilot_license, initialFumigation?.pilot_license);
    if (licRes.send) body.pilot_license = licRes.value;

    // category_id: opcional. Si difiere del original, mandamos.
    const catNum = form.category_id.trim() === "" ? null : Number(form.category_id);
    if (catNum !== (initialFumigation?.category_id ?? null)) {
      body.category_id = catNum;
    }

    // Sprint S7 — application_type_id: opcional. Si difiere del
    // original, mandamos. Mismo patrón que category_id (ortogonal).
    const appTypeNum =
      form.application_type_id.trim() === "" ? null : Number(form.application_type_id);
    if (appTypeNum !== (initialFumigation?.application_type_id ?? null)) {
      body.application_type_id = appTypeNum;
    }

    // Sprint S7 / Fase 1 (PR-B) — vehicle_plate: opcional. El form
    // expone "" (sin asignar) o un plate string. En create, mandamos
    // el string tal cual (server normaliza a UPPER). En edit, sparse
    // PATCH: solo si difiere del initialFumigation.vehicle_plate
    // (que puede ser null o string).
    const plateTrimmed = form.vehicle_plate.trim();
    const plateOriginal = initialFumigation?.vehicle_plate ?? "";
    if (mode === "create") {
      // En create, mandamos solo si no es vacío (no enviamos el campo
      // cuando el operador no llenó el picker; el server no lo inserta
      // y queda null en BD).
      if (plateTrimmed.length > 0) {
        body.vehicle_plate = plateTrimmed;
      }
    } else {
      // mode === "edit" — sparse PATCH
      if (plateTrimmed !== plateOriginal) {
        // Si está vacío en el form pero el original tenía placa,
        // mandamos null explícito para clear. Si está vacío y el
        // original también, no mandamos nada (no-op).
        body.vehicle_plate = plateTrimmed.length > 0 ? plateTrimmed : null;
      }
    }

    try {
      const url =
        mode === "edit" && initialFumigation
          ? `/api/admin/fumigations/${initialFumigation.id}`
          : "/api/admin/fumigations";
      const method = mode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { fumigation?: { id: number } };
      if (mode === "edit" && initialFumigation) {
        setSuccess(`Fumigación #${initialFumigation.id} actualizada. Volviendo al detalle…`);
        // Esperar 600ms para que el usuario vea el banner OK y luego
        // navegar al detail (que re-fetchea con el JOIN de categoría).
        setTimeout(() => {
          startTransition(() => {
            router.push(`/fumigacion/${initialFumigation.id}`);
            router.refresh();
          });
        }, 600);
      } else {
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
      }
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
      aria-label={
        mode === "edit" && initialFumigation
          ? `Editar fumigación #${initialFumigation.id}`
          : "Registrar fumigación manual"
      }
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

      {/**
       * Sprint S7 / Fase 1 (PR-B) — picker de vehículo de transporte.
       * Ocupa la fila completa debajo de Fecha + Dron (contexto
       * operativo de la aplicación). Es controlado: el form mantiene
       * `form.vehicle_plate` y el picker emite onChange.
       */}
      <VehiclePicker
        value={form.vehicle_plate || null}
        onChange={(plate) => update("vehicle_plate", plate ?? "")}
        disabled={isPending}
      />

      {/**
       * Sprint S9 (2026-08-29) — feature/s9-product-picker-wireup.
       * `ProductPicker` reemplaza el `<Input>` plain del sprint S7.
       * El picker autocomplete sugiere del catálogo `products` y permite
       * crear uno nuevo on-the-fly (la creación es idempotente). El
       * form mantiene `product_id` (FK) y `product_used` (texto) en
       * paralelo — cuando el usuario selecciona/crea, el segundo
       * argumento del onChange sincroniza ambos campos.
       *
       * `product_used` ya NO se renderiza como input separado: el
       * picker lo maneja internamente. Si el operador quiere texto
       * libre sin catálogo, hace clic en la X del picker (clear) y
       * la fumigación persiste con product_used libre y product_id
       * null.
       */}
      <ProductPicker
        // Sprint S9 — `key` se incrementa en `reset()` para forzar
        // re-mount del picker con su query interno limpio.
        key={`product-picker-${pickerResetKey}`}
        value={form.product_id}
        onChange={(id, name) => {
          // El picker llama onChange con (id, name) en 3 casos:
          //   1. Usuario seleccionó un producto del catálogo:
          //      id = catalog id, name = catalog name
          //      → setear ambos.
          //   2. Usuario creó un producto nuevo on-the-fly:
          //      id = new id (API devuelve), name = typed name
          //      → setear ambos.
          //   3. Usuario tipeó texto libre sin seleccionar:
          //      id = null, name = typed text
          //      → setear product_used al texto, product_id = null
          //   4. Usuario limpió con la X:
          //      id = null, name = null
          //      → ambos a initial (product_id null, product_used "")
          setForm((prev) => ({
            ...prev,
            product_id: (id as number | null) ?? null,
            product_used: name != null ? name : ""
          }));
        }}
        disabled={isPending}
      />

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Tipo de fumigación
        </span>
        <FieldSelect
          label="Tipo de fumigación"
          value={form.category_id}
          onChange={(e) => update("category_id", e.target.value)}
          disabled={isPending}
        >
          <option value="">Sin clasificar</option>
          {FUMIGATION_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </FieldSelect>
        <span className="text-[10px] text-muted-foreground">
          Herbicida, insecticida, fertilizante, etc. Útil para reportes por tipo y auditoría ICA.
        </span>
      </label>

      {/**
       * Sprint S7 — feature/s7-schema-extension / Fase 1 (PR-A).
       * Ortogonal a "Tipo de fumigación" (categoría de producto).
       * `application_type` describe la FASE / USO de la fumigación
       * (pre-emergente, post-emergente, bioestimulante, otro).
       * Una fumigación puede tener AMBOS: ej "Glifosato 48% (herbicida)
       * aplicado en pre-emergente".
       */}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Fase de uso
        </span>
        <FieldSelect
          label="Fase de uso"
          value={form.application_type_id}
          onChange={(e) => update("application_type_id", e.target.value)}
          disabled={isPending}
        >
          <option value="">Sin clasificar</option>
          {APPLICATION_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </FieldSelect>
        <span className="text-[10px] text-muted-foreground">
          Cuándo se aplica: pre-emergente, post-emergente, bioestimulante, otro. Ortogonal al tipo de producto.
        </span>
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
          {mode === "edit" ? "Descartar cambios" : "Limpiar"}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={isPending}
        >
          {isPending ? (
            <>
              <SpinnerInline />
              Guardando…
            </>
          ) : mode === "edit" ? (
            <>
              <Save className="size-3.5" aria-hidden />
              Guardar cambios
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
