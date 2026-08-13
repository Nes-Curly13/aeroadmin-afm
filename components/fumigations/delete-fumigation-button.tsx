"use client";

/**
 * DeleteFumigationButton — botón de soft-delete con confirmación.
 *
 * Sprint 2026-08-13 — feature/fumigacion-detail-v2 / sub-4.
 *
 * Cierra el pedido del operador de poder eliminar fumigaciones
 * (típicamente: registrada por error, o duplicada con un flight
 * scrapeado de DJI). Soft-delete (deleted_at) — la fumigación
 * sigue en la BD para auditoría pero desaparece de listados.
 *
 * UI:
 *   - Botón "Eliminar fumigación" en el header del detail page.
 *   - Click → dialog de confirmación (nativo `confirm()` para no
 *     sumar dependencia de un modal component en este sprint).
 *   - Confirmado → fetch DELETE + redirect a /fumigaciones.
 *   - Si falla → toast/error inline (no redirige).
 *
 * Accesibilidad:
 *   - aria-label explícito con el id (lectores de pantalla leen
 *     "Eliminar fumigación número 123" en vez de solo "Eliminar").
 *   - `confirm()` nativo: los browsers ya lo manejan accesible
 *     (lectores de pantalla lo anuncian, ESC lo cierra).
 *   - Durante el fetch: isPending deshabilita el botón y muestra
 *     spinner inline para que el usuario sepa que está en curso.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SpinnerInline } from "@/components/ui/loading";
import { Trash2 } from "lucide-react";

interface DeleteFumigationButtonProps {
  fumigationId: number;
  /** Label del producto o parcela, para el confirm() — más claro que mostrar solo el id. */
  description: string;
}

export function DeleteFumigationButton({
  fumigationId,
  description
}: DeleteFumigationButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    // Doble check: confirm nativo del browser. Si el operador fumigador
    // se arrepiente, ESC o Cancel lo saca. Listo para reemplazar por un
    // <Dialog> de @base-ui en un sprint futuro si el diseño lo pide.
    const ok = window.confirm(
      `¿Eliminar la fumigación #${fumigationId} (${description})?\n\n` +
        `Esta acción es un soft-delete: la fumigación se marca como borrada ` +
        `y desaparece de los listados, pero queda en la base de datos para ` +
        `auditoría. Para revertirla, contactá a un admin del sistema.`
    );
    if (!ok) return;

    setIsPending(true);
    try {
      const res = await fetch(`/api/admin/fumigations/${fumigationId}`, {
        method: "DELETE"
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
        setIsPending(false);
        return;
      }
      // Éxito: redirigir al listado. router.push + refresh para que la
      // lista re-fetcheé sin la fumigación eliminada.
      router.push("/fumigaciones");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "error de red");
      setIsPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={isPending}
        aria-label={`Eliminar fumigación #${fumigationId} (${description})`}
        className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        {isPending ? (
          <>
            <SpinnerInline />
            Eliminando…
          </>
        ) : (
          <>
            <Trash2 className="size-3.5" aria-hidden />
            Eliminar fumigación
          </>
        )}
      </Button>
      {error ? (
        <p
          role="alert"
          className="text-[10px] font-medium text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
