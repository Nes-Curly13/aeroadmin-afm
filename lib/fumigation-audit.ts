/**
 * lib/fumigation-audit.ts
 *
 * Helpers para registrar eventos en `fumigation_audit_log`. Usados por
 * los 4 endpoints mutadores de fumigaciones:
 *   - POST   /api/admin/fumigations                  → recordCreate
 *   - PATCH  /api/admin/fumigations/[id]             → recordEdit
 *   - DELETE /api/admin/fumigations/[id]             → recordDelete
 *   - POST   /api/admin/fumigations/[id]/restore     → recordRestore
 *
 * Sprint: feature/fumigation-audit-log (2026-08-15) / sub-2.
 *
 * Decisiones de diseño:
 *   - "Fire and forget" para el insert de audit: si la tabla de audit
 *     no existe o la BD se cae entre el op principal y el insert, el
 *     usuario NO ve un 500. La fumigación ya quedó persistida (o ya
 *     fue borrada); el audit log es nice-to-have. Logueamos un warning
 *     a stderr para que un runbook futuro lo detecte.
 *   - "before" vs "after": para PATCH/DELETE/RESTORE comparamos
 *     el row antes y después de la op. Si no cambió (no-op idempotente),
 *     NO insertamos audit — el audit log solo refleja cambios reales.
 *   - "snapshot" vs "diff": para created/deleted guardamos un snapshot
 *     completo (los campos que importan al contexto). Para edited
 *     guardamos solo la diff de los campos que efectivamente cambiaron.
 */

import { insertFumigationAuditEvent } from "@/api/repositories";
import type { DjiFumigationEvent } from "@/lib/types";

/**
 * Campos que se persisten en el snapshot de created/deleted. NO
 * incluye campos derivados (category hidrata via JOIN), ni
 * bookkeeping interno (recorded_at, source, recorded_by — esos
 * son provenance inmutable, no cambian en edit).
 *
 * Coincide con los campos editables de la fumigación + parcel_id
 * (porque en delete es útil saber qué parcela se borró).
 */
export const FUMIGATION_SNAPSHOT_FIELDS = [
  "parcel_id",
  "fumigation_date",
  "product_used",
  // Sprint S9 (2026-08-29) — feature/s9-product-picker-wireup.
  // FK a products.id. Se incluye en el snapshot para que el audit log
  // de delete muestre qué producto del catálogo estaba asociado.
  "product_id",
  "dose_l_per_ha",
  "area_fumigated_m2",
  "drone_code_used",
  "duration_minutes",
  "notes",
  "product_registered_ica",
  "pilot_license",
  "category_id",
  /**
   * Sprint S7 — feature/s7-schema-extension. application_type_id
   * es editable (el operador puede re-clasificar la fase de uso
   * sin cambiar el producto). Se incluye en snapshot para que
   * el audit log de delete muestre qué fase tenía la fumigación
   * al momento de borrarla.
   */
  "application_type_id"
] as const;

/**
 * Campos que SÍ pueden aparecer en una diff de edit. NO incluye
 * parcel_id (inmutable) ni source/recorded_by/flight_ids/recorded_at/
 * deleted_at/deleted_by (inmutables o solo cambian via DELETE/restore).
 */
export const FUMIGATION_EDITABLE_FIELDS = [
  "fumigation_date",
  "product_used",
  // Sprint S9 (2026-08-29) — product_id editable (mismo patrón que
  // vehicle_plate). Si el operador re-selecciona un producto distinto
  // del catálogo, la diff lo captura.
  "product_id",
  "dose_l_per_ha",
  "area_fumigated_m2",
  "drone_code_used",
  "duration_minutes",
  "notes",
  "product_registered_ica",
  "pilot_license",
  "category_id",
  /**
   * Sprint S7 — application_type_id es editable (ortogonal a
   * category_id). Si solo cambia este campo, la diff lo captura.
   */
  "application_type_id"
] as const;

/**
 * Snapshot del estado actual de la fumigación (para created/deleted).
 * Devuelve un objeto plano con nulls en lugar de undefined (jsonb
 * de BD trata null y missing como cosas distintas, mejor ser explícito).
 */
export function fumigationAuditSnapshot(
  fumigation: DjiFumigationEvent
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FUMIGATION_SNAPSHOT_FIELDS) {
    const v = (fumigation as unknown as Record<string, unknown>)[f];
    out[f] = v === undefined ? null : v;
  }
  return out;
}

/**
 * Computa la diff entre before y after SOLO sobre los campos editables.
 * Devuelve `{}` si no hay cambios. El shape por campo es:
 *   { from: <valor anterior o null>, to: <valor nuevo o null> }
 */
export function fumigationAuditDiff(
  before: Partial<DjiFumigationEvent>,
  after: Partial<DjiFumigationEvent>
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of FUMIGATION_EDITABLE_FIELDS) {
    const fromVal = (before as Record<string, unknown>)[f];
    const toVal = (after as Record<string, unknown>)[f];
    // Normalizar undefined a null para la comparación (jsonb-friendly).
    const fromNorm = fromVal === undefined ? null : fromVal;
    const toNorm = toVal === undefined ? null : toVal;
    if (fromNorm !== toNorm) {
      out[f] = { from: fromNorm, to: toNorm };
    }
  }
  return out;
}

/**
 * Wrapper "fire and forget" del insert. Loguea warning si falla
 * pero NO propaga el error — la fumigación ya fue persistida y
 * el usuario merece un 200. Si el caller quiere un insert estricto
 * (ej. desde scripts CLI), puede llamar `insertFumigationAuditEvent`
 * directamente.
 */
async function safeAuditInsert(
  event: Parameters<typeof insertFumigationAuditEvent>[0]
): Promise<void> {
  try {
    await insertFumigationAuditEvent(event);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[fumigation-audit] failed to record ${event.action} for fumigation_id=${event.fumigation_id} (no-op, la fumigación ya quedó persistida):`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Registra la creación de una fumigación. Idempotente en la BD pero
 * cada llamada SIEMPRE inserta (un create es siempre un create real).
 */
export function recordFumigationCreate(
  fumigation: DjiFumigationEvent,
  actorEmail: string
): Promise<void> {
  return safeAuditInsert({
    fumigation_id: fumigation.id,
    action: "created",
    actor_email: actorEmail,
    changes: { fields: fumigationAuditSnapshot(fumigation) }
  });
}

/**
 * Registra la edición de una fumigación. NO inserta si la diff es
 * vacía (caller mandó un patch pero ningún campo cambió). Devuelve
 * `true` si se insertó, `false` si fue no-op.
 */
export async function recordFumigationEdit(
  before: DjiFumigationEvent,
  after: DjiFumigationEvent,
  actorEmail: string
): Promise<boolean> {
  const d = fumigationAuditDiff(before, after);
  if (Object.keys(d).length === 0) return false;
  await safeAuditInsert({
    fumigation_id: after.id,
    action: "edited",
    actor_email: actorEmail,
    changes: { diff: d }
  });
  return true;
}

/**
 * Registra un soft-delete. NO inserta si la fumigación YA estaba
 * soft-deleted antes de la llamada (idempotencia del endpoint DELETE).
 */
export async function recordFumigationDelete(
  before: DjiFumigationEvent,
  after: DjiFumigationEvent,
  actorEmail: string
): Promise<boolean> {
  // Solo registrar si la op realmente borró (no idempotente).
  if (before.deleted_at == null && after.deleted_at != null) {
    await safeAuditInsert({
      fumigation_id: after.id,
      action: "deleted",
      actor_email: actorEmail,
      changes: { snapshot: fumigationAuditSnapshot(after) }
    });
    return true;
  }
  return false;
}

/**
 * Registra un restore. NO inserta si la fumigación NO estaba
 * soft-deleted antes de la llamada (idempotencia del endpoint restore).
 */
export async function recordFumigationRestore(
  before: DjiFumigationEvent,
  after: DjiFumigationEvent,
  actorEmail: string
): Promise<boolean> {
  // Solo registrar si la op realmente restauró.
  if (before.deleted_at != null && after.deleted_at == null) {
    await safeAuditInsert({
      fumigation_id: after.id,
      action: "restored",
      actor_email: actorEmail,
      changes: {
        restored_from: {
          deleted_at: before.deleted_at,
          deleted_by: before.deleted_by
        }
      }
    });
    return true;
  }
  return false;
}

/**
 * Detecta si un evento de audit fue generado por el script de backfill
 * historico (`scripts/backfill-audit-log.js`). El script marca todos sus
 * inserts con `changes._backfill = true` para que la UI pueda diferenciar
 * "este evento fue reconstruido a partir del estado actual de la BD"
 * de "este evento fue registrado cuando el operador hizo click en
 * Guardar".
 *
 * Sprint 2026-08-22: 642 fumigaciones historicas (610 con `recorded_by
 * NULL` + 30 con `'djiag-import'` + 2 manuales) fueron backfilleadas.
 * Sin este helper, el operador ve 642 eventos `created` indistinguibles
 * de los que vienen de la UI. Con el helper, mostramos un badge
 * "Reconstruido" en la card "Historial".
 *
 * Usado en: `components/fumigations/fumigation-audit-trail.tsx`.
 *
 * @param event - Evento de audit (de la API o de un test fixture)
 * @returns true si el evento fue generado por el backfill
 */
export function isBackfillEvent(event: {
  changes: Record<string, unknown> | null;
}): boolean {
  return event.changes != null && event.changes._backfill === true;
}
