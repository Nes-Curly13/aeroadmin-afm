"use client"

import type { GeovisorPayload } from "@/lib/types"

type PayloadParcel = GeovisorPayload["parcels"][number]

const TENENCIA: Record<string, string> = {
  PR: "Propia",
  AR: "Arrendada",
  PA: "Aparcería",
  PO: "Posesión",
  CO: "Comodato",
  OT: "Otra"
}

const TOPOGRAFIA: Record<string, string> = {
  PLA: "Plana",
  OND: "Ondulada",
  ONDU: "Ondulada",
  INC: "Inclinada",
  INCLI: "Inclinada",
  QUE: "Quebrada"
}

const NA = "—"

function attr(p: PayloadParcel, key: string): string | null {
  const v = p.shape_attrs?.[key]
  if (v === null || v === undefined || String(v).trim() === "") return null
  return String(v)
}

/** "26/10/2019 12:00?AM" → "26/10/2019" (sin TZ, es texto del shape). */
function shapeDate(v: string | null): string | null {
  if (!v) return null
  const m = v.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[1]}/${m[2]}/${m[3]}` : v
}

/** ISO (YYYY-MM-DD...) → DD/MM/YYYY, cortando el string (sin TZ shift). */
function isoDate(v: string | null): string | null {
  if (!v) return null
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v
}

function num(v: string | null, dec = 2): string | null {
  if (v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(dec).replace(".", ",") : v
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] text-muted-foreground">{label}</div>
      <div className="truncate text-[13px] font-semibold">{value ?? NA}</div>
    </div>
  )
}

export function ParcelPanel({
  parcel,
  onClose
}: {
  parcel: PayloadParcel
  onClose?: () => void
}) {
  const tenenciaRaw = attr(parcel, "TENENCIA")
  const topoRaw = attr(parcel, "Topografia")
  const siembra = isoDate(parcel.planting_date ?? null) ?? shapeDate(attr(parcel, "F.SIEMBRA"))
  const corte = shapeDate(attr(parcel, "F.COSECHA"))

  return (
    <div className="overflow-hidden rounded-xl border border-foreground/10 bg-card text-sm shadow-sm">
      <div className="flex items-start justify-between gap-2 border-b border-foreground/8 p-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{parcel.name}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
            {parcel.farm_name} · {parcel.dji_land_id ?? NA}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            {num(String(parcel.area_ha))} ha
          </span>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar panel de parcela"
              className="rounded-md px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              ×
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 p-3">
        <div>
          <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
            Identificación
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Field label="Variedad" value={parcel.variety} />
            <Field label="Tenencia" value={tenenciaRaw ? (TENENCIA[tenenciaRaw] ?? tenenciaRaw) : null} />
            <Field label="Cliente" value={parcel.client_name} />
            <Field label="Municipio" value={parcel.municipality} />
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
            Agronomía
          </div>
          <div className="grid grid-cols-3 gap-x-3 gap-y-2">
            <Field label="Siembra" value={siembra} />
            <Field label="Últ. corte" value={corte} />
            <Field label="Edad" value={num(attr(parcel, "Edad"))} />
            <Field label="Sacarosa" value={num(attr(parcel, "Sacarosa"))} />
            <Field label="Últ. TCH" value={num(attr(parcel, "ULT.TCH"))} />
            <Field label="Cortes" value={attr(parcel, "NC")} />
            <Field label="Distancia" value={num(attr(parcel, "DISTANCIA"), 1)} />
            <Field label="Topografía" value={topoRaw ? (TOPOGRAFIA[topoRaw] ?? topoRaw) : null} />
            <Field label="Zona agro" value={attr(parcel, "Z.AGRO")} />
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
            Operación
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Field label="Última fumigación" value={isoDate(parcel.last_fumigation_at)} />
            <Field label="Aplicaciones" value={String(parcel.fumigations_count)} />
          </div>
        </div>
      </div>
    </div>
  )
}
