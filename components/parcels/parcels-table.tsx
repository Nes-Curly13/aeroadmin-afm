"use client"

import { ArrowUpDown, Search } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { FieldSelect } from "@/components/ui/field-select"
import { Input } from "@/components/ui/input"
import { STATUS_META, droneModel } from "@/lib/data-constants"
import { fmtDate, fmtHa, fmtInt } from "@/lib/format"
import { phaseChipClass, phaseLabel } from "@/lib/crop-cycle"
import type { ComplianceStatus, CyclePhase, ParcelSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

type SortKey = "name" | "area" | "last" | "due" | "events"

interface Row {
  id: string
  name: string
  farm: string
  client: string
  municipality: string
  variety: string
  area: number
  model: string
  cadence: number
  last: string | null
  due: string | null
  daysToDue: number | null
  status: ComplianceStatus
  events: number
  flights: number
  cyclePhase: CyclePhase | null
}

export function ParcelsTable({
  summaries,
  cycleByParcelId
}: {
  summaries: ParcelSummary[]
  /**
   * Sprint 2026-08-01 — fase del cultivo por parcela. Lookup O(1) en el
   * row. Si la parcel no está en el map (no se aplicó la migration o
   * el parcel es muy nuevo), se muestra "Fase: desconocida".
   * Optional para backward compat: si no se pasa, todas las filas
   * muestran "Fase: desconocida".
   */
  cycleByParcelId?: Record<string, CyclePhase | null>
}) {
  const [query, setQuery] = useState("")
  const [client, setClient] = useState("todos")
  const [status, setStatus] = useState("todos")
  const [sort, setSort] = useState<SortKey>("due")
  const [asc, setAsc] = useState(true)

  const rows: Row[] = useMemo(
    () =>
      summaries.map((s) => ({
        id: s.parcel.id,
        name: s.parcel.name,
        farm: s.parcel.farm_name,
        client: s.parcel.client_name,
        municipality: s.parcel.municipality,
        variety: s.parcel.variety,
        area: s.parcel.area_ha,
        model: droneModel(s.parcel.drone_model_id).name,
        cadence: s.schedule.cadence_days,
        last: s.last_fumigation_at,
        due: s.next_due_at,
        daysToDue: s.days_to_due,
        status: s.status,
        events: s.fumigations_count,
        flights: s.flights_count,
        cyclePhase: cycleByParcelId?.[s.parcel.id] ?? null
      })),
    [summaries, cycleByParcelId]
  )

  const clients = useMemo(() => Array.from(new Set(rows.map((r) => r.client))).sort(), [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = rows.filter((r) => {
      if (client !== "todos" && r.client !== client) return false
      if (status !== "todos" && r.status !== status) return false
      if (!q) return true
      return [r.name, r.farm, r.client, r.municipality, r.variety].some((v) => v.toLowerCase().includes(q))
    })
    const dir = asc ? 1 : -1
    return out.sort((a, b) => {
      switch (sort) {
        case "name":
          return a.name.localeCompare(b.name) * dir
        case "area":
          return (a.area - b.area) * dir
        case "events":
          return (a.events - b.events) * dir
        case "last":
          return (a.last ?? "").localeCompare(b.last ?? "") * dir
        default:
          return ((a.daysToDue ?? 9999) - (b.daysToDue ?? 9999)) * dir
      }
    })
  }, [rows, query, client, status, sort, asc])

  function toggleSort(key: SortKey) {
    if (key === sort) setAsc(!asc)
    else {
      setSort(key)
      setAsc(key === "name" || key === "due")
    }
  }

  const Th = ({ label, k, className }: { label: string; k?: SortKey; className?: string }) => (
    <th scope="col" className={cn("px-3 py-2.5 text-left font-semibold", className)}>
      {k ? (
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className="inline-flex items-center gap-1 hover:text-foreground"
          aria-label={`Ordenar por ${label}`}
        >
          {label}
          <ArrowUpDown className={cn("size-3", sort === k ? "text-primary" : "text-muted-foreground/50")} aria-hidden />
        </button>
      ) : (
        label
      )}
    </th>
  )

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar parcela, hacienda, municipio o variedad…"
            aria-label="Buscar parcela"
            className="pl-8"
          />
        </div>
        <FieldSelect
          label="Cliente"
          value={client}
          onChange={(e) => setClient(e.target.value)}
          className="sm:w-48"
        >
          <option value="todos">Todos los clientes</option>
          {clients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </FieldSelect>
        <FieldSelect
          label="Estado"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="sm:w-40"
        >
          <option value="todos">Todos</option>
          {(Object.keys(STATUS_META) as ComplianceStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </FieldSelect>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-b border-border bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <Th label="Parcela" k="name" />
                <Th label="Cliente / Hacienda" />
                <Th label="Área" k="area" className="text-right" />
                <Th label="Cadencia" />
                <Th label="Última" k="last" />
                <Th label="Próxima" k="due" />
                <Th label="Eventos" k="events" className="text-right" />
                <Th label="Estado" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const meta = STATUS_META[r.status]
                return (
                  <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-2.5">
                      <Link href={`/parcelas/${r.id}`} className="font-semibold text-foreground hover:text-primary hover:underline">
                        {r.name}
                      </Link>
                      <p className="font-mono text-[11px] text-muted-foreground">{`${r.variety} · ${r.model}`}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-foreground">{r.client}</p>
                      <p className="text-[11px] text-muted-foreground">{`${r.farm} · ${r.municipality}`}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmtHa(r.area)}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-muted-foreground">{`${r.cadence} d`}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-muted-foreground">{fmtDate(r.last)}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-muted-foreground">{fmtDate(r.due)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {fmtInt(r.events)}
                      <span className="text-muted-foreground">{` / ${fmtInt(r.flights)} v`}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col gap-1">
                        <Badge variant="outline" className="gap-1.5 border-border font-medium">
                          <span className="size-2 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden />
                          {meta.label}
                          {r.daysToDue !== null && (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {r.daysToDue >= 0 ? `+${r.daysToDue}d` : `${r.daysToDue}d`}
                            </span>
                          )}
                        </Badge>
                        {/* Sprint 2026-08-01 — chip de fase de cultivo.
                            Posicionado junto al estado de cadencia porque
                            ambos son "metadata temporal" del parcel. El
                            color sigue la paleta AFM (ver phaseChipClass
                            en lib/crop-cycle.ts). */}
                        <Badge
                          variant="outline"
                          className={cn(
                            "w-fit gap-1 border px-1.5 text-[10px] font-medium",
                            phaseChipClass(r.cyclePhase)
                          )}
                          title={
                            r.cyclePhase
                              ? `Fase del cultivo: ${phaseLabel(r.cyclePhase)}`
                              : "Fase desconocida (faltan planting_date / cycle_phase en dji_parcels)"
                          }
                        >
                          {`Fase: ${phaseLabel(r.cyclePhase)}`}
                        </Badge>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    No hay parcelas que coincidan con los filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="font-mono text-[11px] text-muted-foreground">{`${filtered.length} de ${rows.length} parcelas · dji_parcels ⋈ dji_fumigation_schedule ⋈ dji_fumigations`}</p>
    </section>
  )
}
