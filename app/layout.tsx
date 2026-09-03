import type { Metadata, Viewport } from "next"
import { headers } from "next/headers"
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

// S10.4 (2026-09-02) — paths que NO llevan AppShell (rutas públicas).
// Hoy solo /login. Si en el futuro hay /signup, /forgot-password, etc,
// agregar aca.
const PUBLIC_PATHS = new Set(["/login"]);

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // S10.4: leemos el pathname de los headers (proxy.ts lo setea via
  // `request.headers.set("x-pathname", ...)`). Si el path es publico,
  // NO wrappeamos con AppShell — el operador no debe ver el sidebar
  // mientras esta en /login.
  //
  // Esto es un workaround al bug de Next.js 16 con route groups: la
  // (public)/layout.tsx no es suficiente porque el root layout sigue
  // wrappeando con AppShell (los layouts en route groups son CHILDREN
  // del root, no siblings). Para evitar mover todos los archivos
  // autenticados a un (auth)/ group (refactor grande), usamos un
  // check de pathname aca.
  //
  // Trade-off: si Next.js cambia la convencion de headers, hay que
  // actualizar esto. Alternativa correcta a futuro: mover TODOS los
  // pages autenticados a app/(auth)/ y poner el AppShell en
  // app/(auth)/layout.tsx.
  const hdrs = await headers();
  const pathname = hdrs.get("x-pathname") ?? "";
  const isPublic = PUBLIC_PATHS.has(pathname) || pathname.startsWith("/_next/");

  if (isPublic) {
    return (
      <html lang="es" className="bg-background">
        <body className="font-sans antialiased">{children}</body>
      </html>
    );
  }

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
