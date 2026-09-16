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
    // v3.0 (2026-09-15): favicon = emblema cuadrado (badge con
    // gradiente de marca + hoja de caña). Antes era el mark horizontal
    // 120x40 (se veía apretado en el tab). El emblema no usa
    // currentColor → color consistente en cualquier tema del browser.
    icon: [{ url: "/afm-emblem.svg", type: "image/svg+xml" }],
  },
}

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#3f8f5d",
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
