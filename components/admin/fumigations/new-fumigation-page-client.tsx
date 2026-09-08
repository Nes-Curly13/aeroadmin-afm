"use client";

/**
 * NewFumigationPageClient — wizard de alta de fumigación V3 (Fase 4, 2026-09-08).
 *
 * Sprint 2026-09-08 — refactor UX del wizard a 3 pasos basado en feedback
 * del operador fumigador (no más clicks innecesarios).
 *
 * Antes (V2, S11+ Fase 2.5): 4 pasos
 *   1. Modalidad  — elegir "Importar vuelo DJI" o "Registro manual"
 *   2. Parcela    — buscar/elegir parcela (o crear nueva)
 *   3. Detalles   — form completo + DjiFlightPicker (si import)
 *   4. Confirmar  — resumen read-only
 *
 * Ahora (V3, Fase 4): 3 pasos
 *   1. ¿Qué se fumigó?  — tabs (Importar/Manual) + ParcelPicker + (si Import) DjiFlightPicker
 *   2. ¿Con qué se fumigó? — RegisterFumigationForm + mapa de la parcela
 *   3. Confirmar        — resumen read-only
 *
 * Cambios clave:
 *   - El step 0 (Modalidad) y el step 1 (Pick) se fusionan en uno solo
 *     ("¿Qué se fumigó?"). El operator elige modalidad con tabs en la parte
 *     superior del picker.
 *   - El DjiFlightPicker (cuando entryMode === "import") se renderiza
 *     DENTRO del step 1, después de elegir parcela. El auto-fill ocurre
 *     acá, no en el form.
 *   - El "Continuar al paso 2" reemplaza el auto-advance: el operator
 *     decide cuándo avanzar, sobre todo en import (donde también
 *     necesita elegir vuelo antes de avanzar).
 *   - Stepper con 3 steps en vez de 4.
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

type Phase = "que" | "como" | "confirm";
type EntryMode = "import" | "manual";

/**
 * Fase 4 — 3 steps conceptuales:
 *   1. que     → ¿Qué se fumigó?  (parcela + opcionalmente vuelo DJI)
 *   2. como    → ¿Con qué se fumigó? (dron, producto, dosis, etc.)
 *   3. confirm → Confirmar (resumen read-only)
 */
const STEPS = [
  { id: "que" as const, label: "¿Qué se fumigó?", description: "Parcela y vuelo" },
  { id: "como" as const, label: "¿Con qué se fumigó?", description: "Dron, producto y detalles" },
  { id: "confirm" as const, label: "Confirmar", description: "Revisar y registrar" }
];

export function NewFumigationPageClient({
  initialParcelId,
  recentParcels
}: NewFumigationPageClientProps) {
  /**
   * Fase 4 — si el URL trae `?parcel=N`, el operator ya sabe qué
   * parcela. Saltamos al step 2 ("¿Con qué se fumigó?") y pre-llenamos
   * `entryMode` a "manual" (no se puede auto-importar sin pasar por
   * el picker de vuelos).
   */
  const [phase, setPhase] = useState<Phase>(
    initialParcelId ? "como" : "que"
  );
  /**
   * Fase 4 — modalidad de entrada. Default "manual" (mas comun para
   * el operator fumigador: registra fumigaciones que no tienen vuelo
   * DJI asociado). El operator puede cambiar a "import" via los tabs
   * en el step 1.
   */
  const [entryMode, setEntryMode] = useState<EntryMode>("manual");
  /**
   * Vuelo DJI seleccionado (solo cuando entryMode === "import").
   * Fase 4: el flight picker esta en el step 1, NO en el step 2.
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
   * Snapshot del FormState en el momento en que el operator hace click
   * en "Revisar y confirmar" (step 2). El step 3 (Confirm) lee de aca
   * para mostrar el resumen. El POST real se hace al click del
   * "Confirmar y registrar" del step 3, via formRef.
   */
  const [pendingFormData, setPendingFormData] = useState<FormState | null>(null);
  /**
   * Error de validacion del FormState (zod formStateSchema) al hacer
   * click en "Revisar y confirmar". Si no es null, mostramos un
   * banner arriba del form y NO avanzamos al step 3.
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
   * Fase 4 — handler del step 1: el operator eligio parcela y (si
   * import) vuelo. Avanza al step 2 ("como"). El form se monta y
   * el ref queda listo para que el step 3 pueda capturar la
   * snapshot y disparar el submit.
   */
  function goToComo() {
    setPhase("como");
  }

  function resetParcel() {
    // Sprint 2026-09-08 (Fase 4): desde el step 2 (como) el operator
    // puede volver a step 1 (que) via "Cambiar" en ParcelSummaryCard.
    // Limpiamos parcel + flight para que re-elegir.
    setChosenParcel(null);
    setParcelGeom(null);
    setPendingFormData(null);
    setPickedFlight(null);
    setPhase("que");
  }

  function setMode(mode: EntryMode) {
    setEntryMode(mode);
    if (mode === "manual") {
      // Si cambia a manual despues de haber pickeado un flight, lo limpiamos.
      setPickedFlight(null);
    }
  }

  /**
   * Fase 4 — handler del DjiFlightPicker (step 1, modo "import").
   * Auto-llena el form via setFormData (mismo patron que V2). El
   * form esta en el step 2 (aun no montado cuando se pickea un
   * flight), asi que el primer setFormData puede no tener efecto
   * visual hasta que se avance. Para preservar el auto-fill, lo
   * guardamos en un queue que se aplica cuando el form se monta.
   *
   * Implementacion: usamos `pendingFlightData` para que cuando el
   * form se monte (step 2), un effect lo empuje. Tambien intentamos
   * setFormData inmediatamente por si el form ya esta montado
   * (e.g. si el operator vuelve del step 2 a step 1 y pickea otro
   * flight).
   */
  const [pendingFlightData, setPendingFlightData] = useState<Partial<FormState> | null>(null);
  function handlePickFlight(flight: DjiFlight) {
    setPickedFlight(flight);
    const dateStr = flight.start_at.slice(0, 10);
    const durationMin = String(Math.round(flight.duration_seconds / 60));
    const droneCode = (() => {
      const match = DRONE_MODELS.find((m) => m.name === flight.drone_nickname);
      return match ? String(match.id) : "0";
    })();
    const patch: Partial<FormState> = {
      fumigation_date: dateStr,
      duration_minutes: durationMin,
      area_fumigated_m2: flight.area_m2 ?? "",
      drone_code_used: droneCode,
      notes: `Importado de vuelo DJI #${flight.flight_id} del ${dateStr}`
    };
    setPendingFlightData(patch);
    // Si el form ya esta montado (operator re-pickea desde el step 2
    // hacia atras), el ref funciona directamente.
    formRef.current?.setFormData(patch);
  }

  /**
   * Fase 4 — cuando el form se monta (transicion a "como"), aplicamos
   * el pendingFlightData si hay uno. Asi el auto-fill del vuelo DJI
   * llega al form aunque el form se monte DESPUES del pick.
   */
  useEffect(() => {
    if (phase === "como" && pendingFlightData && formRef.current) {
      formRef.current.setFormData(pendingFlightData);
    }
  }, [phase, pendingFlightData]);

  /**
   * Handler del "Revisar y confirmar" del step 2. Captura la snapshot
   * del form (via el handle imperativo) y avanza al step 3 (Confirm).
   * Valida con formStateSchema antes de avanzar.
   */
  function handleRequestReview(data: FormState) {
    const result = formStateSchema.safeParse(data);
    if (!result.success) {
      const first = result.error.issues[0];
      const field = String(first.path[0] ?? "form");
      const msg = first.message;
      setFormValidationError(`${field}: ${msg}`);
      return;
    }
    setFormValidationError(null);
    setPendingFormData(data);
    setPhase("confirm");
  }

  function clearFormValidationError() {
    if (formValidationError) setFormValidationError(null);
  }

  /**
   * Handler del "Confirmar y registrar" del step 3. Dispara el
   * submit del form (via el handle imperativo), que hace el POST real.
   */
  async function handleConfirm() {
    await formRef.current?.triggerSubmit();
  }

  function backToComo() {
    setPhase("como");
  }

  return (
    <div className="flex flex-col gap-6">
      <Stepper
        currentStep={phase}
        onJump={(target) => {
          setPhase(target);
        }}
      />

      {phase === "que" ? (
        <QueStep
          entryMode={entryMode}
          onModeChange={setMode}
          recentParcels={recentParcels}
          chosenParcel={chosenParcel}
          onChooseParcel={(p) => {
            setChosenParcel(p);
            setParcelGeom(null);
            setPendingFormData(null);
            setPickedFlight(null);
            setPendingFlightData(null);
          }}
          onNewParcel={(geom) => {
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
          pickedFlight={pickedFlight}
          onPickFlight={handlePickFlight}
          onContinue={goToComo}
        />
      ) : phase === "como" && chosenParcel ? (
        <>
          <ParcelSummaryCard parcel={chosenParcel} onChange={resetParcel} />
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
            <Button variant="ghost" onClick={resetParcel}>
              <ChevronLeft className="size-4" aria-hidden />
              Cambiar parcela
            </Button>
            <p className="text-xs text-muted-foreground">
              Paso 2 de {STEPS.length}. Revisá los datos y avanzá al paso 3.
            </p>
          </div>
        </>
      ) : phase === "confirm" && chosenParcel && pendingFormData ? (
        <>
          <ParcelSummaryCard parcel={chosenParcel} onChange={resetParcel} />
          <ConfirmStep
            formData={pendingFormData}
            onBack={backToComo}
            onConfirm={handleConfirm}
          />
          <div className="flex items-center justify-between border-t border-border pt-4">
            <Button variant="ghost" onClick={backToComo}>
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
// QueStep — step 1 del wizard V3 (Fase 4)
// ============================================================
//
// Combina la eleccion de modalidad (Importar/Manual) con el ParcelPicker
// y, en modo "import", el DjiFlightPicker. El "Continuar al paso 2"
// esta en la parte inferior, gated segun:
//   - Parcela elegida (siempre requerido)
//   - Vuelo elegido (solo si entryMode === "import")

interface QueStepProps {
  entryMode: EntryMode;
  onModeChange: (mode: EntryMode) => void;
  recentParcels: ParcelPickerRow[];
  chosenParcel: ParcelPickerRow | null;
  onChooseParcel: (p: ParcelPickerRow) => void;
  onNewParcel: (geom: { type: "Polygon"; coordinates: number[][][] }) => void;
  pickedFlight: DjiFlight | null;
  onPickFlight: (f: DjiFlight) => void;
  onContinue: () => void;
}

function QueStep({
  entryMode,
  onModeChange,
  recentParcels,
  chosenParcel,
  onChooseParcel,
  onNewParcel,
  pickedFlight,
  onPickFlight,
  onContinue
}: QueStepProps) {
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

  const canContinue =
    chosenParcel !== null &&
    (entryMode === "manual" || pickedFlight !== null);

  return (
    <div className="flex flex-col gap-4" data-testid="que-step">
      {/* Tabs: Importar vuelo / Manual */}
      <div
        role="tablist"
        aria-label="Modalidad de registro"
        className="inline-flex w-full rounded-md border border-border bg-muted/30 p-1 sm:w-auto"
      >
        <button
          type="button"
          role="tab"
          aria-selected={entryMode === "import"}
          data-testid="tab-import"
          onClick={() => onModeChange("import")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-sm px-3 py-2 text-sm font-medium transition-colors sm:flex-none ${
            entryMode === "import"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Plane className="size-4" aria-hidden />
          Importar vuelo DJI
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={entryMode === "manual"}
          data-testid="tab-manual"
          onClick={() => onModeChange("manual")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-sm px-3 py-2 text-sm font-medium transition-colors sm:flex-none ${
            entryMode === "manual"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Edit3 className="size-4" aria-hidden />
          Registro manual
        </button>
      </div>

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

          {chosenParcel ? (
            <div
              className="mb-3 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
              data-testid="chosen-parcel-hint"
            >
              <Sprout className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="flex-1 truncate">
                <strong>{chosenParcel.land_name ?? "(sin nombre)"}</strong>
                {chosenParcel.client_name || chosenParcel.farm_name
                  ? ` — ${[chosenParcel.client_name, chosenParcel.farm_name]
                      .filter(Boolean)
                      .join(" · ")}`
                  : ""}
              </span>
            </div>
          ) : null}

          {!chosenParcel && results.length > 0 ? (
            <ul className="overflow-hidden rounded-md border border-border">
              {results.map((p) => (
                <li
                  key={p.id}
                  className="border-b border-border/60 last:border-0"
                >
                  <button
                    type="button"
                    onClick={() => onChooseParcel(p)}
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
          ) : !chosenParcel && query.trim().length > 0 ? (
            <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Sin coincidencias para “{query}”. Si la parcela es nueva,
              usá el botón de abajo.
            </p>
          ) : !chosenParcel ? (
            <p className="text-xs text-muted-foreground">
              Tipeá para buscar entre las {recentParcels.length} parcelas
              registradas.
            </p>
          ) : null}
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

      {/* Flight picker (solo en modo import) — despues de elegir parcela */}
      {entryMode === "import" && chosenParcel ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Plane className="size-4 text-primary" aria-hidden />
              Importar vuelo DJI
            </CardTitle>
            <CardDescription>
              Elegí un vuelo DJI de la lista. Los datos del vuelo (fecha,
              duración, área) se van a usar para registrar la fumigación.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DjiFlightPicker
              parcelaId={chosenParcel.id}
              onPick={onPickFlight}
            />
            {pickedFlight ? (
              <p
                data-testid="picked-flight-hint"
                className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary"
              >
                Auto-llenado con datos del vuelo DJI #
                {pickedFlight.flight_id} del{" "}
                {pickedFlight.start_at.slice(0, 10)}. Revisá los campos antes
                de avanzar.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Continuar al paso 2 */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          Paso 1 de {STEPS.length}. Elegí la parcela{entryMode === "import" ? " y el vuelo DJI" : ""}.
        </p>
        <Button
          onClick={onContinue}
          disabled={!canContinue}
          data-testid="continue-to-como"
        >
          Continuar al paso 2
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// ConfirmStep — step 3 del wizard (Fase 1.3, sin cambios en V3)
// ============================================================
//
// Muestra un resumen read-only de la fumigación a registrar:
//   - Parcela (resumida, en el ParcelSummaryCard que viene de arriba)
//   - Campos clave del form: fecha, producto, dosis, área, dron, etc.
//
// El operator puede:
//   - Volver a step 2 (botón "Atrás") para editar
//   - Confirmar (botón "Confirmar y registrar") para ejecutar el POST

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

function Stepper({ currentStep, onJump }: { currentStep: Phase; onJump: (step: Phase) => void }) {
  const currentIdx = STEPS.findIndex((s) => s.id === currentStep);
  return (
    <nav
      aria-label="Pasos del wizard"
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      {STEPS.map((step, idx) => {
        const isActive = step.id === currentStep;
        const isComplete = idx < currentIdx;
        const isClickable = isComplete;
        const Wrapper = isClickable ? "button" : "div";
        return (
          <div key={step.id} className="flex items-center gap-2 sm:flex-1">
            <Wrapper
              type={isClickable ? "button" : undefined}
              onClick={isClickable ? () => onJump(step.id) : undefined}
              data-testid={`step-${step.id}`}
              aria-current={isActive ? "step" : undefined}
              className={`flex flex-1 items-center gap-3 rounded-md border px-3 py-2 text-left ${
                isActive
                  ? "border-primary bg-primary/5"
                  : isComplete
                    ? "border-border bg-muted/30 cursor-pointer transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
            </Wrapper>
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
