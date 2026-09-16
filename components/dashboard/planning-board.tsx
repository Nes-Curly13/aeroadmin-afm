"use client";

/**
 * PlanningBoard — tablero MANUAL de planificación de fumigaciones
 * (2026-09-15, OE2 rediseño).
 *
 * Reemplaza al `PlanningPanel` (que derivaba pendientes/vencidas
 * automáticamente de `phase_application_rules` y llenaba el dashboard
 * de "vencidas" para toda parcela con ciclo viejo). Acá el operador
 * agenda los planes a mano y el tablero arranca VACÍO.
 *
 * Interacción (client):
 *   - Crear plan (parcela + fecha + categoría/tipo + producto + notas).
 *   - Marcar hecho / cancelar / borrar planes.
 *   - Link "Registrar" al wizard (`/fumigaciones/nueva?parcel=<id>`).
 *
 * Agrupación (misma fuente `plans` ordenada por fecha ASC):
 *   - Vencidas: status=planificada && planned_date < hoy.
 *   - Esta semana: 0..7 días.
 *   - Próximas: > 7 días.
 *   - Hechas: últimas 5 (trazabilidad rápida).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CircleSlash,
  Clock,
  Plus,
  Trash2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldSelect } from "@/components/ui/field-select";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { SpinnerInline } from "@/components/ui/loading";
import { APPLICATION_TYPES, FUMIGATION_CATEGORIES } from "@/lib/data-constants";
import { fmtDate } from "@/lib/format";
import type { FumigationPlan, ParcelPickerRow } from "@/api/repositories";

export interface PlanningBoardProps {
  plans: FumigationPlan[];
  parcels: ParcelPickerRow[];
  /** Fecha de hoy (YYYY-MM-DD, Bogotá) para defaults/etiquetas. */
  today: string;
  /** admin/supervisor pueden crear y gestionar planes. */
  canManage: boolean;
}

const categoryLabel = (slug: string | null) =>
  slug ? FUMIGATION_CATEGORIES.find((c) => c.slug === slug)?.label ?? slug : null;
const typeLabel = (slug: string | null) =>
  slug ? APPLICATION_TYPES.find((t) => t.slug === slug)?.label ?? slug : null;

function relativeLabel(daysUntil: number): string {
  if (daysUntil === 0) return "hoy";
  if (daysUntil > 0) return `en ${daysUntil} d`;
  return `hace ${Math.abs(daysUntil)} d`;
}

function PlanRow({
  plan,
  busy,
  canManage,
  onComplete,
  onCancel,
  onDelete
}: {
  plan: FumigationPlan;
  busy: boolean;
  canManage: boolean;
  onComplete: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const meta = [categoryLabel(plan.category_slug), typeLabel(plan.application_type_slug), plan.product_name]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        <CalendarClock
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="min-w-0">
          <Link
            href={`/parcelas/${plan.parcel_id}`}
            className="block truncate text-sm font-medium hover:text-primary hover:underline"
          >
            {plan.land_name ?? `Parcela #${plan.parcel_id}`}
          </Link>
          <span className="text-[11px] text-muted-foreground">
            {fmtDate(plan.planned_date)} · {relativeLabel(plan.days_until)}
            {plan.client_name ? ` · ${plan.client_name}` : ""}
            {meta ? ` · ${meta}` : ""}
          </span>
          {plan.notes ? (
            <span className="block truncate text-[11px] italic text-muted-foreground/80">
              {plan.notes}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 pl-6 sm:pl-0">
        <Badge
          variant="outline"
          className={
            plan.is_overdue
              ? "text-[10px] border-destructive/40 bg-destructive/5 text-destructive"
              : "text-[10px] border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300"
          }
        >
          {plan.is_overdue ? "Vencida" : "Planificada"}
        </Badge>
        <Link
          href={`/fumigaciones/nueva?parcel=${plan.parcel_id}`}
          className="rounded-md border border-input px-2 py-1 text-[11px] font-medium hover:bg-muted"
        >
          Registrar
        </Link>
        {canManage ? (
          <>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={busy}
              onClick={onComplete}
              aria-label="Marcar como hecha"
              title="Marcar como hecha"
            >
              <Check className="size-3.5" aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={busy}
              onClick={onCancel}
              aria-label="Cancelar plan"
              title="Cancelar plan"
            >
              <CircleSlash className="size-3.5" aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={busy}
              onClick={onDelete}
              aria-label="Borrar plan"
              title="Borrar plan"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}

function Group({
  title,
  icon: Icon,
  items,
  busyId,
  canManage,
  onComplete,
  onCancel,
  onDelete
}: {
  title: string;
  icon: typeof Clock;
  items: FumigationPlan[];
  busyId: number | null;
  canManage: boolean;
  onComplete: (id: number) => void;
  onCancel: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {title}
        <span className="font-mono tabular-nums">({items.length})</span>
      </h4>
      <ul className="flex flex-col divide-y divide-border/40">
        {items.map((p) => (
          <PlanRow
            key={p.id}
            plan={p}
            busy={busyId === p.id}
            canManage={canManage}
            onComplete={() => onComplete(p.id)}
            onCancel={() => onCancel(p.id)}
            onDelete={() => onDelete(p.id)}
          />
        ))}
      </ul>
    </section>
  );
}

export function PlanningBoard({
  plans,
  parcels,
  today,
  canManage
}: PlanningBoardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [parcelId, setParcelId] = useState("");
  const [plannedDate, setPlannedDate] = useState(today);
  const [categoryId, setCategoryId] = useState("");
  const [applicationTypeId, setApplicationTypeId] = useState("");
  const [productName, setProductName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const abiertas = plans.filter((p) => p.status === "planificada");
  const vencidas = abiertas.filter((p) => p.is_overdue);
  const semana = abiertas.filter((p) => !p.is_overdue && p.days_until <= 7);
  const proximas = abiertas.filter((p) => !p.is_overdue && p.days_until > 7);
  const hechas = plans.filter((p) => p.status === "hecha").slice(0, 5);
  const isEmpty = plans.length === 0;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!parcelId) {
      setError("Elegí una parcela.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedDate)) {
      setError("Fecha inválida.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/fumigation-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parcel_id: Number(parcelId),
          planned_date: plannedDate,
          category_id: categoryId ? Number(categoryId) : null,
          application_type_id: applicationTypeId
            ? Number(applicationTypeId)
            : null,
          product_name: productName.trim() || null,
          notes: notes.trim() || null
        })
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setProductName("");
      setNotes("");
      setCategoryId("");
      setApplicationTypeId("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "error de red");
    } finally {
      setPending(false);
    }
  }

  async function patchPlan(id: number, patch: Record<string, unknown>) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/fumigation-plans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (res.ok) router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function removePlan(id: number) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/fumigation-plans/${id}`, {
        method: "DELETE"
      });
      if (res.ok) router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card data-testid="planning-board">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4 text-primary" aria-hidden />
              Planificación de fumigaciones
            </CardTitle>
            <CardDescription>
              Agenda manual. Solo se marca “vencido” lo que agendás vos.
            </CardDescription>
          </div>
          {canManage ? (
            <Button
              type="button"
              size="sm"
              variant={open ? "outline" : "default"}
              onClick={() => {
                setOpen((v) => !v);
                setError(null);
              }}
              data-testid="planning-new-toggle"
            >
              <Plus className="size-3.5" aria-hidden />
              {open ? "Cerrar" : "Nuevo plan"}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {open && canManage ? (
          <form
            onSubmit={handleCreate}
            className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-3"
            data-testid="planning-new-form"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FieldSelect
                label="Parcela *"
                value={parcelId}
                onChange={(e) => setParcelId(e.target.value)}
                disabled={pending}
                data-testid="planning-parcel"
              >
                <option value="">— Elegí una parcela —</option>
                {parcels.map((p) => (
                  <option key={p.id} value={p.id}>
                    {`${p.land_name ?? `Parcela #${p.id}`}${p.client_name ? ` — ${p.client_name}` : ""}`}
                  </option>
                ))}
              </FieldSelect>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Fecha objetivo *
                </span>
                <Input
                  type="date"
                  value={plannedDate}
                  onChange={(e) => setPlannedDate(e.target.value)}
                  disabled={pending}
                  required
                  data-testid="planning-date"
                />
              </label>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FieldSelect
                label="Categoría"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={pending}
                data-testid="planning-category"
              >
                <option value="">— Sin categoría —</option>
                {FUMIGATION_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </FieldSelect>
              <FieldSelect
                label="Tipo de uso"
                value={applicationTypeId}
                onChange={(e) => setApplicationTypeId(e.target.value)}
                disabled={pending}
                data-testid="planning-type"
              >
                <option value="">— Sin tipo —</option>
                {APPLICATION_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </FieldSelect>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Producto
              </span>
              <Input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="ej. Glifosato"
                maxLength={200}
                disabled={pending}
                data-testid="planning-product"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Notas
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={2000}
                disabled={pending}
                placeholder="Contexto del plan…"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
                data-testid="planning-notes"
              />
            </label>
            {error ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive"
                data-testid="planning-error"
              >
                {error}
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? (
                  <>
                    <SpinnerInline />
                    Guardando…
                  </>
                ) : (
                  <>
                    <Plus className="size-3.5" aria-hidden />
                    Agendar plan
                  </>
                )}
              </Button>
            </div>
          </form>
        ) : null}

        {isEmpty ? (
          <p
            className="py-6 text-center text-sm text-muted-foreground"
            data-testid="planning-empty"
          >
            Sin planes agendados. La planificación arranca vacía:
            {canManage ? " usá “Nuevo plan” para agendar el primero." : " nada pendiente."}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <Group
              title="Vencidas"
              icon={AlertTriangle}
              items={vencidas}
              busyId={busyId}
              canManage={canManage}
              onComplete={(id) => patchPlan(id, { status: "hecha" })}
              onCancel={(id) => patchPlan(id, { status: "cancelada" })}
              onDelete={removePlan}
            />
            <Group
              title="Esta semana"
              icon={Clock}
              items={semana}
              busyId={busyId}
              canManage={canManage}
              onComplete={(id) => patchPlan(id, { status: "hecha" })}
              onCancel={(id) => patchPlan(id, { status: "cancelada" })}
              onDelete={removePlan}
            />
            <Group
              title="Próximas"
              icon={CalendarClock}
              items={proximas}
              busyId={busyId}
              canManage={canManage}
              onComplete={(id) => patchPlan(id, { status: "hecha" })}
              onCancel={(id) => patchPlan(id, { status: "cancelada" })}
              onDelete={removePlan}
            />
            {hechas.length > 0 ? (
              <section className="flex flex-col gap-1">
                <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Check className="size-3.5" aria-hidden />
                  Hechas recientes
                </h4>
                <ul className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                  {hechas.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/parcelas/${p.parcel_id}`}
                        className="hover:text-primary hover:underline"
                      >
                        {p.land_name ?? `Parcela #${p.parcel_id}`}
                      </Link>{" "}
                      · {fmtDate(p.planned_date)}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
