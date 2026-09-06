"use client";

/**
 * NewFumigationPageClient — wizard de alta de fumigación V2 (S11+).
 *
 * Sprint S11+ — PLAN-FUMIGACIONES-V2 / Fase 1.1 + 1.2.
 *
 * Refactor del wizard a 3 steps con map-after-selection:
 *   1. Parcela:  el operador busca/selecciona la parcela. Mapa OCULTO.
 *   2. Detalles: parcel summary + form + mapa VISIBLE (confirmación).
 *   3. Confirmar: resumen antes del POST (futuro, parte de Fase 1.1+).
 *
 * Diferencias con la versión anterior (Sprint 2026-08-05):
 *   - Antes: mapa siempre visible a la derecha (40% del screen).
 *   - Ahora: mapa solo aparece DESPUÉS de elegir parcela (step 2+).
 *   - Antes: <details> colapsado para "Crear nueva parcela".
 *   - Ahora: botón prominente en la parte inferior del picker.
 *   - Antes: copy del header mencionaba "manual" y "Sentinel-2 cloudless 2024".
 *   - Ahora: copy genérico, el detalle técnico queda en la atribución del mapa.
 *   - Antes: phase = "pick" | "form" (2 steps).
 *   - Ahora: phase = "pick" | "form" | "confirm" (3 steps, "confirm"
 *     preparado para Fase 1.1+ cuando se agregue el resumen).
 *
 * Auth: el middleware ya gatea /admin/* y el handler del POST valida
 * role admin|supervisor. Esta página no requiere role especial.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Edit3,
  MapPin,
  Plane,
  Plus,
  Search,
  Sprout
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { FumigationMap } from "@/components/parcels/fumigation-map";
import { ParcelDrawer } from "@/components/admin/parcels/parcel-drawer";
import {
  RegisterFumigationForm,
  type FormState,
  type RegisterFumigationFormHandle
} from "@/components/parcels/register-fumigation-form";
import {
  DjiFlightPicker,
  type DjiFlight
} from "@/components/fumigations/dji-flight-picker";
import type { ParcelPickerRow } from "@/api/repositories";
import {
  APPLICATION_TYPES,
  DRONE_MODELS,
  FUMIGATION_CATEGORIES
} from "@/lib/data-constants";
import { formStateSchema } from "@/lib/api-schemas";

interface NewFumigationPageClientProps {
  initialParcelId: number | null;
  recentParcels: ParcelPickerRow[];
}

type Phase = "mode" | "pick" | "form" | "confirm";
type EntryMode = "import" | "manual";

/**
 * Sprint S11+ Fase 2.5 — el wizard ahora arranca en step 0 (mode) donde
 * el operator elige entre "Importar vuelo DJI" o "Registro manual". El
 * modo persiste en `entryMode` y se usa en step 2 (form) para decidir
 * si mostrar el DjiFlightPicker arriba del form.
 */
const STEPS = [
  { id: "mode" as const, label: "Modalidad", description: "¿Importar o manual?" },
  { id: "pick" as const, label: "Parcela", description: "¿Dónde se realizó?" },
  { id: "form" as const, label: "Detalles", description: "¿Qué, cuándo y con qué?" },
  { id: "confirm" as const, label: "Confirmar", description: "Revisar y registrar" }
];

export function NewFumigationPageClient({
  initialParcelId,
  recentParcels
}: NewFumigationPageClientProps) {
  const [phase, setPhase] = useState<Phase>(
    initialParcelId ? "form" : "mode"
  );
  /**
   * Sprint S11+ Fase 2.5 — modalidad de entrada. `import` = el operator
   * quiere auto-llenar desde un vuelo DJI; `manual` = registro manual.
   * Se setea en step 0 (cards) y se lee en step 2 (form) para decidir
   * si mostrar el DjiFlightPicker. `null` antes de elegir modalidad.
   */
  const [entryMode, setEntryMode] = useState<EntryMode | null>(
    initialParcelId ? "manual" : null
  );
  /**
   * Sprint S11+ Fase 2.5 — vuelo DJI seleccionado por el operator
   * (solo cuando entryMode === "import"). En MVP, lo guardamos para
   * mostrar un hint en el form; el auto-fill completo del form
   * queda para un PR siguiente (requiere lifting de form state).
   */
  const [pickedFlight, setPickedFlight] = useState<DjiFlight | null>(null);
  const [chosenParcel, setChosenParcel] = useState<ParcelPickerRow | null>(
    initialParcelId
      ? recentParcels.find((p) => p.id === initialParcelId) ?? null
      : null
  );
  const [parcelGeom, setParcelGeom] = useState<
    { type: "Polygon"; coordinates: number[][][] } | null
  >(null);
  /**
   * Sprint S11+ Fase 1.3 — snapshot del FormState en el momento en que
   * el operador hace click en "Revisar y confirmar" (step 2). El step 3
   * (Confirm) lee de acá para mostrar el resumen. El POST real se hace
   * al click del "Confirmar y registrar" del step 3, vía formRef.
   */
  const [pendingFormData, setPendingFormData] = useState<FormState | null>(null);
  /**
   * Sprint S11+ / zod PR #3 — error de validacion del FormState
   * (zod formStateSchema) al hacer click en "Revisar y confirmar".
   * Si no es null, mostramos un banner arriba del form y NO avanzamos
   * al step 3. El operator tiene que corregir el campo y volver a
   * intentar. Esto cierra el gap entre el auto-fill del DjiFlightPicker
   * y el POST — antes, el form podia llegar al step 3 con datos
   * invalidos y fallar en el server round-trip.
   */
  const [formValidationError, setFormValidationError] = useState<string | null>(null);
  const formRef = useRef<RegisterFumigationFormHandle | null>(null);

  // Fetch de la geometría cuando hay una parcela elegida (initial o posterior).
  useEffect(() => {
    const id = chosenParcel?.id;
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/parcels/${id}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          parcel: { spray_geometry: { type: "Polygon"; coordinates: number[][][] } | null };
        };
        const g = data.parcel.spray_geometry;
        if (
          g &&
          g.type === "Polygon" &&
          Array.isArray(g.coordinates) &&
          g.coordinates.length > 0
        ) {
          setParcelGeom(g);
        }
      } catch {
        // ignorar — sin mapa, pero el form sigue funcionando
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chosenParcel?.id]);

  /**
   * Sprint S11+ Fase 2.5 — handler del step 0 (mode). Setea el
   * entryMode y avanza al step 1 (pick).
   */
  function chooseMode(mode: EntryMode) {
    setEntryMode(mode);
    setPhase("pick");
  }

  function chooseParcel(p: ParcelPickerRow) {
    setChosenParcel(p);
    setParcelGeom(null);
    setPendingFormData(null);
    setPhase("form");
  }

  /**
   * Sprint S11+ Fase 2.5 — handler del DjiFlightPicker (step 2 en
   * modo "import"). Auto-llena el form con los datos del vuelo:
   *   - fumigation_date: YYYY-MM-DD del start_at
   *   - duration_minutes: duration_seconds / 60
   *   - area_fumigated_m2: area_m2 (m²)
   *   - drone_code_used: derivado del drone_nickname via DRONE_MODELS
   *     (MVP: hardcoded "1" para "AFM T40 1" porque el picker tiene
   *     un set fijo de modelos — ver lib/data-constants.ts)
   *   - notes: "Importado de vuelo DJI #X del YYYY-MM-DD"
   *
   * El product_used, dose_l_per_ha, etc. NO se sobreescriben — el
   * operator los llena a mano. La fumigación importada se
   * pre-completa con metadata operativa; el catálogo de productos
   * sigue siendo decisión humana.
   */
  function handlePickFlight(flight: DjiFlight) {
    setPickedFlight(flight);
    // Auto-fill del form via ref. Hacemos un patch parcial — los
    // campos que el vuelo no provee quedan intactos.
    const dateStr = flight.start_at.slice(0, 10);
    const durationMin = String(Math.round(flight.duration_seconds / 60));
    // MVP: mapeamos el drone_nickname a drone_code_used buscando
    // en DRONE_MODELS. Si no matchea, queda "0" (sin asignar).
    const droneCode = (() => {
      const match = DRONE_MODELS.find((m) => m.name === flight.drone_nickname);
      return match ? String(match.id) : "0";
    })();
    formRef.current?.setFormData({
      fumigation_date: dateStr,
      duration_minutes: durationMin,
      area_fumigated_m2: flight.area_m2 ?? "",
      drone_code_used: droneCode,
      notes: `Importado de vuelo DJI #${flight.flight_id} del ${dateStr}`
    });
  }

  function reset() {
    // Sprint S11+ Fase 2.5 — "Atrás" desde el form (step 2) va al
    // step 1 (pick), NO al step 0 (mode). El operator eligió una
    // modalidad y debería poder cambiar de parcela sin re-elegir la
    // modalidad. Para volver al step 0 desde el principio, el
    // operator puede recargar la página o usar el stepper si está
    // implementado como clickeable (sprint futuro).
    setChosenParcel(null);
    setParcelGeom(null);
    setPendingFormData(null);
    setPickedFlight(null);
    setPhase("pick");
  }

  function resetToMode() {
    // Full reset al step 0 (mode). Usado solo por el reset de página
    // (no expuesto en UI por ahora).
    setChosenParcel(null);
    setParcelGeom(null);
    setPendingFormData(null);
    setPickedFlight(null);
    setEntryMode(null);
    setPhase("mode");
  }

  /**
   * Sprint S11+ Fase 1.3 — handler del "Revisar y confirmar" del step 2.
   * Captura la snapshot del form (vía el handle imperativo) y avanza
   * al step 3 (Confirm). El form NO hace POST — el parent controla.
   *
   * Sprint S11+ / zod PR #3 — valida con `formStateSchema` antes de
   * avanzar. Si hay issues, muestra un banner arriba del form y NO
   * avanza al step 3. Esto previene que el operator llegue al resumen
   * con data invalida (e.g. el DjiFlightPicker introdujo un valor
   * problematico via auto-fill, o el operator borro un required sin
   * darse cuenta).
   */
  function handleRequestReview(data: FormState) {
    const result = formStateSchema.safeParse(data);
    if (!result.success) {
      // Mostrar el primer issue en el banner. El operador puede ver
      // el resto abriendo la consola del form si quiere detalle, pero
      // lo importante es el campo exacto (path[0]).
      const first = result.error.issues[0];
      // zod `path` is `(string | number)[]`, pero TS lo tipea como
      // `PropertyKey[]` que incluye `symbol`. Forzamos a string para
      // el mensaje (TS2731: implicit symbol→string conversion falla).
      const field = String(first.path[0] ?? "form");
      const msg = first.message;
      setFormValidationError(`${field}: ${msg}`);
      return; // no avanzar al step 3
    }
    setFormValidationError(null);
    setPendingFormData(data);
    setPhase("confirm");
  }

  /**
   * Sprint S11+ / zod PR #3 — limpiar el error de validacion cuando
   * el operator edita cualquier campo del form. Asi el banner
   * desaparece apenas corrigen, sin esperar al "Revisar y confirmar"
   * de nuevo.
   */
  function clearFormValidationError() {
    if (formValidationError) setFormValidationError(null);
  }

  /**
   * Sprint S11+ Fase 1.3 — handler del "Confirmar y registrar" del
   * step 3. Dispara el submit del form (vía el handle imperativo),
   * que hace el POST real. El form maneja su propio estado de loading
   * y success/error (banners + router.refresh).
   */
  async function handleConfirm() {
    await formRef.current?.triggerSubmit();
  }

  function backToForm() {
    setPhase("form");
  }

  return (
    <div className="flex flex-col gap-6">
      <Stepper currentStep={phase} />

      {phase === "mode" ? (
        // Sprint S11+ Fase 2.5 — step 0: el operator elige modalidad.
        <ModeStep onChoose={chooseMode} />
      ) : phase === "pick" ? (
        <ParcelPicker
          recentParcels={recentParcels}
          onChoose={chooseParcel}
          onNewParcel={async (geom) => {
            setPhase("form");
            const p: ParcelPickerRow = {
              id: 0,
              land_name: "Nueva parcela (dibujada)",
              external_id: "manual-drawn",
              source: "manual",
              client_name: null,
              farm_name: null,
              municipality: null
            };
            setChosenParcel(p);
            setParcelGeom(geom);
          }}
        />
      ) : phase === "form" && chosenParcel ? (
        // Step 2 — Detalles. El form se renderiza con `onRequestReview`
        // y `ref` para que el wizard pueda capturar la snapshot y
        // disparar el submit programáticamente desde el step 3.
        // El form NO persiste al click — eso pasa en handleConfirm.
        // Sprint S11+ Fase 2.5: si entryMode === "import", se muestra
        // el DjiFlightPicker ARRIBA del form. Al pickear un vuelo, se
        // guarda en `pickedFlight` (placeholder para auto-fill futuro).
        <>
          <ParcelSummaryCard parcel={chosenParcel} onChange={reset} />
          {entryMode === "import" ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Plane className="size-4 text-primary" aria-hidden />
                  Importar vuelo DJI
                </CardTitle>
                <CardDescription>
                  Elegí un vuelo DJI de la lista. Los datos del vuelo
                  (fecha, duración, área) se van a usar para registrar la
                  fumigación.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DjiFlightPicker
                  parcelaId={chosenParcel.id}
                  onPick={handlePickFlight}
                />
                {pickedFlight ? (
                  <p
                    data-testid="picked-flight-hint"
                    className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary"
                  >
                    Auto-llenado con datos del vuelo DJI #
                    {pickedFlight.flight_id} del{" "}
                    {pickedFlight.start_at.slice(0, 10)}. Revisá los campos
                    antes de avanzar.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Plus className="size-4 text-primary" aria-hidden />
                    Datos de la fumigación
                  </CardTitle>
                  <CardDescription>
                    Llená los datos. En el próximo paso vas a poder revisarlos
                    antes de registrar la fumigación.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/*
                    Sprint S11+ / zod PR #3 — banner de error de
                    validacion. Aparece si `handleRequestReview`
                    encontro issues con `formStateSchema`. El operator
                    corrige y vuelve a "Revisar y confirmar".
                  */}
                  {formValidationError ? (
                    <div
                      role="alert"
                      data-testid="form-validation-error"
                      className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    >
                      <span aria-hidden>⚠️</span>
                      <div>
                        <strong>Revisá el formulario antes de continuar:</strong>{" "}
                        {formValidationError}
                      </div>
                    </div>
                  ) : null}
                  <RegisterFumigationForm
                    ref={formRef}
                    parcelId={chosenParcel.id || 0}
                    onRequestReview={handleRequestReview}
                  />
                </CardContent>
              </Card>
            </div>
            {parcelGeom ? (
              <div className="lg:col-span-2">
                <div className="sticky top-20 flex flex-col gap-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <MapPin className="size-4 text-primary" aria-hidden />
                    Ubicación de la fumigación
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Verificá que la parcela seleccionada corresponde al área
                    donde se realizó la aplicación.
                  </p>
                  <FumigationMap
                    parcelGeom={parcelGeom}
                    fumigationPoint={null}
                    flights={[]}
                    className="h-[420px] lg:h-[500px]"
                  />
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex items-center justify-between border-t border-border pt-4">
            <Button variant="ghost" onClick={reset}>
              <ChevronLeft className="size-4" aria-hidden />
              Atrás
            </Button>
            <p className="text-xs text-muted-foreground">
              Paso 2 de {STEPS.length}. Revisá los datos y avanzá al paso 3.
            </p>
          </div>
        </>
      ) : phase === "confirm" && chosenParcel && pendingFormData ? (
        // Sprint S11+ Fase 1.3 — step 3 (Confirm). El form ya NO está
        // montado — el operator ve un resumen read-only. El botón
        // "Confirmar y registrar" dispara el POST vía formRef.
        <>
          <ParcelSummaryCard parcel={chosenParcel} onChange={reset} />
          <ConfirmStep
            formData={pendingFormData}
            onBack={backToForm}
            onConfirm={handleConfirm}
          />
          <div className="flex items-center justify-between border-t border-border pt-4">
            <Button variant="ghost" onClick={backToForm}>
              <ChevronLeft className="size-4" aria-hidden />
              Atrás
            </Button>
            <p className="text-xs text-muted-foreground">
              Paso 3 de {STEPS.length}. Revisá y confirmá para registrar.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ============================================================
// ModeStep — step 0 del wizard (Fase 2.5)
// ============================================================
//
// Dos cards grandes: "Importar vuelo DJI" y "Registro manual".
// El operator elige UNA y avanza al step 1 (elegir parcela).
//
// Patrón visual consistente con ParcelPicker y la ParcelSummaryCard
// (cards con icon + título + descripción + botón de acción).

function ModeStep({ onChoose }: { onChoose: (mode: "import" | "manual") => void }) {
  return (
    <div
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
      data-testid="mode-step"
    >
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plane className="size-4 text-primary" aria-hidden />
            Importar vuelo DJI
          </CardTitle>
          <CardDescription>
            Usá los datos de un vuelo registrado por DJI (fecha, duración,
            área, dron, piloto). El sistema busca los vuelos de la parcela
            elegida en los últimos 30 días.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            onClick={() => onChoose("import")}
            className="w-full"
          >
            <Plane className="size-4" aria-hidden />
            Importar vuelo
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Edit3 className="size-4 text-primary" aria-hidden />
            Registro manual
          </CardTitle>
          <CardDescription>
            Registrá una fumigación que no tiene información de vuelo DJI
            (manual, re-tratamiento, fuera de rango). Llenas el form a mano.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            onClick={() => onChoose("manual")}
            className="w-full"
          >
            <Edit3 className="size-4" aria-hidden />
            Registro manual
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// ConfirmStep — step 3 del wizard (Fase 1.3)
// ============================================================
//
// Muestra un resumen read-only de la fumigación a registrar:
//   - Parcela (resumida, en el ParcelSummaryCard que viene de arriba)
//   - Campos clave del form: fecha, producto, dosis, área, dron, etc.
//
// El operator puede:
//   - Volver a step 2 (botón "Atrás") para editar
//   - Confirmar (botón "Confirmar y registrar") para ejecutar el POST
//
// La data del form se pasa como `formData` (snapshot tomada en el step
// 2 vía `onRequestReview`). El POST real lo dispara el parent vía
// `onConfirm` → `formRef.current?.triggerSubmit()`.

interface ConfirmStepProps {
  formData: FormState;
  onBack: () => void;
  onConfirm: () => void | Promise<void>;
}

function ConfirmStep({ formData, onBack, onConfirm }: ConfirmStepProps) {
  const date = String(formData.fumigation_date ?? "");
  const product = String(formData.product_used ?? "");
  const productId = formData.product_id as number | null | undefined;
  const dose = String(formData.dose_l_per_ha ?? "");
  const area = String(formData.area_fumigated_m2 ?? "");
  const duration = String(formData.duration_minutes ?? "");
  const droneCode = String(formData.drone_code_used ?? "0");
  const vehiclePlate = String(formData.vehicle_plate ?? "");
  const categoryId = String(formData.category_id ?? "");
  const applicationTypeId = String(formData.application_type_id ?? "");
  const ica = String(formData.product_registered_ica ?? "");
  const license = String(formData.pilot_license ?? "");
  const notes = String(formData.notes ?? "");

  const droneName = (() => {
    const d = DRONE_MODELS.find((m) => String(m.id) === droneCode);
    if (!d) return null;
    return d.id === 0 ? "Sin asignar" : `${d.name} (${d.tank_l} L)`;
  })();
  const categoryName = FUMIGATION_CATEGORIES.find((c) => String(c.id) === categoryId)?.label;
  const applicationTypeName = APPLICATION_TYPES.find(
    (t) => String(t.id) === applicationTypeId
  )?.label;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="size-4 text-primary" aria-hidden />
            Revisá los datos antes de registrar
          </CardTitle>
          <CardDescription>
            Si todo está correcto, confirmá para registrar la fumigación. Si
            hay algo mal, volvé al paso anterior para editarlo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <SummaryRow label="Fecha" value={date || "—"} />
            <SummaryRow
              label="Producto"
              value={
                product
                  ? product
                  : productId != null
                    ? `#${productId} (sin nombre)`
                    : "—"
              }
            />
            <SummaryRow label="Dosis" value={dose ? `${dose} L/ha` : "—"} />
            <SummaryRow label="Área fumigada" value={area ? `${area} m²` : "—"} />
            <SummaryRow
              label="Duración"
              value={duration ? `${duration} min` : "—"}
            />
            <SummaryRow label="Dron" value={droneName ?? "—"} />
            <SummaryRow
              label="Placa vehículo"
              value={vehiclePlate || "—"}
            />
            <SummaryRow
              label="Tipo de fumigación"
              value={categoryName ?? "—"}
            />
            <SummaryRow label="Fase de uso" value={applicationTypeName ?? "—"} />
            <SummaryRow
              label="Registro ICA"
              value={ica || "—"}
            />
            <SummaryRow
              label="Licencia piloto"
              value={license || "—"}
            />
            {notes ? (
              <div className="sm:col-span-2">
                <SummaryRow label="Notas" value={notes} multiline />
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onBack}>
          <ChevronLeft className="size-4" aria-hidden />
          Volver a editar
        </Button>
        <Button onClick={onConfirm}>
          <Check className="size-4" aria-hidden />
          Confirmar y registrar
        </Button>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  multiline = false
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`text-sm text-foreground ${multiline ? "whitespace-pre-wrap" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

// ============================================================
// Stepper — siempre visible, marca el step activo
// ============================================================

function Stepper({ currentStep }: { currentStep: Phase }) {
  const currentIdx = STEPS.findIndex((s) => s.id === currentStep);
  return (
    <nav
      aria-label="Pasos del wizard"
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      {STEPS.map((step, idx) => {
        const isActive = step.id === currentStep;
        const isComplete = idx < currentIdx;
        return (
          <div key={step.id} className="flex items-center gap-2 sm:flex-1">
            <div
              data-testid={`step-${step.id}`}
              aria-current={isActive ? "step" : undefined}
              className={`flex flex-1 items-center gap-3 rounded-md border px-3 py-2 ${
                isActive
                  ? "border-primary bg-primary/5"
                  : isComplete
                    ? "border-border bg-muted/30"
                    : "border-border"
              }`}
            >
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  isActive || isComplete
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
                aria-hidden
              >
                {isComplete ? <Check className="size-3" /> : idx + 1}
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{step.label}</span>
                <span className="text-[11px] text-muted-foreground">
                  {step.description}
                </span>
              </div>
            </div>
            {idx < STEPS.length - 1 ? (
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground sm:hidden"
                aria-hidden
              />
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

// ============================================================
// ParcelPicker — autocomplete live + botón "Crear nueva" prominente
// ============================================================

function ParcelPicker({
  recentParcels,
  onChoose,
  onNewParcel
}: {
  recentParcels: ParcelPickerRow[];
  onChoose: (p: ParcelPickerRow) => void;
  onNewParcel: (geom: { type: "Polygon"; coordinates: number[][][] }) => void;
}) {
  const [query, setQuery] = useState("");
  const [drawerGeom, setDrawerGeom] = useState<{
    type: "Polygon";
    coordinates: number[][][];
  } | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);

  const results = useMemo(() => {
    if (query.trim().length < 1) return [];
    const q = query.toLowerCase();
    return recentParcels
      .filter((p) => {
        const haystack = [
          String(p.id),
          p.land_name ?? "",
          p.external_id,
          p.client_name ?? "",
          p.farm_name ?? "",
          p.municipality ?? ""
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 10);
  }, [query, recentParcels]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sprout className="size-4 text-primary" aria-hidden />
            ¿A qué parcela le vas a registrar la fumigación?
          </CardTitle>
          <CardDescription>
            Buscá por nombre, ID externo, cliente, hacienda o municipio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative mb-3">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, ID, cliente, hacienda, municipio…"
              aria-label="Buscar parcela existente"
              className="pl-8"
              autoFocus
            />
          </div>

          {results.length > 0 ? (
            <ul className="overflow-hidden rounded-md border border-border">
              {results.map((p) => (
                <li
                  key={p.id}
                  className="border-b border-border/60 last:border-0"
                >
                  <button
                    type="button"
                    onClick={() => onChoose(p)}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                  >
                    <div className="flex w-full items-center gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        #{p.id}
                      </span>
                      <span className="font-semibold">
                        {p.land_name ?? "(sin nombre)"}
                      </span>
                      {p.source === "manual" || p.source === "imported" ? (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                          {p.source}
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
              ))}
            </ul>
          ) : query.trim().length > 0 ? (
            <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Sin coincidencias para “{query}”. Si la parcela es nueva,
              usá el botón de abajo.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Tipeá para buscar entre las {recentParcels.length} parcelas
              registradas.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Botón prominente: crear nueva parcela (no <details> colapsado) */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">¿No encontrás la parcela?</p>
            <p className="text-xs text-muted-foreground">
              Dibujá el límite en el mapa y creala con el alta manual.
            </p>
          </div>
          {!showDrawer ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowDrawer(true)}
              className="self-start"
            >
              <Plus className="size-4" aria-hidden />
              Crear nueva parcela
            </Button>
          ) : (
            <div className="flex flex-col gap-3">
              <ParcelDrawer onPolygonChange={setDrawerGeom} />
              {drawerGeom ? (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    Polígono listo ({drawerGeom.coordinates[0].length - 1}{" "}
                    vértices). La parcela se crea en el alta manual.
                  </p>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => onNewParcel(drawerGeom)}
                    disabled
                  >
                    Continuar
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// ParcelSummaryCard — muestra qué parcela está elegida
// ============================================================

function ParcelSummaryCard({
  parcel,
  onChange
}: {
  parcel: ParcelPickerRow;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
      <Sprout className="size-5 shrink-0 text-primary" aria-hidden />
      <div className="flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Fumigando la parcela
        </p>
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
          #{parcel.id || "—"}
        </p>
        <p className="font-semibold text-foreground">
          {parcel.land_name ?? "(sin nombre)"}
        </p>
        {parcel.external_id ? (
          <p className="font-mono text-[10px] text-muted-foreground">
            {parcel.external_id}
          </p>
        ) : null}
      </div>
      <Button variant="ghost" size="sm" onClick={onChange}>
        Cambiar
      </Button>
    </div>
  );
}
