"use client";

/**
 * InvoicesCard — sección "Facturación" dentro del detail page de
 * una fumigación (`/fumigacion/[id]`).
 *
 * Sprint S7 — feature/s7-schema-extension / Fase 1 / PR-C.
 *
 * Muestra:
 *   - Lista de facturas (o empty state si no hay)
 *   - Botón "Agregar factura" (admin/supervisor only)
 *   - Botón "Cancelar" por factura no-cancelada (admin/supervisor)
 *   - Total facturado (suma de no-canceladas) como subtítulo
 *
 * Al crear o cancelar, hace `router.refresh()` para re-fetchear la
 * page con el nuevo `invoices` aggregate de `getFumigationById`.
 *
 * Decisiones de UX:
 *   - Form de creación inline (no modal) — más simple, menos clicks
 *   - Moneda formateada con `fmtCop` (es-COP locale)
 *   - Factura cancelada: opacity-50 + strikethrough + badge "Cancelada"
 *   - Input monto: number con min=0 step=1000 (fomento de números
 *     "redondos" pero no obligatorio)
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SpinnerInline } from "@/components/ui/loading";
import { Receipt, Plus, X, Ban } from "lucide-react";
import { fmtDate, fmtCop } from "@/lib/format";
import type { FumigationInvoice } from "@/lib/types";

interface InvoicesCardProps {
  fumigationId: number;
  invoices: FumigationInvoice[];
  /** Si false, oculta el form de creación y los botones de cancelar. */
  canEdit: boolean;
}

export function InvoicesCard({ fumigationId, invoices, canEdit }: InvoicesCardProps) {
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  // Total facturado (solo facturas NO canceladas).
  const totalActive = invoices
    .filter((inv) => !inv.cancelled)
    .reduce((acc, inv) => acc + Number(inv.amount_cop), 0);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const fd = new FormData(e.currentTarget);
    const body = {
      invoice_number: String(fd.get("invoice_number") ?? ""),
      invoiced_at: String(fd.get("invoiced_at") ?? ""),
      amount_cop: Number(fd.get("amount_cop") ?? 0)
    };
    try {
      const res = await fetch(
        `/api/admin/fumigations/${fumigationId}/invoices`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setIsAdding(false);
      // Refetch del server component (invoices aggregate ya incluye la nueva).
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "error de red");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onCancel(invoiceId: number) {
    if (!confirm("¿Cancelar esta factura? La acción no se puede deshacer.")) return;
    setError(null);
    setCancellingId(invoiceId);
    try {
      const res = await fetch(
        `/api/admin/fumigations/${fumigationId}/invoices/${invoiceId}`,
        { method: "PATCH" }
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "error de red");
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}

      {invoices.length === 0 && !isAdding ? (
        <p className="px-1 text-xs italic text-muted-foreground">
          Aún no hay facturas registradas para esta fumigación.
        </p>
      ) : null}

      {invoices.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {invoices.map((inv) => (
            <li
              key={inv.id}
              className={`flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs ${
                inv.cancelled ? "opacity-60 line-through" : ""
              }`}
            >
              <div className="flex min-w-0 flex-col">
                <span className="font-mono font-semibold">
                  {inv.invoice_number}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {fmtDate(inv.invoiced_at)} · {fmtCop(Number(inv.amount_cop))}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {inv.cancelled ? (
                  <span
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-destructive"
                    aria-label="Factura cancelada"
                  >
                    Cancelada
                  </span>
                ) : canEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onCancel(inv.id)}
                    disabled={cancellingId === inv.id}
                    aria-label={`Cancelar factura ${inv.invoice_number}`}
                    className="h-6 px-2 text-[10px]"
                  >
                    {cancellingId === inv.id ? (
                      <SpinnerInline />
                    ) : (
                      <Ban className="size-3" aria-hidden />
                    )}
                    Cancelar
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {totalActive > 0 ? (
        <p className="border-t border-border/60 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Total facturado: {fmtCop(totalActive)}
        </p>
      ) : null}

      {canEdit && !isAdding ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsAdding(true)}
          className="self-start"
          aria-label="Agregar factura a esta fumigación"
        >
          <Plus className="size-3.5" aria-hidden />
          Agregar factura
        </Button>
      ) : null}

      {canEdit && isAdding ? (
        <form
          onSubmit={onCreate}
          className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 p-2.5"
          aria-label="Crear factura"
        >
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Número de factura
            </span>
            <Input
              name="invoice_number"
              type="text"
              required
              maxLength={50}
              placeholder="ej. FVE-2051"
              disabled={isSubmitting}
              aria-label="Número de factura"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Fecha
              </span>
              <Input
                name="invoiced_at"
                type="date"
                required
                disabled={isSubmitting}
                aria-label="Fecha de la factura"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Monto (COP)
              </span>
              <Input
                name="amount_cop"
                type="number"
                min="0"
                step="1000"
                required
                disabled={isSubmitting}
                placeholder="ej. 1500000"
                aria-label="Monto en pesos colombianos"
              />
            </label>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsAdding(false);
                setError(null);
              }}
              disabled={isSubmitting}
            >
              <X className="size-3.5" aria-hidden />
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <SpinnerInline />
                  Guardando…
                </>
              ) : (
                <>
                  <Plus className="size-3.5" aria-hidden />
                  Crear factura
                </>
              )}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
