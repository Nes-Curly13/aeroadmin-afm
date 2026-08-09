// app/not-found.tsx
//
// S10 (2026-08-06): 404 page global. Next.js renderiza este componente
// cuando una ruta no matchea o cuando un server component tira
// notFound(). Diseno consistente con el resto de la UI: logo AFM,
// icono de "no encontrado", link de regreso al panel.
//
// Antes: Next.js usaba su 404 generico ("This page could not be found")
// sin branding. Ahora mostramos un mensaje en espanol y un CTA.

import Link from "next/link"
import { Compass, Home } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-md gap-0 py-6">
        <CardHeader className="items-center gap-3 px-6 pb-4">
          <div className="grid size-12 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Compass className="size-6" aria-hidden />
          </div>
          <div className="flex flex-col items-center gap-1">
            <CardTitle className="text-lg">Página no encontrada</CardTitle>
            <CardDescription>
              La ruta que buscás no existe o fue movida. Verificá la URL
              o volvé al panel principal.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-6">
          <Button
            render={<Link href="/" aria-label="Volver al panel principal" />}
            nativeButton={false}
            className="w-full"
            size="default"
          >
            <Home className="size-4" aria-hidden />
            Volver al panel
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
