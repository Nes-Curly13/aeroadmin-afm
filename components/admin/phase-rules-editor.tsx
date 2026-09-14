"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PhaseApplicationRule } from "@/lib/phase-applications";

/**
 * PhaseRulesEditor — control admin de las reglas de aplicación por fase
 * (data-driven, MVP fenológico). Permite editar ventana/cadencia/
 * obligatoriedad, agregar y borrar reglas, y restaurar los recomendados.
 */
export interface PhaseRulesEditorProps {
  initialRules: PhaseApplicationRule[];
}

const PHASES = ["establecimiento", "vegetativa", "madurante", "cosecha"] as const;
// UI-16: labels en espanol para los <option>. Antes el value era
// el slug crudo ("establecimiento", "herbicida"), legible solo para
// el dev. El operador fumigador necesita "Establecimiento", "Herbicida",
// etc.
const PHASE_LABELS: Record<(typeof PHASES)[number], string> = {
  establecimiento: "Establecimiento",
  vegetativa: "Vegetativa",
  madurante: "Madurante",
  cosecha: "Cosecha"
};
const CATEGORIES = [
  "herbicida",
  "insecticida",
  "fungicida",
  "fertilizante",
  "acaricida",
  "nematicida",
  "otro"
] as const;
const CATEGORY_LABELS: Record<(typeof CATEGORIES)[number], string> = {
  herbicida: "Herbicida",
  insecticida: "Insecticida",
  fungicida: "Fungicida",
  fertilizante: "Fertilizante",
  acaricida: "Acaricida",
  nematicida: "Nematicida",
  otro: "Otro"
};
const TYPES = ["", "pre_emergente", "post_emergente", "bioestimulante", "madurante", "otro"] as const;
const TYPE_LABELS: Record<(typeof TYPES)[number], string> = {
  "": "Sin tipo",
  pre_emergente: "Pre-emergente",
  post_emergente: "Post-emergente",
  bioestimulante: "Bioestimulante",
  madurante: "Madurante",
  otro: "Otro"
};

type Draft = PhaseApplicationRule & { isNew?: boolean };

export function PhaseRulesEditor({ initialRules }: PhaseRulesEditorProps) {
  const router = useRouter();
  const [rules, setRules] = useState<Draft[]>(initialRules);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  function patchLocal(id: number, patch: Partial<Draft>) {
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function api(url: string, method: string, body?: unknown): Promise<void> {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `HTTP ${res.status}`);
    }
  }

  function onSave(rule: Draft) {
    startTransition(async () => {
      setError(null);
      try {
        if (rule.isNew) {
          await api("/api/admin/phase-application-rules", "POST", {
            crop_type: rule.crop_type,
            phase: rule.phase,
            category_slug: rule.category_slug,
            application_type_slug: rule.application_type_slug,
            cadence_days: rule.cadence_days,
            window_from_day: rule.window_from_day,
            window_to_day: rule.window_to_day,
            is_required: rule.is_required,
            notes: rule.notes
          });
        } else {
          await api(`/api/admin/phase-application-rules/${rule.id}`, "PATCH", {
            phase: rule.phase,
            category_slug: rule.category_slug,
            application_type_slug: rule.application_type_slug,
            cadence_days: rule.cadence_days,
            window_from_day: rule.window_from_day,
            window_to_day: rule.window_to_day,
            is_required: rule.is_required,
            notes: rule.notes
          });
        }
        setSavedId(rule.id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al guardar");
      }
    });
  }

  function onDelete(id: number) {
    // UI-16: confirm antes de borrar (accion destructiva).
    if (!window.confirm("¿Eliminar esta regla? Esta accion no se puede deshacer.")) {
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        await api(`/api/admin/phase-application-rules/${id}`, "DELETE");
        setRules((rs) => rs.filter((r) => r.id !== id));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al borrar");
      }
    });
  }

  function onReset() {
    startTransition(async () => {
      setError(null);
      try {
        await api("/api/admin/phase-application-rules/reset", "POST", { crop_type: "cana" });
        // UI-16: router.refresh() en vez de window.location.reload()
        // (mas rapido, mantiene el state del cliente, sin parpadeo).
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al restaurar");
      }
    });
  }

  function onAdd() {
    const draft: Draft = {
      id: -Date.now(),
      crop_type: "cana",
      phase: "establecimiento",
      category_slug: "insecticida",
      application_type_slug: null,
      cadence_days: null,
      window_from_day: 0,
      window_to_day: 30,
      is_required: true,
      notes: null,
      isNew: true
    };
    setRules((rs) => [...rs, draft]);
  }

  const inputCls =
    "h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Reglas de aplicación por fase</CardTitle>
            <CardDescription>
              Valores recomendados para caña. El admin puede ajustarlos; se aplican a
              la planificación del dashboard y a la ficha de cada parcela.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onAdd} disabled={pending}>
              <Plus className="size-3.5" aria-hidden />
              Agregar
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onReset} disabled={pending}>
              <RotateCcw className="size-3.5" aria-hidden />
              Restaurar recomendados
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-left font-semibold">Fase</th>
                <th className="px-2 py-2 text-left font-semibold">Categoría</th>
                <th className="px-2 py-2 text-left font-semibold">Tipo</th>
                <th className="px-2 py-2 text-right font-semibold">Desde (d)</th>
                <th className="px-2 py-2 text-right font-semibold">Hasta (d)</th>
                <th className="px-2 py-2 text-right font-semibold">Cadencia (d)</th>
                <th className="px-2 py-2 text-center font-semibold">Obligatoria</th>
                <th className="px-2 py-2 text-left font-semibold">Notas</th>
                <th className="px-2 py-2 text-right font-semibold">Acción</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b border-border/40">
                  <td className="px-2 py-1.5">
                    <select
                      value={r.phase}
                      onChange={(e) => patchLocal(r.id, { phase: e.target.value })}
                      disabled={pending}
                      className={inputCls}
                      aria-label="Fase"
                    >
                      {PHASES.map((p) => (
                        // UI-16: value = slug (backend), label = espanol legible
                        <option key={p} value={p}>
                          {PHASE_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={r.category_slug}
                      onChange={(e) => patchLocal(r.id, { category_slug: e.target.value })}
                      disabled={pending}
                      className={inputCls}
                      aria-label="Categoría"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={r.application_type_slug ?? ""}
                      onChange={(e) =>
                        patchLocal(r.id, { application_type_slug: e.target.value || null })
                      }
                      disabled={pending}
                      className={inputCls}
                      aria-label="Tipo de uso"
                    >
                      {TYPES.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      type="number"
                      min={0}
                      value={r.window_from_day}
                      onChange={(e) => patchLocal(r.id, { window_from_day: Number(e.target.value) })}
                      disabled={pending}
                      className={`${inputCls} w-20 text-right`}
                      aria-label="Ventana desde"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      type="number"
                      min={0}
                      value={r.window_to_day}
                      onChange={(e) => patchLocal(r.id, { window_to_day: Number(e.target.value) })}
                      disabled={pending}
                      className={`${inputCls} w-20 text-right`}
                      aria-label="Ventana hasta"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      type="number"
                      min={1}
                      value={r.cadence_days ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        patchLocal(r.id, {
                          cadence_days: e.target.value === "" ? null : Number(e.target.value)
                        })
                      }
                      disabled={pending}
                      className={`${inputCls} w-20 text-right`}
                      aria-label="Cadencia días"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={r.is_required}
                      onChange={(e) => patchLocal(r.id, { is_required: e.target.checked })}
                      disabled={pending}
                      aria-label="Obligatoria"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      value={r.notes ?? ""}
                      onChange={(e) => patchLocal(r.id, { notes: e.target.value || null })}
                      disabled={pending}
                      className={`${inputCls} w-full`}
                      aria-label="Notas"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center justify-end gap-1">
                      {savedId === r.id ? (
                        <span className="text-[10px] text-chart-1">Guardado</span>
                      ) : null}
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => onSave(r)}
                        disabled={pending}
                        aria-label="Guardar"
                      >
                        <Save className="size-3" aria-hidden />
                      </Button>
                      {!r.isNew ? (
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => onDelete(r.id)}
                          disabled={pending}
                          aria-label="Eliminar"
                        >
                          <Trash2 className="size-3 text-destructive" aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
