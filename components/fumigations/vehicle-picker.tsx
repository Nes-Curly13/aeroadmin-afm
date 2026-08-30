"use client";

/**
 * VehiclePicker — autocomplete de placas de vehículos.
 *
 * Sprint S7 / Fase 1 (PR-B) — feature/s7-ui-capture-vehicles.
 *
 * El operador fumigador registra una fumigación manual y captura la
 * placa del vehículo que usó para llegar a la finca. El picker
 * sugiere placas existentes desde el catálogo `dji_vehicles` y
 * permite crear on-the-fly si la placa tipeada no existe (la
 * creación es idempotente: si ya existe, devuelve 200 con el row).
 *
 * Por qué se persiste la placa como string y no como FK:
 *   La fumigación NO tiene una FK directa a `dji_vehicles` (el
 *   vehicle es per-flight en el modelo de datos, ver
 *   `docs/sprints/2026-08-24-s7-fase-1-plan.md` § "Caveat"). El
 *   repo guarda el string en `dji_fumigations.vehicle_plate`
 *   (columna propia, migration 20260824000001).
 *
 * UX:
 *   - Input con icono de búsqueda. Placeholder "ej. ABC-1234".
 *   - Dropdown muestra hasta 5 matches con plate + description.
 *   - Si la query no matchea (>= 3 chars, formato CHECK), aparece
 *     opción "+ Crear 'ABC-1234' como nuevo vehículo".
 *   - Click fuera cierra el dropdown.
 *   - Disabled propaga el estado del form (isPending).
 *   - Teclado: ArrowDown/Up navega, Enter selecciona, Esc cierra.
 *
 * Patrón basado en `ParcelPicker` (en
 * `components/admin/fumigations/new-fumigation-page-client.tsx`).
 * Diferencias:
 *   - VehiclePicker hace server-fetch con debounce (catálogo puede
 *     crecer). ParcelPicker filtra en cliente (parcelas recientes
 *     precargadas en props).
 *   - VehiclePicker tiene "create on the fly" (catálogo curado
 *     extensible). ParcelPicker no.
 */

import { useEffect, useId, useRef, useState } from "react";
import { Car, ChevronDown, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SpinnerInline } from "@/components/ui/loading";
import { cn } from "@/lib/utils";
import type { DjiVehicle } from "@/lib/types";

const PLATE_REGEX = /^[A-Z0-9-]{3,12}$/;
const DEBOUNCE_MS = 300;

export interface VehiclePickerProps {
  /**
   * Placa actualmente seleccionada (string en MAYÚSCULAS o null).
   * El componente es controlado: el padre pasa el valor y el
   * callback onChange.
   */
  value: string | null;
  onChange: (plate: string | null) => void;
  /**
   * Deshabilita el picker (ej: mientras el form está guardando).
   */
  disabled?: boolean;
  /**
   * Placeholder del input. Default "ej. ABC-1234".
   */
  placeholder?: string;
  /**
   * Label visible arriba del input. Si se omite, se muestra
   * "Vehículo de transporte" (default).
   */
  label?: string;
  /**
   * id accesible del input. Si se omite, se genera uno.
   */
  id?: string;
}

interface FetchState {
  results: DjiVehicle[];
  loading: boolean;
  error: string | null;
}

const EMPTY_FETCH: FetchState = { results: [], loading: false, error: null };

export function VehiclePicker({
  value,
  onChange,
  disabled = false,
  placeholder = "ej. ABC-1234",
  label = "Vehículo de transporte",
  id
}: VehiclePickerProps) {
  const autoId = useId();
  const inputId = id ?? `vehicle-picker-${autoId}`;

  // Estado del input (lo que el usuario tipea). Inicializamos con
  // `value` para que la placa seleccionada se muestre al cargar
  // (ej: en edit mode).
  const [query, setQuery] = useState<string>(value ?? "");
  const [fetchState, setFetchState] = useState<FetchState>(EMPTY_FETCH);
  const [open, setOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  // Mantener el query sincronizado con `value` cuando el padre lo
  // cambia programáticamente (ej: después de un reset del form).
  useEffect(() => {
    setQuery(value ?? "");
  }, [value]);

  // Ref para evitar race conditions: si el usuario tipea "AB" y
  // después "ABC", la respuesta de "AB" puede llegar después de
  // "ABC" y contaminar los resultados. Guardamos el id del último
  // request y descartamos respuestas viejas.
  const lastRequestId = useRef(0);
  // Ref que indica la última placa commiteada localmente (vía
  // commitSelection). Cuando el effect re-corre después de un
  // commit, el `value` del padre puede NO haberse actualizado aún
  // (React batching), pero queremos cortar el re-fetch igual.
  // Se sincroniza con `value` por un useEffect para casos de
  // clear / external reset.
  const lastCommittedRef = useRef<string | null>(value);

  useEffect(() => {
    lastCommittedRef.current = value ?? null;
  }, [value]);

  // Debounce fetch
  useEffect(() => {
    const trimmed = query.trim();
    const committed = lastCommittedRef.current ?? "";
    // No buscar si el query coincide con el último valor commiteado
    // (caso "el operador clickeó una sugerencia y el form ya tiene
    // la placa seteada; no queremos re-fetchear"). Usamos el ref
    // en vez de `value` porque el `value` del padre puede llegar
    // async después del commit local.
    if (trimmed === committed) {
      setFetchState(EMPTY_FETCH);
      return;
    }
    // Si el query es muy corto (< 1 char), no buscar.
    if (trimmed.length < 1) {
      setFetchState(EMPTY_FETCH);
      return;
    }
    const reqId = ++lastRequestId.current;
    setFetchState((prev) => ({ ...prev, loading: true, error: null }));
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/dji-vehicles?search=${encodeURIComponent(trimmed)}&limit=10`,
          { method: "GET" }
        );
        // Si este request ya no es el último, descartar.
        if (reqId !== lastRequestId.current) return;
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setFetchState({
            results: [],
            loading: false,
            error: data.error ?? `HTTP ${res.status}`
          });
          return;
        }
        const data = (await res.json()) as { vehicles: DjiVehicle[] };
        if (reqId !== lastRequestId.current) return;
        setFetchState({
          results: data.vehicles,
          loading: false,
          error: null
        });
      } catch (err) {
        if (reqId !== lastRequestId.current) return;
        setFetchState({
          results: [],
          loading: false,
          error: err instanceof Error ? err.message : "error de red"
        });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  // Click afuera cierra el dropdown.
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Determinar si la query califica para "create on the fly".
  const canCreate = (() => {
    const t = query.trim().toUpperCase();
    if (t.length < 1) return false;
    if (!PLATE_REGEX.test(t)) return false;
    // Si la query coincide con un resultado existente, no crear.
    const existing = fetchState.results.some(
      (v) => v.plate.toUpperCase() === t
    );
    return !existing;
  })();

  // Total de items en el dropdown (results + opcional "crear").
  const itemCount = fetchState.results.length + (canCreate ? 1 : 0);

  function commitSelection(plate: string) {
    const norm = plate.trim().toUpperCase();
    // Actualizar el ref ANTES de los setState. Cuando el effect
    // re-corre por el cambio de `query`, ya ve el último commit
    // y corta el fetch re-entrante.
    lastCommittedRef.current = norm;
    onChange(norm);
    setQuery(norm);
    setOpen(false);
    setActiveIndex(-1);
    setCreateError(null);
  }

  async function handleCreate() {
    const t = query.trim().toUpperCase();
    if (!PLATE_REGEX.test(t)) {
      setCreateError("placa inválida (3-12 chars, A-Z 0-9 guion)");
      return;
    }
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/admin/dji-vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plate: t })
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setCreateError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // 200 (existente) o 201 (nuevo) — ambos commits igual.
      commitSelection(t);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "error de red");
    } finally {
      setIsCreating(false);
    }
  }

  function clearSelection() {
    lastCommittedRef.current = null;
    onChange(null);
    setQuery("");
    setOpen(true);
    setActiveIndex(-1);
    setCreateError(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (e.key === "ArrowDown" && open && itemCount > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % itemCount);
      return;
    }
    if (e.key === "ArrowUp" && open && itemCount > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? itemCount - 1 : i - 1));
      return;
    }
    if (e.key === "Enter" && open && activeIndex >= 0) {
      e.preventDefault();
      const idx = activeIndex;
      if (idx < fetchState.results.length) {
        commitSelection(fetchState.results[idx].plate);
      } else if (canCreate) {
        // Index del "create" está después de los results.
        void handleCreate();
      }
    }
  }

  return (
    <div className="flex flex-col gap-1" ref={containerRef}>
      {label ? (
        <label
          htmlFor={inputId}
          className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {label}
        </label>
      ) : null}
      <div className="relative">
        <Car
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={inputId}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
            setCreateError(null);
          }}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={12}
          autoComplete="off"
          spellCheck={false}
          aria-label={label || "Vehículo de transporte"}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${inputId}-listbox`}
          aria-activedescendant={
            activeIndex >= 0 ? `${inputId}-opt-${activeIndex}` : undefined
          }
          className="pl-8 pr-16 font-mono uppercase tracking-wider"
        />
        {value ? (
          <button
            type="button"
            onClick={clearSelection}
            disabled={disabled}
            aria-label="Limpiar vehículo"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : (
          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        )}
      </div>

      {createError ? (
        <p
          role="alert"
          className="text-[10px] font-medium text-destructive"
        >
          {createError}
        </p>
      ) : null}

      {open && !disabled ? (
        <ul
          id={`${inputId}-listbox`}
          role="listbox"
          aria-label="Sugerencias de vehículo"
          className="z-20 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-md"
        >
          {fetchState.loading && fetchState.results.length === 0 ? (
            <li className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Buscando vehículos…
            </li>
          ) : null}

          {fetchState.error ? (
            <li className="px-3 py-2 text-xs text-destructive">
              Error al buscar: {fetchState.error}
            </li>
          ) : null}

          {!fetchState.loading &&
          !fetchState.error &&
          fetchState.results.length === 0 &&
          !canCreate &&
          query.trim().length > 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              Sin coincidencias para “{query.trim()}”. Probá con otra placa.
            </li>
          ) : null}

          {!fetchState.loading &&
          !fetchState.error &&
          fetchState.results.length === 0 &&
          !canCreate &&
          query.trim().length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              Tipeá al menos 1 caracter para buscar.
            </li>
          ) : null}

          {fetchState.results.map((v, idx) => (
            <li
              key={v.id}
              id={`${inputId}-opt-${idx}`}
              role="option"
              aria-selected={idx === activeIndex}
            >
              <button
                type="button"
                onClick={() => commitSelection(v.plate)}
                onMouseEnter={() => setActiveIndex(idx)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none",
                  idx === activeIndex && "bg-muted"
                )}
              >
                <div className="flex w-full items-center gap-2">
                  <span className="font-mono text-xs font-semibold tracking-wider">
                    {v.plate}
                  </span>
                  {!v.is_active ? (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                      inactivo
                    </span>
                  ) : null}
                </div>
                {v.description ? (
                  <p className="text-[11px] text-muted-foreground">
                    {v.description}
                  </p>
                ) : null}
              </button>
            </li>
          ))}

          {canCreate ? (
            <li
              id={`${inputId}-opt-${fetchState.results.length}`}
              role="option"
              aria-selected={activeIndex === fetchState.results.length}
              className="border-t border-border/60"
            >
              <button
                type="button"
                onClick={() => void handleCreate()}
                onMouseEnter={() =>
                  setActiveIndex(fetchState.results.length)
                }
                disabled={isCreating}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-muted focus:bg-muted focus:outline-none disabled:opacity-50",
                  activeIndex === fetchState.results.length && "bg-muted"
                )}
              >
                {isCreating ? (
                  <SpinnerInline />
                ) : (
                  <Plus className="size-3.5" aria-hidden />
                )}
                <span className="font-mono text-xs font-semibold tracking-wider">
                  {query.trim().toUpperCase()}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  como nuevo vehículo
                </span>
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}

      <span className="text-[10px] text-muted-foreground">
        Placa del vehículo de transporte (camioneta, moto, etc). Si no
        existe en el catálogo, podés crearla on-the-fly.
      </span>

      {/* El padre necesita saber el plate sincrónicamente; exponemos
          un input hidden para que formData lo capture si se integra
          con un <form> nativo. NO required por defecto — la captura
          es opcional. */}
      <input
        type="hidden"
        name="vehicle_plate"
        value={value ?? ""}
      />

    </div>
  );
}
