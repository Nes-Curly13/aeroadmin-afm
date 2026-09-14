"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Scissors, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * CycleActions — workflow del operador para mantener las fechas del ciclo
 * (MVP fenológico 2026-09-13). Admin-only:
 *   - "Registrar corte"   → cierra el ciclo activo (end_date) + evento harvest.
 *   - "Iniciar nuevo ciclo" → crea un ciclo con start_date (siembra/renovación).
 *
 * Sin esto, la fase se calcula desde `cycles.start_date` y no hay forma
 * de mantenerla. Usa fetch a las APIs de cycles + router.refresh().
 */
export interface CycleActionsProps {
  parcelId: number;
  activeCycleId: number | null;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CycleActions({ parcelId, activeCycleId }: CycleActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [closeDate, setCloseDate] = useState(todayISO());
  const [startDate, setStartDate] = useState(todayISO());

  async function post(url: string, payload: Record<string, unknown>): Promise<void> {
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `HTTP ${res.status}`);
    }
  }

  function onClose() {
    if (!activeCycleId) return;
    startTransition(async () => {
      try {
        await post(`/api/admin/cycles/${activeCycleId}/close`, { end_date: closeDate });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al cerrar el ciclo");
      }
    });
  }

  function onStart() {
    startTransition(async () => {
      try {
        await post("/api/admin/cycles", { parcela_id: parcelId, start_date: startDate });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al crear el ciclo");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {activeCycleId ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Fecha de corte
            <input
              type="date"
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
              disabled={pending}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            />
          </label>
          <Button type="button" size="sm" variant="outline" onClick={onClose} disabled={pending}>
            <Scissors className="size-3.5" aria-hidden />
            Registrar corte
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Fecha de siembra / renovación
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={pending}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            />
          </label>
          <Button type="button" size="sm" variant="outline" onClick={onStart} disabled={pending}>
            <Sprout className="size-3.5" aria-hidden />
            Iniciar nuevo ciclo
          </Button>
        </div>
      )}
    </div>
  );
}
