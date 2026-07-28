import type { Metadata, Viewport } from "next"
import { JetBrains_Mono, Manrope } from "next/font/google"
import { AppShell } from "@/components/app-shell"
import { getHealth } from "@/lib/data"
import "./globals.css"

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
  // Llamamos `getHealth()` en el server component del layout y se lo
  // pasamos a AppShell como prop. Ver docstring en `components/app-shell.tsx`
  // para el por qué de esta indirección.
  const health = await getHealth();
  return (
    <html lang="es" className="bg-background">
      <body className="font-sans antialiased">
        <AppShell health={health}>{children}</AppShell>
      </body>
    </html>
  )
}
