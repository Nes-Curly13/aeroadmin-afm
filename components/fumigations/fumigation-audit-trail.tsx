"use client";

/**
 * FumigationAuditTrail — panel de historial de cambios de una fumigación.
 *
 * Sprint 2026-08-15 — feature/fumigation-audit-log / sub-3.
 *
 * Lee la lista de eventos de `fumigation_audit_log` (cargada server-side
 * en el detail page `/fumigacion/[id]`) y los renderiza como una línea
 * de tiempo vertical con icono + color por action.
 *
 * Eventos soportados (4 actions, definidas en el CHECK de la tabla):
 *   - created  → PlusCircle verde     → "Fumigación creada"
 *   - edited   → Pencil azul          → "Fumigación editada" + diff expandible
 *   - deleted  → Trash2 rojo          → "Fumigación eliminada"
 *   - restored → RotateCcw amarillo   → "Fumigación restaurada"
 *
 * Diseño:
 *   - Client component porque tiene estado local (expanded de cada diff).
 *   - No fetch desde el cliente — el padre (server component) le pasa
 *     `events` como prop. Mantiene la regla R1 del proyecto (componentes
 *     no importan `api/repositories`).
 *   - Diff expandible POR EVENTO (cada edit tiene su propio chevron).
 *     Si no hay diff (created/deleted/restore sin contexto), se muestra
 *     un resumen de 1 línea.
 *
 * Accesibilidad:
 *   - Cada item es un `<li>` con `aria-label` que describe el evento
 *     completo ("Fumigación editada por admin@aeroadmin.local, hace 2 horas").
 *   - El botón de expand/collapse tiene `aria-expanded` y `aria-controls`.
 *   - El diff se renderiza con `role="region"` para que sea navegable
 *     por teclado (tab) dentro del section.
 */

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  PlusCircle,
  RotateCcw,
  Trash2
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { FumigationAuditAction, FumigationAuditEvent } from "@/lib/types";

interface FumigationAuditTrailProps {
  events: FumigationAuditEvent[];
}

/**
 * Detecta si un evento de audit fue generado por el script de backfill
 * historico (`scripts/backfill-audit-log.js`). El script marca todos
 * sus inserts con `changes._backfill = true`.
 *
 * Sprint 2026-08-22: 642 fumigaciones historicas fueron backfilleadas
 * con este flag para que la UI pueda mostrar un badge "Reconstruido".
 *
 * NOTA: este helper se define localmente en el componente (no se importa
 * de `@/lib/fumigation-audit`) porque ese modulo importa transitivamente
 * `api/repositories` → `pg`, lo cual rompe el bundle del cliente
 * (Turbopack detecta el uso de `revalidateTag` desde un client component
 * y aborta el build). El helper sigue existiendo en `lib/fumigation-audit.ts`
 * para uso server-side y desde scripts; aca lo duplicamos trivialmente.
 */
function isBackfillEvent(event: FumigationAuditEvent): boolean {
  return event.changes != null && event.changes._backfill === true;
}

interface ActionMeta {
  label: string;
  icon: typeof PlusCircle;
  colorClass: string;
  bgClass: string;
}

const ACTION_META: Record<FumigationAuditAction, ActionMeta> = {
  created: {
    label: "Fumigación creada",
    icon: PlusCircle,
    colorClass: "text-emerald-700 dark:text-emerald-300",
    bgClass: "bg-emerald-500/10 border-emerald-500/40"
  },
  edited: {
    label: "Fumigación editada",
    icon: Pencil,
    colorClass: "text-sky-700 dark:text-sky-300",
    bgClass: "bg-sky-500/10 border-sky-500/40"
  },
  deleted: {
    label: "Fumigación eliminada",
    icon: Trash2,
    colorClass: "text-red-700 dark:text-red-300",
    bgClass: "bg-red-500/10 border-red-500/40"
  },
  restored: {
    label: "Fumigación restaurada",
    icon: RotateCcw,
    colorClass: "text-amber-700 dark:text-amber-300",
    bgClass: "bg-amber-500/10 border-amber-500/40"
  }
};

/**
 * Labels legibles para los campos del diff. Solo los que pueden
 * aparecer en `fumigationAuditDiff` (los editables). El resto se
 * ignoran (no se renderiza nada raro).
 */
const FIELD_LABELS: Record<string, string> = {
  fumigation_date: "Fecha",
  product_used: "Producto",
  dose_l_per_ha: "Dosis",
  area_fumigated_m2: "Área fumigada",
  drone_code_used: "Dron",
  duration_minutes: "Duración",
  notes: "Notas",
  product_registered_ica: "Registro ICA",
  pilot_license: "Licencia piloto",
  category_id: "Categoría"
};

/**
 * Formatea un valor del diff para mostrar al usuario. Maneja:
 *   - null → "—"
 *   - número → string con 2 decimales si tiene parte fraccional
 *   - string vacío → "—"
 *   - fechas YYYY-MM-DD → "DD/MM/YYYY" (Bogota-local, sin shift)
 *   - lo demás → string()
 */
function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" && value.trim() === "") return "—";
  if (field === "fumigation_date" && typeof value === "string") {
    // YYYY-MM-DD → DD/MM/YYYY (no shift, ya viene Bogota-local).
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  if (typeof value === "number") {
    // Sin parte fraccional → integer; sino 2 decimales
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(2);
  }
  return String(value);
}

/**
 * "Hace 2 horas" / "Hace 3 días" / "24/07/2026 03:51" si es > 30 días.
 * La fecha viene del servidor en ISO (UTC). Mostramos siempre en
 * America/Bogota (la TZ del operador) para consistencia con
 * `lib/format.ts#fmtDateTime`.
 *
 * Implementación: usamos `formatToParts` y rebuildeamos el string con
 * separadores ASCII explícitos (`/`, `:`, `, `) en vez de delegar a
 * `date.toLocaleString()`. Esto evita el U+202F (NARROW NO-BREAK
 * SPACE) que `Intl.DateTimeFormat` mete entre la hora y `p. m.` en
 * ICU 73+ — Node y jsdom lo producen distinto, causando React
 * hydration mismatch #418 (el "1 Issue" rojo que se ve en
 * /fumigacion/[id]).
 */
function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffSec < 60) return "hace segundos";
  if (diffMin < 60) return `hace ${diffMin} min`;
  if (diffHour < 24) return `hace ${diffHour} h`;
  if (diffDay < 30) return `hace ${diffDay} d`;
  // > 30 días → fecha absoluta en America/Bogota.
  const dtf = new Intl.DateTimeFormat("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Bogota"
  });
  const parts = dtf.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")}, ${get("hour")}:${get("minute")}`;
}

function DiffSection({ diff }: { diff: Record<string, { from: unknown; to: unknown }> }) {
  const keys = Object.keys(diff);
  if (keys.length === 0) {
    return (
      <p className="text-xs italic text-muted-foreground">
        Sin cambios detectados.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1 pl-1 text-xs">
      {keys.map((k) => {
        const { from, to } = diff[k];
        const label = FIELD_LABELS[k] ?? k;
        return (
          <li key={k} className="flex flex-wrap items-baseline gap-1">
            <span className="font-semibold text-foreground/80">{label}:</span>
            <span className="text-muted-foreground line-through">
              {formatValue(k, from)}
            </span>
            <span aria-hidden="true" className="text-muted-foreground">→</span>
            <span className="font-medium text-foreground">
              {formatValue(k, to)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function SnapshotSection({ snapshot }: { snapshot: Record<string, unknown> }) {
  const keys = Object.keys(snapshot);
  if (keys.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 pl-1 text-xs">
      {keys.map((k) => {
        const label = FIELD_LABELS[k] ?? k;
        const v = snapshot[k];
        if (v === null || v === undefined || v === "") return null;
        return (
          <li key={k} className="flex flex-wrap items-baseline gap-1">
            <span className="font-semibold text-foreground/80">{label}:</span>
            <span className="text-foreground">{formatValue(k, v)}</span>
          </li>
        );
      })}
    </ul>
  );
}

interface AuditEventRowProps {
  event: FumigationAuditEvent;
}

function AuditEventRow({ event }: AuditEventRowProps) {
  const meta = ACTION_META[event.action];
  const Icon = meta.icon;
  // Estado local: diff expandido por defecto? No — colapsado. El usuario
  // puede hacer click para ver. Esto evita que la página renderice mucho
  // HTML si hay muchos edits.
  const [expanded, setExpanded] = useState(false);
  const changes = event.changes;
  const hasDiff = event.action === "edited" && changes.diff != null;
  const hasSnapshot =
    (event.action === "created" || event.action === "deleted") &&
    changes.snapshot != null;
  const hasRestoredFrom = event.action === "restored" && changes.restored_from != null;
  const hasDetails = hasDiff || hasSnapshot || hasRestoredFrom;
  // Sprint 2026-08-22: detectar eventos del backfill historico para
  // mostrar un badge "Reconstruido" al lado del label. Asi el operador
  // puede distinguir eventos reales (cuando el operador hizo click en
  // Guardar) de eventos reconstruidos (cuando corrimos el backfill).
  const isBackfill = isBackfillEvent(event);
  const ariaLabel = `${meta.label}${isBackfill ? " (reconstruido)" : ""} por ${event.actor_email}, ${formatRelative(event.created_at)}`;

  return (
    <li
      className="flex gap-3 border-b border-border/40 pb-3 last:border-b-0 last:pb-0"
      aria-label={ariaLabel}
    >
      <div
        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border ${meta.bgClass}`}
        aria-hidden="true"
      >
        <Icon className={`size-3.5 ${meta.colorClass}`} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`text-sm font-semibold ${meta.colorClass}`}>
              {meta.label}
            </p>
            {isBackfill ? (
              <Badge
                variant="outline"
                className="border-amber-500/60 bg-amber-50 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                title="Reconstruido a partir del estado actual de la BD por el script de backfill. No es un evento registrado cuando el operador hizo click en Guardar."
              >
                Reconstruido
              </Badge>
            ) : null}
          </div>
          <p className="text-[11px] text-muted-foreground" title={event.created_at}>
            {formatRelative(event.created_at)}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Por <span className="font-mono text-foreground/80">{event.actor_email}</span>
        </p>
        {hasDetails ? (
          <div className="mt-1">
            {hasDiff ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                aria-controls={`audit-diff-${event.id}`}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-semibold text-foreground/80 transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {expanded ? (
                  <ChevronDown className="size-3" aria-hidden />
                ) : (
                  <ChevronRight className="size-3" aria-hidden />
                )}
                {`${Object.keys((changes.diff as object) ?? {}).length} campo${
                  Object.keys((changes.diff as object) ?? {}).length === 1 ? "" : "s"
                } cambiado${Object.keys((changes.diff as object) ?? {}).length === 1 ? "" : "s"}`}
              </button>
            ) : null}
            {hasDiff && expanded ? (
              <div
                id={`audit-diff-${event.id}`}
                role="region"
                aria-label="Detalle de cambios"
                className="mt-2 rounded-md border border-border bg-card p-2"
              >
                <DiffSection
                  diff={changes.diff as Record<string, { from: unknown; to: unknown }>}
                />
              </div>
            ) : null}
            {hasSnapshot ? (
              <div
                id={`audit-snapshot-${event.id}`}
                role="region"
                aria-label="Snapshot de la fumigación"
                className="mt-1"
              >
                <SnapshotSection
                  snapshot={changes.snapshot as Record<string, unknown>}
                />
              </div>
            ) : null}
            {hasRestoredFrom ? (
              <p
                id={`audit-restored-${event.id}`}
                className="mt-1 text-xs italic text-muted-foreground"
              >
                {`Restaurada desde ${formatValue(
                  "deleted_at",
                  (changes.restored_from as { deleted_at: unknown }).deleted_at
                )} (borrada por ${(changes.restored_from as { deleted_by: unknown }).deleted_by ?? "desconocido"})`}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function FumigationAuditTrail({ events }: FumigationAuditTrailProps) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col gap-1 px-2 py-3 text-sm text-muted-foreground">
        <p>Sin historial de cambios.</p>
        <p className="text-xs italic">
          Las fumigaciones creadas antes del 2026-08-15 no tienen eventos
          registrados (la tabla de audit log se populó desde este sprint).
        </p>
      </div>
    );
  }
  return (
    <ol
      className="flex flex-col gap-3"
      aria-label={`Historial de la fumigación (${events.length} evento${
        events.length === 1 ? "" : "s"
      })`}
    >
      {events.map((event) => (
        <AuditEventRow key={event.id} event={event} />
      ))}
    </ol>
  );
}
