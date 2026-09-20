"use client"

/**
 * AssignParcelDialog — asigna una parcela a una fumigación huérfana
 * (import por-sesión sin match de parcela).
 *
 * 2026-09-20 — ver docs/HANDOFF-2026-09-20.md §3.7.
 *
 * UX:
 *   - Botón "Asignar parcela" → `<dialog>` nativo (focus trap + Esc).
 *   - Búsqueda por texto contra `/api/admin/parcels/search` (debounced).
 *   - Selección → POST `/api/admin/fumigations/[id]/assign-parcel`.
 *   - Link "Crear parcela nueva" → `/admin/parcels/new` (flujo existente).
 *
 * Tras asignar: `onAssigned?()` + `router.refresh()` para refrescar los
 * server components (la lista del geovisor, el detalle).
 */

import { Loader2, MapPin, Plus, Search } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface ParcelOption {
  id: number
  land_name: string | null
  external_id: string
  client_name: string | null
  farm_name: string | null
  municipality: string | null
}

export function AssignParcelDialog({
  fumigationId,
  note,
  label = "Asignar parcela",
  onAssigned,
}: {
  fumigationId: number
  note?: string | null
  label?: string
  onAssigned?: () => void
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [options, setOptions] = useState<ParcelOption[]>([])
  const [searching, setSearching] = useState(false)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (open && !d.open) d.showModal()
    else if (!open && d.open) d.close()
  }, [open])

  // Búsqueda debounced (300 ms) contra el endpoint de parcelas.
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2) {
      setOptions([])
      setSearching(false)
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/parcels/search?q=${encodeURIComponent(q)}&limit=15`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { parcels?: ParcelOption[] }
        setOptions(json.parcels ?? [])
      } catch {
        setOptions([])
        setError("No se pudo buscar parcelas.")
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query, open])

  async function assign(parcelId: number) {
    setSavingId(parcelId)
    setError(null)
    try {
      const res = await fetch(`/api/admin/fumigations/${fumigationId}/assign-parcel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parcel_id: parcelId }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      setOpen(false)
      onAssigned?.()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al asignar")
    } finally {
      setSavingId(null)
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="default"
        onClick={() => setOpen(true)}
        data-testid={`assign-parcel-${fumigationId}`}
      >
        <MapPin className="size-3.5" aria-hidden />
        {label}
      </Button>

      <dialog
        ref={dialogRef}
        aria-label="Asignar parcela"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpen(false)
        }}
        className="m-auto w-[min(92vw,32rem)] rounded-lg border border-border bg-card p-0 text-foreground backdrop:bg-foreground/40"
      >
        <div className="flex flex-col gap-3 p-4">
          <div>
            <h2 className="text-sm font-bold tracking-tight">Asignar parcela</h2>
            {note ? (
              <p className="mt-1 text-xs text-muted-foreground">{note}</p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                Buscá la parcela a la que corresponde esta fumigación.
              </p>
            )}
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar suerte, hacienda, cliente…"
              aria-label="Buscar parcela para asignar"
              autoFocus
              className="pl-8"
            />
          </div>

          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <ul className="max-h-64 overflow-y-auto rounded-md border border-border">
            {searching ? (
              <li className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Buscando…
              </li>
            ) : options.length === 0 ? (
              <li className="p-3 text-xs text-muted-foreground">
                {query.trim().length < 2
                  ? "Escribí al menos 2 caracteres."
                  : "Sin resultados."}
              </li>
            ) : (
              options.map((p) => (
                <li key={p.id} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => assign(p.id)}
                    disabled={savingId !== null}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {p.land_name ?? p.external_id}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[p.farm_name, p.client_name, p.municipality].filter(Boolean).join(" · ") || p.external_id}
                      </span>
                    </span>
                    {savingId === p.id ? (
                      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              render={<Link href="/admin/parcels/new" />}
              nativeButton={false}
              onClick={() => setOpen(false)}
            >
              <Plus className="size-3.5" aria-hidden />
              Crear parcela nueva
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      </dialog>
    </>
  )
}
