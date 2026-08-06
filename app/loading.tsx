// app/loading.tsx
//
// S10 (2026-08-06): root-level loading state. Next.js App Router
// usa este componente automaticamente cuando una page (que no tiene
// su propio <Suspense> boundary) esta cargando. Por ejemplo, en la
// navegacion client-side entre rutas que NO tienen fallback propio.
//
// Patron shadcn: hereda el bg-background del layout, muestra
// PageSpinner centrado. El usuario nunca ve una pantalla en blanco
// durante una navegacion lenta.

import { PageSpinner } from "@/components/ui/loading"

export default function RootLoading() {
  return <PageSpinner message="Cargando…" />
}
