"use client"

/**
 * InspectorPanel — contenedor ÚNICO del geovisor (2026-09-21).
 *
 * Reemplaza las 3 superficies que había antes (popup MapLibre por fumigación
 * + card de detalle flotante + cajas dinámicas del sidebar) por un solo
 * panel dockeado a la derecha del mapa, con 3 modos:
 *
 *   ┌ Inspector ──────────────────────────────┐
 *   │ [ Contexto ] [ Parcelas ] [ Fumigaciones ]│
 *   ├───────────────────────────────────────────┤
 *   │ Contexto: parcela seleccionada + sus      │
 *   │ fumigaciones (desc) + detalle de una.     │
 *   │ Parcelas/Fumigaciones: listas para        │
 *   │ explorar.                                 │
 *   └───────────────────────────────────────────┘
 *
 * Jerarquía conceptual: PARCELA → FUMIGACIONES → FUMIGACIÓN seleccionada.
 * El mapa ya NO abre popups: solo resalta + centra.
 *
 * Reglas de diseño: `aeroadmin-ui` (§3 map-first, paneles dockeados, un solo
 * scroll owner) + `frontend-production-shadcn` (tokens, densidad, estados).
 */

import { ArrowLeft, ArrowUpRight, Anchor } from "lucide-react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AssignParcelDialog } from "@/components/fumigations/assign-parcel-dialog"
import { fmtDate, fmtDec, fmtInt, fmtLiters, SOURCE_LABEL } from "@/lib/format"
import type { GeovisorPayload } from "@/lib/types"
import { cn } from "@/lib/utils"

type Parcel = GeovisorPayload["parcels"][number]
type Event = GeovisorPayload["events"][number]

export type InspectorTab = "contexto" | "parcelas" | "fumigaciones"

const TABS: { id: InspectorTab; label: string }[] = [
  { id: "contexto", label: "Contexto" },
  { id: "parcelas", label: "Parcelas" },
  { id: "fumigaciones", label: "Fumigaciones" },
]

/** Origen legible de una parcela (DJI = operativo, MYZ = shape agronómico). */
function parcelOrigin(p: Parcel): { short: string; full: string } {
  if (p.source === "dji") return { short: "DJI", full: "Parcelario DJI" }
  if (p.source === "imported") return { short: "MYZ", full: "Shape Suertes_MYZ" }
  return { short: p.source ?? "—", full: "Origen desconocido" }
}

/** Normaliza placeholders del V0 adapter ("Sin asignar") a null. */
function clean(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === "" || s === "Sin asignar" ? null : s
}

export function InspectorPanel({
  tab,
  onTabChange,
  parcels,
  selectedParcelId,
  onSelectParcel,
  events,
  selectedEventId,
  onSelectEvent,
  onClearEvent,
  canAssign,
  counts,
}: {
  tab: InspectorTab
  onTabChange: (t: InspectorTab) => void
  parcels: Parcel[]
  selectedParcelId: string | null
  onSelectParcel: (id: string) => void
  events: Event[]
  selectedEventId: string | null
  onSelectEvent: (id: string) => void
  onClearEvent: () => void
  canAssign: boolean
  counts: { parcels: number; events: number }
}) {
  const selectedParcel = selectedParcelId
    ? parcels.find((p) => p.id === selectedParcelId) ?? null
    : null
  // Las fumigaciones del contexto salen de la lista completa (no de la
  // filtrada por búsqueda) para que el detalle no desaparezca al filtrar.
  const selectedEvent = selectedEventId
    ? events.find((e) => e.id === selectedEventId) ?? null
    : null

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="geovisor-inspector">
      <div className="flex flex-col gap-2.5 border-b border-border bg-card px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Inspector
          </span>
          <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
            {selectedParcel ? selectedParcel.name : `${fmtInt(counts.parcels)} parcelas`}
          </span>
        </div>
        <div
          role="tablist"
          aria-label="Modo del inspector"
          className="flex gap-1 rounded-lg border border-border bg-muted p-[3px]"
        >
          {TABS.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onTabChange(t.id)}
                data-testid={`inspector-tab-${t.id}`}
                className={cn(
                  "flex-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto bg-card">
        {tab === "contexto" ? (
          <ContextView
            parcel={selectedParcel}
            events={events}
            selectedEvent={selectedEvent}
            onSelectEvent={onSelectEvent}
            onClearEvent={onClearEvent}
            canAssign={canAssign}
            onGoToParcels={() => onTabChange("parcelas")}
          />
        ) : tab === "parcelas" ? (
          <ParcelListView
            parcels={parcels}
            selectedParcelId={selectedParcelId}
            onSelectParcel={onSelectParcel}
          />
        ) : (
          <FumigationListView
            events={events}
            selectedEventId={selectedEventId}
            onSelectEvent={onSelectEvent}
          />
        )}
      </div>
    </div>
  )
}

function ContextView({
  parcel,
  events,
  selectedEvent,
  onSelectEvent,
  onClearEvent,
  canAssign,
  onGoToParcels,
}: {
  parcel: Parcel | null
  events: Event[]
  selectedEvent: Event | null
  onSelectEvent: (id: string) => void
  onClearEvent: () => void
  canAssign: boolean
  onGoToParcels: () => void
}) {
  if (!parcel && !selectedEvent) {
    return (
      <div className="px-4 py-10 text-center" data-testid="inspector-empty">
        <p className="text-sm font-semibold">Ninguna parcela seleccionada</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Hacé click en una parcela del mapa para ver su ficha y su historial de
          fumigaciones.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={onGoToParcels}
        >
          Explorar parcelas
        </Button>
      </div>
    )
  }

  if (selectedEvent) {
    return (
      <FumigationDetail
        event={selectedEvent}
        parcel={parcel}
        canAssign={canAssign}
        onBack={onClearEvent}
      />
    )
  }

  const parcelEvents = events.filter((e) => e.parcel_id === parcel?.id)
  return (
    <div>
      {parcel ? <ParcelSummary parcel={parcel} /> : null}
      <div className="flex items-center gap-2 border-y border-border bg-muted/40 px-3 py-2">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
          Fumigaciones
        </span>
        <Badge variant="secondary" className="ml-auto font-mono text-[10px]">
          {fmtInt(parcelEvents.length)}
        </Badge>
      </div>
      {parcelEvents.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          Sin fumigaciones en el rango de fechas seleccionado.
        </p>
      ) : (
        <ul>
          {parcelEvents.map((e) => (
            <li key={e.id}>
              <FumigationRow event={e} selected={false} onSelect={onSelectEvent} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ParcelSummary({ parcel }: { parcel: Parcel }) {
  const origin = parcelOrigin(parcel)
  return (
    <div className="px-3 py-3" data-testid="inspector-parcel-summary">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Parcela seleccionada
      </p>
      <h3 className="mt-0.5 text-base font-bold tracking-tight">{parcel.name}</h3>
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
        {[parcel.farm_name, parcel.municipality]
          .filter((v) => v && v !== "Sin asignar")
          .join(" · ") || "Sin municipio"}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
        <Fact label="Área" value={`${fmtDec(parcel.area_ha)} ha`} mono />
        <Fact label="Fumigaciones" value={fmtInt(parcel.fumigations_count)} mono />
        <Fact label="Variedad" value={clean(parcel.variety)} />
        <Fact label="Cliente" value={clean(parcel.client_name)} />
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className="text-[10px] font-semibold uppercase tracking-wider"
          title={`Origen: ${origin.full}`}
        >
          {origin.short}
        </Badge>
        {parcel.last_fumigation_at ? (
          <Badge variant="secondary" className="text-[10px]">
            {`Últ. fumigación ${fmtDate(parcel.last_fumigation_at)}`}
          </Badge>
        ) : null}
      </div>
      <Button
        render={<Link href={`/parcelas/${parcel.id}`} aria-label="Ver hoja de vida de la parcela" />}
        nativeButton={false}
        variant="outline"
        size="sm"
        className="mt-3 w-full"
      >
        Ver hoja de vida
        <ArrowUpRight className="size-3.5" />
      </Button>
    </div>
  )
}

function Fact({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-[13px] font-semibold", mono && "font-mono tabular-nums")}>
        {value ?? "—"}
      </dd>
    </div>
  )
}

function FumigationRow({
  event,
  selected,
  onSelect,
}: {
  event: Event
  selected: boolean
  onSelect: (id: string) => void
}) {
  const orphan = event.needs_parcel_assignment === true
  return (
    <button
      type="button"
      onClick={() => onSelect(event.id)}
      aria-pressed={selected}
      data-testid={`geovisor-event-${event.id}`}
      className={cn(
        "flex w-full items-start gap-3 border-t border-border px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        selected && "bg-muted"
      )}
    >
      <span className={cn("mt-1 size-2 shrink-0 rounded-full", orphan ? "bg-[#a855f7]" : "bg-[#06b6d4]")} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold">{fmtDate(event.executed_at)}</span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {fmtInt(event.flights_count)} vuelos · {fmtLiters(event.volume_l)}
          {orphan ? " · Sin asignar" : ""}
        </span>
      </span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        {fmtDec(event.area_treated_ha)} ha
      </span>
    </button>
  )
}

function FumigationDetail({
  event,
  parcel,
  canAssign,
  onBack,
}: {
  event: Event
  parcel: Parcel | null
  canAssign: boolean
  onBack: () => void
}) {
  const orphan = event.needs_parcel_assignment === true
  return (
    <div data-testid="inspector-fumigation-detail">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          data-testid="inspector-back"
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Volver a fumigaciones
        </button>
        <span className="ml-auto text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
          Fumigación
        </span>
      </div>
      {parcel ? (
        <p className="px-3 pt-3 text-[11px] text-muted-foreground">
          Parcela: <span className="font-medium text-foreground">{parcel.name}</span>
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-3 py-3 text-xs">
        <Fact label="Fecha" value={fmtDate(event.executed_at)} />
        <Fact label="Área aplicada" value={`${fmtDec(event.area_treated_ha)} ha`} mono />
        <Fact label="Volumen" value={fmtLiters(event.volume_l)} mono />
        <Fact label="Vuelos asociados" value={fmtInt(event.flights_count)} mono />
        <Fact label="Producto" value={clean(event.product)} />
        <Fact label="Operador" value={clean(event.operator)} />
        <Fact label="Dron" value={clean(event.drone_nickname)} />
        <Fact label="Origen" value={SOURCE_LABEL[event.source] ?? event.source} />
      </dl>
      {orphan && event.assignment_note ? (
        <p className="mx-3 mb-3 rounded-md bg-muted p-2 text-[11px] text-muted-foreground">
          {event.assignment_note}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 px-3 pb-4">
        {orphan && canAssign ? (
          <AssignParcelDialog fumigationId={Number(event.id)} note={event.assignment_note} />
        ) : null}
        {parcel ? (
          <Button
            render={
              <Link href={`/parcelas/${parcel.id}`} aria-label="Ver hoja de vida de la parcela" />
            }
            nativeButton={false}
            variant="outline"
            size="sm"
          >
            Ver hoja de vida
          </Button>
        ) : null}
        <Button
          render={
            <Link href={`/fumigaciones/${event.id}`} aria-label="Ver detalle de la fumigación" />
          }
          nativeButton={false}
          variant={orphan ? "outline" : "default"}
          size="sm"
        >
          Ver fumigación
          <ArrowUpRight className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

function ParcelListView({
  parcels,
  selectedParcelId,
  onSelectParcel,
}: {
  parcels: Parcel[]
  selectedParcelId: string | null
  onSelectParcel: (id: string) => void
}) {
  if (parcels.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-xs text-muted-foreground">
        Sin parcelas para la búsqueda.
      </p>
    )
  }
  return (
    <ul>
      {parcels.map((p) => {
        const active = p.id === selectedParcelId
        const isAuto = p.name.startsWith("Auto ")
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onSelectParcel(p.id)}
              aria-pressed={active}
              data-testid={`geovisor-parcel-${p.id}`}
              className={cn(
                "flex w-full items-start gap-3 border-t border-border border-l-2 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                isAuto ? "border-l-[#a855f7]" : "border-l-[#f59e0b]",
                active && "bg-muted"
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{p.name}</span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {[p.farm_name, p.municipality]
                    .filter((v) => v && v !== "Sin asignar")
                    .join(" · ") || "Sin municipio"}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                {fmtDec(p.area_ha)} ha
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function FumigationListView({
  events,
  selectedEventId,
  onSelectEvent,
}: {
  events: Event[]
  selectedEventId: string | null
  onSelectEvent: (id: string) => void
}) {
  if (events.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-xs text-muted-foreground">
        No hay fumigaciones en el rango seleccionado.
      </p>
    )
  }
  return (
    <ul>
      {events.map((e) => (
        <li key={e.id}>
          <FumigationRow
            event={e}
            selected={e.id === selectedEventId}
            onSelect={onSelectEvent}
          />
        </li>
      ))}
    </ul>
  )
}
