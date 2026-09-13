"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * ErrorState — UI compartida de los React error boundaries (`error.tsx`).
 *
 * Auditoría 2026-09-10 (#42): la app no tenía ningún `error.tsx`. Un throw
 * en un server component caía al error genérico de Next (o al overlay en
 * dev). Este componente da un fallback consistente, en español, con CTA
 * de reintento.
 *
 * Es client component porque el botón "Reintentar" llama al `reset()` que
 * Next inyecta en el `error.tsx` (no es una navegación).
 */
export interface ErrorStateProps {
  title?: string;
  description?: string;
  /** `error.digest` de Next (id para correlacionar con logs del server). */
  digest?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "Algo salió mal",
  description = "No pudimos cargar esta sección. Reintentá; si el problema persiste, avisá al administrador.",
  digest,
  onRetry,
}: ErrorStateProps) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-md gap-0 py-6">
        <CardHeader className="items-center gap-3 px-6 pb-4">
          <div className="grid size-12 place-items-center rounded-lg bg-destructive/10 text-destructive">
            <AlertTriangle className="size-6" aria-hidden />
          </div>
          <div className="flex flex-col items-center gap-1 text-center">
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 px-6">
          {onRetry ? (
            <Button type="button" onClick={onRetry} className="w-full" size="default">
              <RefreshCw className="size-4" aria-hidden />
              Reintentar
            </Button>
          ) : null}
          {digest ? (
            <p className="text-center font-mono text-[10px] text-muted-foreground">
              ref: {digest}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
