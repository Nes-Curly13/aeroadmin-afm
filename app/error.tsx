"use client";

// app/error.tsx
//
// Auditoría 2026-09-10 (#42): root error boundary. Captura errores no
// manejados en cualquier segmento que no tenga su propio `error.tsx`.
// Es client component (requisito de Next.js App Router).
//
// El root layout sigue renderizando (html/body), así que esta UI se
// muestra dentro del <body>. Para páginas autenticadas existe además
// `app/(auth)/error.tsx`, que renderiza dentro del AppShell (con sidebar).

import { ErrorState } from "@/components/error-state";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="Algo salió mal"
      description="No pudimos cargar esta página. Reintentá; si el problema persiste, avisá al administrador."
      digest={error.digest}
      onRetry={reset}
    />
  );
}
