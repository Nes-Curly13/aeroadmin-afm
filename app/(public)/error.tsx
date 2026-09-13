"use client";

// app/(public)/error.tsx
//
// Auditoría / NT-03: error boundary del route group `(public)`. Antes,
// un error en `/login` caía al root `app/error.tsx` (sin el fondo de
// marca). Este boundary mantiene la identidad visual del login.

import { ErrorState } from "@/components/error-state";

export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="No pudimos cargar la página"
      description="Ocurrió un problema inesperado. Reintentá; si persiste, avisá al administrador."
      digest={error.digest}
      onRetry={reset}
    />
  );
}
