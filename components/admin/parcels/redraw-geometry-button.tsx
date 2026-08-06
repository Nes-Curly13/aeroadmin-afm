"use client";

/**
 * RedrawGeometryButton — UI para que el admin re-dibuje el polígono
 * de una parcela existente.
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding (sub-sprint 2).
 *
 * Cierra el último gap del sub-sprint 1: el endpoint PATCH
 * `/api/admin/parcels/[id]/geometry` ya existía (sub-sprint 1), pero
 * el operador no podía invocarlo desde la UI (solo via curl).
 *
 * Flujo:
 *   1. El admin hace click en "Re-dibujar polígono" (botón en el
 *      detail page de la parcela).
 *   2. Se abre un Dialog de base-ui con:
 *      - ParcelDrawer pre-cargado con la geometría actual
 *        (initialPolygon prop). El operador puede "Limpiar" y dibujar
 *        de nuevo, o dejar la misma forma y solo re-confirmar.
 *      - Textarea obligatorio para `change_reason` (auditoría).
 *      - Botón "Guardar nueva geometría" que hace PATCH.
 *   3. Al success (2xx): banner verde + `router.refresh()` para que
 *      el detail page re-renderice con la nueva `parcel.geom`.
 *   4. Al error (4xx/5xx): banner rojo con el `error` del server.
 *
 * Decisiones:
 *   - **Dialog en vez de inline panel**: la geometría es una acción
 *     destructiva (overwrite) y merece foco + explícito. El mapa
 *     adentro del modal se ve OK a 400px de alto (suficiente para
 *     una parcela).
 *   - **`useState` para isPending, no `useTransition`**: mismo fix
 *     que aplicamos en `NewParcelForm`. `startTransition(async)`
 *     con `await fetch` adentro tiene un bug conocido (next.js
 *     issue #43216) que rompe el flujo. Ver docs de S8.
 *   - **textarea para change_reason**: una sola línea no le da
 *     espacio al operador para explicar bien el por qué. Mismo
 *     patrón que `supervisor_notes` en NewParcelForm.
 *   - **No usamos `useTransition` para la apertura del Dialog**:
 *     el `open` es un useState local, no necesita transición.
 *
 * Testing: este componente es client. El `ParcelDrawer` se mockea
 * (requiere MapLibre real). El test está en
 * `tests/components/admin/parcels/redraw-geometry-button.test.tsx`.
 */

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { SpinnerInline } from "@/components/ui/loading";
import { Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ParcelDrawer } from "./parcel-drawer";

/** Geometría GeoJSON Polygon (lo que recibimos del detail page). */
type PolygonGeom = { type: "Polygon"; coordinates: number[][][] };

export interface RedrawGeometryButtonProps {
  /** ID numérico de la parcela (path param del PATCH). */
  parcelId: number;
  /** Geometría actual de la parcela (se pre-carga en el drawer). */
  currentGeometry: PolygonGeom | null;
}

const REASON_MAX = 500;

export function RedrawGeometryButton({
  parcelId,
  currentGeometry
}: RedrawGeometryButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Geometría actual del drawer (null si el operador limpió o nunca
  // dibujó). Inicializa con currentGeometry para que el botón submit
  // esté habilitado desde el principio si la parcela ya tiene geom.
  const [geometry, setGeometry] = useState<PolygonGeom | null>(
    currentGeometry
  );
  const [changeReason, setChangeReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // useState local para isPending — NO useTransition. Mismo bug que
  // rompía el form de fumigación manual en S8.
  const [isPending, setIsPending] = useState(false);

  function resetFormState() {
    setGeometry(currentGeometry);
    setChangeReason("");
    setError(null);
    setSuccess(false);
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setSuccess(false);

    const reason = changeReason.trim();
    if (!reason) {
      setError("Tenés que escribir un motivo para la auditoría");
      return;
    }
    if (reason.length > REASON_MAX) {
      setError(`El motivo no puede tener más de ${REASON_MAX} caracteres`);
      return;
    }
    if (!geometry) {
      setError(
        "La parcela no tiene geometría para re-dibujar. Limpiá el polígono y dibujá uno nuevo."
      );
      return;
    }

    setIsPending(true);
    try {
      const res = await fetch(`/api/admin/parcels/${parcelId}/geometry`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          geometry,
          change_reason: reason
        })
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(true);
      // Re-fetch del detail page para que parcel.geom se actualice
      // (el drawer pre-cargado del próximo open mostrará la nueva geom).
      router.refresh();
      // Cerramos el dialog después de un breve delay para que el
      // usuario vea el banner verde.
      window.setTimeout(() => {
        setOpen(false);
        resetFormState();
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "error de red");
    } finally {
      setIsPending(false);
    }
  }

  // Caracteres restantes — feedback visual al lado del label.
  const reasonLen = changeReason.length;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Al cerrar (Escape, backdrop, X), limpiamos el form para
        // que la próxima apertura arranque limpia.
        if (!next) resetFormState();
      }}
    >
      <DialogPrimitive.Trigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Re-dibujar polígono de la parcela"
            data-testid="redraw-geometry-trigger"
          >
            <Pencil className="size-3.5" aria-hidden />
            Re-dibujar polígono
          </Button>
        }
      />
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
          data-testid="redraw-geometry-backdrop"
        />
        <DialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <DialogPrimitive.Popup
            className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-xl bg-card p-5 text-card-foreground ring-1 ring-foreground/10"
            aria-label="Re-dibujar polígono de la parcela"
            data-testid="redraw-geometry-popup"
          >
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-4"
              aria-label="Form de re-dibujo de polígono"
              data-testid="redraw-geometry-form"
            >
              <header className="flex items-start justify-between gap-3">
                <div>
                  <DialogPrimitive.Title className="text-base font-semibold">
                    Re-dibujar polígono de la parcela
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">
                    Modificá el polígono si la geometría cargada de DJI es
                    incorrecta. El cambio queda registrado en
                    djiag_audit_log con el motivo que escribas abajo.
                  </DialogPrimitive.Description>
                </div>
                <DialogPrimitive.Close
                  aria-label="Cerrar"
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <X className="size-4" aria-hidden />
                </DialogPrimitive.Close>
              </header>

              {error && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive"
                  data-testid="redraw-geometry-error"
                >
                  {error}
                </p>
              )}
              {success && (
                <p
                  role="status"
                  className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                  data-testid="redraw-geometry-success"
                >
                  Geometría actualizada correctamente.
                </p>
              )}

              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Geometría</h3>
                <p className="text-xs text-muted-foreground">
                  Tocá <em>Limpiar</em> antes de empezar a dibujar de nuevo
                  para borrar la geometría actual.
                </p>
                <ParcelDrawer
                  onPolygonChange={setGeometry}
                  initialPolygon={currentGeometry}
                />
              </section>

              <section className="flex flex-col gap-2">
                <label
                  htmlFor="redraw-geometry-reason"
                  className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  <span>Motivo del cambio (auditoría) *</span>
                  <span
                    className="font-mono text-[10px] tabular-nums"
                    data-testid="redraw-geometry-reason-counter"
                  >
                    {`${reasonLen} / ${REASON_MAX}`}
                  </span>
                </label>
                <textarea
                  id="redraw-geometry-reason"
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  rows={3}
                  maxLength={REASON_MAX}
                  disabled={isPending}
                  placeholder="ej. La geometría de DJI cubre solo la mitad norte del lote; el operador fumigó la totalidad y registró el vuelo con referencia al centroide equivocado."
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
                  aria-label="Motivo del cambio de geometría"
                  aria-required="true"
                  data-testid="redraw-geometry-reason"
                />
              </section>

              <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
                <DialogPrimitive.Close
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                    >
                      Cancelar
                    </Button>
                  }
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={isPending}
                  data-testid="redraw-geometry-submit"
                >
                  {isPending ? (
                    <>
                      <SpinnerInline />
                      Guardando…
                    </>
                  ) : (
                    <>
                      <Pencil className="size-3.5" aria-hidden />
                      Guardar nueva geometría
                    </>
                  )}
                </Button>
              </footer>
            </form>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
