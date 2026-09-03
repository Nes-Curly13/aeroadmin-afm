import type { Metadata, Viewport } from "next"
import { JetBrains_Mono, Manrope } from "next/font/google"
import "./globals.css"

// `force-dynamic` evita que Next intente resolver la query de `getHealth()`
// en build-time (Supabase ENETUNREACH en el runner) y deshabilita el cache
// de la página — necesario para que el sidebar refleje el estado del
// pipeline sin requerir un revalidate explícito.
// Sprint S8.2 (2026-07-29): vemos si mejora el memory leak que tumba el
// dev server después de ~30-40 requests.
export const dynamic = "force-dynamic"

const _manrope = Manrope({ subsets: ["latin"], display: "swap" })
const _mono = JetBrains_Mono({ subsets: ["latin"], display: "swap" })

export const metadata: Metadata = {
  title: "AFM Geovisor | Fumigación de caña con drones",
  description:
    "Geovisor de operaciones de fumigación aérea de caña de azúcar: parcelas, vuelos, cadencia y hoja de vida de cada suerte.",
  generator: "v0.app",
  icons: {
    // v2.7.2 (2026-08-22 — QA): cambiamos el favicon de /afm-logo.svg
    // (57KB, vertical 485x695 con paths SVG complejos) a /afm-logo-mark.svg
    // (1.3KB, horizontal 120x40). El mark usa currentColor así que hereda
    // el color del browser tab. Mucho más rápido de cargar.
    icon: [{ url: "/afm-logo-mark.svg", type: "image/svg+xml" }],
  },
}

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#2f6135",
  width: "device-width",
  initialScale: 1,
}

// S10.5 (2026-09-02) — root layout mínimo. Las páginas autenticadas
// se wrappean con AppShell via `app/(auth)/layout.tsx`; las públicas
// (ej: /login en `app/(public)/`) NO lo heredan. Esto reemplaza el
// workaround de S10.4 (proxy.ts + x-pathname + PUBLIC_PATHS check).
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" className="bg-background">
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
