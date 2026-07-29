import type { Metadata, Viewport } from "next"
import { JetBrains_Mono, Manrope } from "next/font/google"
import { AppShell } from "@/components/app-shell"
import { getHealth } from "@/lib/data"
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
    icon: [{ url: "/afm-logo.svg", type: "image/svg+xml" }],
  },
}

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#2f6135",
  width: "device-width",
  initialScale: 1,
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Sprint S8.2 (2026-07-29): ya NO llamamos getHealth() en cada request.
  // El layout corría en TODOS los requests (incluso /login que no necesita
  // health) y eso causaba un leak de ~3MB/request porque el cache layer de
  // Next.js retenía la referencia al dataset.
  //
  // Health ahora se obtiene via `getHealthForRender()` que solo se llama
  // en pages que lo necesitan (futuro). Por ahora, el sidebar de AppShell
  // muestra el status como "unknown" (no fatal — el operador igual puede
  // navegar; la pagina /admin/djiag-health tiene el estado detallado).
  //
  // Si querés el badge "Pipeline DJI AG" en el sidebar, restaurá
  // `getHealth()` acá, pero esperá el dev server a OOM-crashear.
  return (
    <html lang="es" className="bg-background">
      <body className="font-sans antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
