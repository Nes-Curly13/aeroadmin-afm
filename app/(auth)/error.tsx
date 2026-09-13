"use client";

// app/(auth)/error.tsx
//
// Auditoría 2026-09-10 (#42): error boundary del route group `(auth)`.
// Se renderiza DENTRO de `app/(auth)/layout.tsx`, así que el operador
// conserva la sidebar y la navegación al ver un error — puede cambiar
// de sección sin recargar.
//
// Con `withLocalFallback` en modo estricto (producción), un fallo real
// de BD ahora llega acá en vez de devolver data vacía en silencio.

import { ErrorState } from "@/components/error-state";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="No pudimos cargar esta sección"
      description="Hubo un problema al consultar los datos. Reintentá; si persiste, avisá al administrador."
      digest={error.digest}
      onRetry={reset}
    />
  );
}
