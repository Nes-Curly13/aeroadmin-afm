// app/parcels/[id]/timeline/page.tsx
//
// Página de timeline de fumigaciones por parcela (M7 del roadmap).
//
// Decisión arquitectónica (documentada en el commit):
//   Esta page server component llama al repository DIRECTO, NO al
//   endpoint `/api/fumigations/[parcelId]/timeline`. Razón:
//     - La page es server-only (no necesita HTTP round-trip).
//     - El repository es la ÚNICA fuente de verdad para data-access
//       (SDD §3, principio rector: pages + routes nunca divergen).
//     - El endpoint existe para clientes externos (CSV export futuro,
//       widget de dashboard, etc.) — no para pages internas.
//   Si el día de mañana la page necesita compartir lógica con un cliente
//   externo que SÍ pega al endpoint, refactorizamos para extraer un
//   `loadFumigationTimeline(parcelId, from, to)` compartido que
//   internamente use repository + función pura (mismo patrón que ya
//   tiene `getPolygonsInRange` para Task History).
//
// Auth: la page está protegida por el middleware Edge (`proxy.ts`)
// que ya redirige a /login si no hay sesión. No necesitamos un
// `requireAuth()` extra acá (eso lo verifica el middleware a nivel
// de routing). El endpoint SÍ usa `requireAuth()` porque puede ser
// llamado por un cliente sin pasar por el middleware (ej. fetch
// desde un script CLI).

import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ParcelTimeline } from "@/components/fumigations/parcel-timeline";
import { ParcelTimelineControls } from "@/components/fumigations/parcel-timeline-controls";
import {
  getFumigationSchedule,
  getFumigationTimelineForParcel,
  getParcelById
} from "@/api/repositories";
import { buildFumigationTimeline } from "@/lib/fumigation-timeline";
import type { ParcelTimelineMode } from "@/components/fumigations/parcel-timeline";

export const dynamic = "force-dynamic";

const DEFAULT_WINDOW_DAYS = 183; // ~6 meses (mismo default que el endpoint)

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function parseIsoDateOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  return value;
}

function parseMode(value: string | null | undefined): ParcelTimelineMode {
  if (value === "summary") return "summary";
  // "compact" y "detail" se incluyen también; "detail" es el default.
  return "detail";
}

export default async function ParcelTimelinePage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; mode?: string }>;
}) {
  const { id: rawId } = await params;
  const sp = await searchParams;
  const id = Number(rawId);
  if (!Number.isFinite(id) || id < 1) {
    notFound();
  }

  // ---- Resolver rango (URL → default 6 meses) ----
  const to = parseIsoDateOrNull(sp.to) ?? todayIso();
  const from = parseIsoDateOrNull(sp.from) ?? daysAgoIso(DEFAULT_WINDOW_DAYS);
  if (from > to) {
    // El endpoint retorna 400. Acá preferimos clamp silencioso al default
    // en vez de notFound() — el usuario puede arreglarlo desde la URL.
    return notFound();
  }

  const mode = parseMode(sp.mode);

  // ---- Fetch parcel (404 si no existe) ----
  const parcel = await getParcelById(id);
  if (!parcel) {
    notFound();
  }

  // ---- Fetch schedule + eventos en paralelo ----
  const [schedule, events] = await Promise.all([
    getFumigationSchedule(id),
    getFumigationTimelineForParcel(id, from, to)
  ]);

  // ---- Build timeline con la función pura ----
  const timeline = buildFumigationTimeline({
    parcelId: id,
    from,
    to,
    expectedCadenceDays: schedule?.recommended_cadence_days ?? null,
    events
  });

  return (
    <AppShell
      activeSection="map"
      eyebrow={`Parcela #${id}`}
      subtitle={
        parcel.land_name
          ? `Timeline de fumigaciones — ${parcel.land_name}`
          : "Timeline de fumigaciones"
      }
      title={parcel.land_name ?? "Parcela sin nombre"}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <a
            className="rounded-full border border-[#cfd8d3] px-3 py-1.5 text-xs font-semibold text-[#0b5f2d]"
            href={`/parcels/${id}`}
          >
            ← Volver al detalle
          </a>
        </div>

        <ParcelTimeline
          controls={
            <ParcelTimelineControls
              defaultFrom={from}
              defaultMode={mode}
              defaultTo={to}
            />
          }
          mode={mode}
          parcelName={parcel.land_name ?? `Parcela #${id}`}
          timeline={timeline}
        />
      </div>
    </AppShell>
  );
}
