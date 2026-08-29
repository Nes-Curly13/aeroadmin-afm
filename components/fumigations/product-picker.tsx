"use client";

/**
 * ProductPicker — autocomplete de productos fumigados.
 *
 * Sprint S8 (Bloque E) — 2026-08-29.
 *
 * El operador fumigador registra una fumigación manual y captura el
 * producto comercial que usó (Glifosato 48% LCE, Roundup, 2-4-D, etc).
 * El picker sugiere productos del catálogo `products` y permite crear
 * on-the-fly si lo tipeado no existe (la creación es idempotente: si
 * ya existe, devuelve 200 con el row).
 *
 * Diferencias con `VehiclePicker`:
 *   - Sin regex restrictivo: nombres comerciales son free-form
 *     (pueden tener %, espacios, palabras como "Roundup 36% SL").
 *   - Create on the fly disponible con >= 3 chars (vs 3-12 chars
 *     regex en vehicle).
 *   - Muestra chip con color (display_color) si el producto lo tiene.
 *
 * Patrón basado en `VehiclePicker` (componentes/fumigaciones/vehicle-picker.tsx).
 */

import { useEffect, useId, useRef, useState } from "react";
import { FlaskConical, Loader2, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SpinnerInline } from "@/components/ui/loading";
import { cn } from "@/lib/utils";
import type { DjiProduct, ProductCategory } from "@/lib/types";

const DEBOUNCE_MS = 300;
const MIN_CREATE_CHARS = 3;

const CATEGORY_LABEL: Record<ProductCategory, string> = {
  herbicida: "Herbicida",
  insecticida: "Insecticida",
  fertilizante: "Fertilizante",
  fungicida: "Fungicida",
  bioestimulante: "Bioestimulante",
  otro: "Otro"
};

export interface ProductPickerProps {
  /** id del producto seleccionado (o null). Componente controlado. */
  value: number | string | null;
  onChange: (productId: number | string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  id?: string;
}

interface FetchState {
  results: DjiProduct[];
  loading: boolean;
  error: string | null;
}

const EMPTY_FETCH: FetchState = { results: [], loading: false, error: null };

export function ProductPicker({
  value,
  onChange,
  disabled = false,
  placeholder = "ej. Glifosato 48% LCE",
  label = "Producto comercial",
  id
}: ProductPickerProps) {
  const autoId = useId();
  const inputId = id ?? `product-picker-${autoId}`;

  // Query es lo que el usuario tipea. `selectedName` se setea cuando
  // eligen un producto del catálogo, para mostrar el nombre en el input
  // aunque el form guarde el id.
  const [query, setQuery] = useState<string>("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>(EMPTY_FETCH);
  const [open, setOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  // Mantener selectedName sincronizado con el value (id) — fetch el
  // producto al inicio si tenemos un id sin nombre.
  useEffect(() => {
    if (value == null) {
      setSelectedName(null);
      return;
    }
    // Si el query ya es el nombre del value, no hacer nada
    if (query && fetchState.results.some((p) => String(p.id) === String(value))) {
      return;
    }
    // Si value es un id numerico, buscar el producto por id
    if (typeof value === "number" || /^\d+$/.test(String(value))) {
      // Usar el endpoint GET con search="" para listar y encontrarlo
      fetch(`/api/admin/products?search=&limit=50`, { method: "GET" })
        .then((r) => r.json() as Promise<{ products: DjiProduct[] }>)
        .then((data) => {
          const found = data.products.find((p) => String(p.id) === String(value));
          if (found) {
            setSelectedName(found.name);
            setQuery(found.name);
          }
        })
        .catch(() => {
          /* silent */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const lastRequestId = useRef(0);
  const lastCommittedRef = useRef<string | number | null>(value);

  useEffect(() => {
    lastCommittedRef.current = value;
  }, [value]);

  // Debounce fetch
  useEffect(() => {
    const trimmed = query.trim();
    const committed = lastCommittedRef.current;
    // Si el query coincide con el nombre del producto seleccionado, no buscar
    if (selectedName && trimmed === selectedName) {
      setFetchState(EMPTY_FETCH);
      return;
    }
    if (trimmed.length < 1) {
      setFetchState(EMPTY_FETCH);
      return;
    }
    const reqId = ++lastRequestId.current;
    setFetchState((prev) => ({ ...prev, loading: true, error: null }));
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/products?search=${encodeURIComponent(trimmed)}&limit=10`,
          { method: "GET" }
        );
        if (reqId !== lastRequestId.current) return;
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setFetchState({
            results: [],
            loading: false,
            error: data.error ?? `HTTP ${res.status}`
          });
          return;
        }
        const data = (await res.json()) as { products: DjiProduct[] };
        if (reqId !== lastRequestId.current) return;
        setFetchState({
          results: data.products,
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
  }, [query, selectedName]);

  // Click outside
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

  // Determinar si la query califica para "create on the fly"
  const canCreate = (() => {
    const t = query.trim();
    if (t.length < MIN_CREATE_CHARS) return false;
    if (!selectedName || t.toLowerCase() !== selectedName.toLowerCase()) {
      // Hay texto nuevo que no matchea el seleccionado
      const exists = fetchState.results.some(
        (p) => p.name.toLowerCase() === t.toLowerCase()
      );
      if (!exists) return true;
    }
    return false;
  })();

  function selectProduct(p: DjiProduct) {
    lastCommittedRef.current = p.id;
    onChange(p.id);
    setSelectedName(p.name);
    setQuery(p.name);
    setOpen(false);
    setActiveIndex(-1);
    setCreateError(null);
  }

  async function createAndSelect() {
    const t = query.trim();
    if (t.length < MIN_CREATE_CHARS) return;
    setIsCreating(true);
    setCreateError(null);
    lastRequestId.current++; // descartar respuestas viejas
    const reqId = lastRequestId.current;
    try {
      const res = await fetch("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: t })
      });
      if (reqId !== lastRequestId.current) return;
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setCreateError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { product: DjiProduct };
      if (reqId !== lastRequestId.current) return;
      // Append al state para que aparezca en el dropdown
      setFetchState((prev) => ({
        ...prev,
        results: [data.product, ...prev.results]
      }));
      selectProduct(data.product);
    } catch (err) {
      if (reqId !== lastRequestId.current) return;
      setCreateError(err instanceof Error ? err.message : "error de red");
    } finally {
      if (reqId === lastRequestId.current) setIsCreating(false);
    }
  }

  function clearSelection() {
    lastCommittedRef.current = null;
    onChange(null);
    setSelectedName(null);
    setQuery("");
    setCreateError(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    const itemsCount =
      fetchState.results.length + (canCreate ? 1 : 0);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(itemsCount - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(-1, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex < 0) return;
      if (activeIndex < fetchState.results.length) {
        selectProduct(fetchState.results[activeIndex]);
      } else if (canCreate) {
        createAndSelect();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </label>
      <div className="relative">
        <FlaskConical
          className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={inputId}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
            setCreateError(null);
            // Si el usuario edita, limpiar selección
            if (selectedName && e.target.value !== selectedName) {
              onChange(null);
              setSelectedName(null);
            }
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="h-9 pl-8 pr-8"
          autoComplete="off"
        />
        {selectedName ? (
          <button
            type="button"
            onClick={clearSelection}
            disabled={disabled}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label="Limpiar selección"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : fetchState.loading ? (
          <Loader2
            className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : null}
      </div>

      {createError ? (
        <p role="alert" className="text-[11px] text-destructive">
          {createError}
        </p>
      ) : null}

      {open && (fetchState.results.length > 0 || canCreate || fetchState.loading) ? (
        <ul
          role="listbox"
          aria-label="Sugerencias de productos"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-md border border-border bg-popover shadow-md"
        >
          {fetchState.results.map((p, i) => {
            const active = i === activeIndex;
            return (
              <li
                key={p.id}
                role="option"
                aria-selected={active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectProduct(p);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0",
                  active && "bg-accent text-accent-foreground"
                )}
              >
                {p.display_color ? (
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: p.display_color }}
                    aria-hidden
                  />
                ) : (
                  <FlaskConical
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {CATEGORY_LABEL[p.category]}
                    {p.active_ingredient ? ` · ${p.active_ingredient}` : ""}
                  </span>
                </div>
                {p.ica_registration ? (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {p.ica_registration}
                  </span>
                ) : null}
              </li>
            );
          })}
          {canCreate ? (
            <li
              role="option"
              aria-selected={activeIndex === fetchState.results.length}
              onMouseDown={(e) => {
                e.preventDefault();
                createAndSelect();
              }}
              onMouseEnter={() =>
                setActiveIndex(fetchState.results.length)
              }
              className={cn(
                "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm",
                activeIndex === fetchState.results.length && "bg-accent text-accent-foreground"
              )}
            >
              {isCreating ? (
                <SpinnerInline className="size-3.5" />
              ) : (
                <Plus className="size-3.5 shrink-0" aria-hidden />
              )}
              <span className="truncate">
                Crear "<strong>{query.trim()}</strong>" como producto nuevo
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
