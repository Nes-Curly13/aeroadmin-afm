"use client";

/**
 * NewFumigationPageClient — wizard de alta de fumigación en página
 * completa (no dialog). Sprint 2026-08-05.
 *
 * Layout: 2 columnas en desktop.
 *   - Izquierda (60%): parcel picker (autocomplete) + form
 *   - Derecha (40%): mapa satelital con el polígono de la parcela
 *
 * El mapa usa Sentinel-2 2024 (mismo basemap que /geovisor) — el
 * operador ve claramente la geometría del lote con foto satelital
 * mientras llena el form.
 *
 * Si el page recibe `?parcel=<id>` (e.g. desde un link directo),
 * se autopreselecciona la parcela y se va directo al form.
 *
 * Patrón: useState local para isPending (mismo que el resto de los
 * forms de AFM). NO useTransition con async.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Earth,
  Plus,
  Save,
  Search,
  Sprout
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { FumigationMap } from "@/components/parcels/fumigation-map";
import { ParcelDrawer } from "@/components/admin/parcels/parcel-drawer";
import { RegisterFumigationForm } from "@/components/parcels/register-fumigation-form";
import type { ParcelPickerRow } from "@/api/repositories";

interface NewFumigationPageClientProps {
  initialParcelId: number | null;
  recentParcels: ParcelPickerRow[];
}

type Phase = "pick" | "form";

export function NewFumigationPageClient({
  initialParcelId,
  recentParcels
}: NewFumigationPageClientProps) {
  const [phase, setPhase] = useState<Phase>(initialParcelId ? "form" : "pick");
  const [chosenParcel, setChosenParcel] = useState<ParcelPickerRow | null>(
    initialParcelId
      ? recentParcels.find((p) => p.id === initialParcelId) ?? null
      : null
  );
  const [parcelGeom, setParcelGeom] = useState<
    { type: "Polygon"; coordinates: number[][][] } | null
  >(null);

  // Si tenemos initialParcelId, fetch el parcel completo (geometría).
  useEffect(() => {
    if (!initialParcelId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/parcels/${initialParcelId}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          parcel: { spray_geometry: { type: "Polygon"; coordinates: number[][][] } | null };
        };
        const g = data.parcel.spray_geometry;
        if (
          g &&
          g.type === "Polygon" &&
          Array.isArray(g.coordinates) &&
          g.coordinates.length > 0
        ) {
          setParcelGeom(g);
        }
      } catch {
        // ignorar — sin mapa, pero el form sigue funcionando
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialParcelId]);

  // Cuando el usuario elige una parcela nueva, fetch su geometría.
  async function chooseParcel(p: ParcelPickerRow) {
    setChosenParcel(p);
    setParcelGeom(null);
    setPhase("form");
    try {
      const res = await fetch(`/api/admin/parcels/${p.id}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        parcel: { spray_geometry: { type: "Polygon"; coordinates: number[][][] } | null };
      };
      const g = data.parcel.spray_geometry;
      if (
        g &&
        g.type === "Polygon" &&
        Array.isArray(g.coordinates) &&
        g.coordinates.length > 0
      ) {
        setParcelGeom(g);
      }
    } catch {
      // sin mapa
    }
  }

  function reset() {
    setChosenParcel(null);
    setParcelGeom(null);
    setPhase("pick");
  }

  // Cuando el form de fumigación termina OK, el componente
  // RegisterFumigationForm ya hace router.refresh(). Como acá
  // estamos en una página dedicada, no redirigimos automáticamente
  // (el operador decide). Pero idealmente queremos ir a la ficha
  // de la fumigación recién creada. Para eso, monkey-patching el
  // submit success: el form expone un "onSuccess" opcional.
  // Por ahora, después del submit el operador puede ver la fumigación
  // en /fumigaciones y hacer click en ella.

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {/* Columna izquierda: parcel picker + form */}
      <div className="flex flex-col gap-4 lg:col-span-3">
        {phase === "pick" ? (
          <ParcelPicker
            recentParcels={recentParcels}
            onChoose={chooseParcel}
            onNewParcel={async (geom) => {
              // El operador dibujó una parcela nueva — creamos en
              // /api/admin/parcels y luego seguimos al form.
              setPhase("form");
              const p: ParcelPickerRow = {
                id: 0, // se setea cuando llegue el response
                land_name: "Nueva parcela (dibujada)",
                external_id: "manual-drawn",
                source: "manual",
                client_name: null,
                farm_name: null,
                municipality: null
              };
              setChosenParcel(p);
              setParcelGeom(geom);
              // En este MVP no creamos la parcela automáticamente
              // — el operador primero la crea desde /admin/parcels/new
              // y vuelve acá con la URL ?parcel=<id>.
            }}
          />
        ) : chosenParcel ? (
          <>
            <ParcelSummaryCard
              parcel={chosenParcel}
              onChange={reset}
            />
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Plus className="size-4 text-primary" aria-hidden />
                  Datos de la fumigación
                </CardTitle>
                <CardDescription>
                  Llená los datos. Después de guardar, podés volver al
                  detalle de la fumigación creada para ver el mapa con
                  los vuelos asociados.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Reuso del form existente. El parcelId prop es el de la
                    parcela elegida. Si la parcela todavía no existe (caso
                    "dibujo acá mismo"), el form va a fallar en el POST
                    y el operador tendrá que ir a crearla primero. */}
                <RegisterFumigationForm parcelId={chosenParcel.id || 0} />
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>

      {/* Columna derecha: mapa satelital sticky */}
      <div className="lg:col-span-2">
        <div className="sticky top-20 flex flex-col gap-3">
          <h3 className="text-sm font-semibold">
            Ubicación de la fumigación
          </h3>
          <p className="text-xs text-muted-foreground">
            Sentinel-2 cloudless 2024 (basemap satelital). El polígono
            rojo es la parcela elegida.
          </p>
          <FumigationMap
            parcelGeom={parcelGeom}
            fumigationPoint={null}
            flights={[]}
            className="h-[420px] lg:h-[500px]"
          />
          {chosenParcel ? (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {`Parcela #${chosenParcel.id || "—"}`}
              </p>
              <p className="mt-0.5 font-semibold">
                {chosenParcel.land_name ?? "(sin nombre)"}
              </p>
              {chosenParcel.external_id ? (
                <p className="font-mono text-[10px] text-muted-foreground">
                  {chosenParcel.external_id}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ParcelPicker — autocomplete live + ParcelDrawer
// ============================================================

function ParcelPicker({
  recentParcels,
  onChoose,
  onNewParcel
}: {
  recentParcels: ParcelPickerRow[];
  onChoose: (p: ParcelPickerRow) => void;
  onNewParcel: (geom: { type: "Polygon"; coordinates: number[][][] }) => void;
}) {
  const [query, setQuery] = useState("");
  const [drawerGeom, setDrawerGeom] = useState<{
    type: "Polygon";
    coordinates: number[][][];
  } | null>(null);

  const results = useMemo(() => {
    if (query.trim().length < 1) return [];
    const q = query.toLowerCase();
    return recentParcels
      .filter((p) => {
        const haystack = [
          String(p.id),
          p.land_name ?? "",
          p.external_id,
          p.client_name ?? "",
          p.farm_name ?? "",
          p.municipality ?? ""
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 10);
  }, [query, recentParcels]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sprout className="size-4 text-primary" aria-hidden />
          ¿A qué parcela le vas a registrar la fumigación?
        </CardTitle>
        <CardDescription>
          Buscá por nombre, ID externo, cliente, hacienda o municipio.
          Si la parcela todavía no existe, dibujala en el mapa de la
          derecha y la creamos con el alta manual.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative mb-3">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, ID, cliente, hacienda, municipio…"
            aria-label="Buscar parcela existente"
            className="pl-8"
            autoFocus
          />
        </div>

        {results.length > 0 ? (
          <ul className="overflow-hidden rounded-md border border-border">
            {results.map((p) => (
              <li
                key={p.id}
                className="border-b border-border/60 last:border-0"
              >
                <button
                  type="button"
                  onClick={() => onChoose(p)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                >
                  <div className="flex w-full items-center gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      #{p.id}
                    </span>
                    <span className="font-semibold">
                      {p.land_name ?? "(sin nombre)"}
                    </span>
                    {p.source === "manual" || p.source === "imported" ? (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                        {p.source}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {[p.client_name, p.farm_name, p.municipality]
                      .filter(Boolean)
                      .join(" · ") || p.external_id}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        ) : query.trim().length > 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Sin coincidencias para “{query}”. Si la parcela es nueva,
            dibujala en el mapa de la derecha.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Tipeá para buscar entre las {recentParcels.length} parcelas
            registradas.
          </p>
        )}

        {/* Opción: dibujar nueva parcela */}
        <details className="mt-4 rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
          <summary className="cursor-pointer font-semibold text-foreground">
            <Earth className="mr-1 inline size-3.5" /> ¿La parcela es nueva?
            Dibujala acá
          </summary>
          <div className="mt-3">
            <ParcelDrawer onPolygonChange={setDrawerGeom} />
            {drawerGeom ? (
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  Polígono listo ({drawerGeom.coordinates[0].length - 1} vértices).
                  Nota: en este MVP la parcela nueva se crea desde
                  {` /admin/parcels/new `}y volvés acá con {`?parcel=<id>`}.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onNewParcel(drawerGeom)}
                  disabled
                >
                  <Save className="size-3.5" aria-hidden />
                  Continuar
                </Button>
              </div>
            ) : null}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

// ============================================================
// ParcelSummaryCard — muestra qué parcela está elegida
// ============================================================

function ParcelSummaryCard({
  parcel,
  onChange
}: {
  parcel: ParcelPickerRow;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
      <Sprout className="size-5 shrink-0 text-primary" aria-hidden />
      <div className="flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Fumigando la parcela
        </p>
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
          #{parcel.id || "—"}
        </p>
        <p className="font-semibold text-foreground">
          {parcel.land_name ?? "(sin nombre)"}
        </p>
        {parcel.external_id ? (
          <p className="font-mono text-[10px] text-muted-foreground">
            {parcel.external_id}
          </p>
        ) : null}
      </div>
      <Button variant="ghost" size="sm" onClick={onChange}>
        Cambiar
      </Button>
    </div>
  );
}

// Reuso de Card components
// (imports arriba)

