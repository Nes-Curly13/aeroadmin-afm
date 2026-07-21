-- Migration: Add `human_notes` column to `dji_fumigations`
-- Date: 2026-07-21
-- Sprint: v1.4 / Track C (audit ui-ux-2026-07 #11)
--
-- Por qué existe:
--   El campo `notes` ya existe pero se usa para dos cosas distintas:
--     1. Provenance del backfill (JSON: `{"backfilled_from":"dji_flights",...}`)
--     2. Nota humana del operador fumigador ("se atrasó por lluvia", etc.)
--   Mezclar metadata técnica con user input es un anti-pattern:
--     - Si el operador edita su nota, se pisa la metadata del backfill.
--     - Si el backfill re-corre, pisa la nota humana.
--     - El render ya filtra con `isProvenanceNotes()`, pero eso es UX
--       workaround, no diseño de schema.
--
-- Decisión: columna SEPARADA (`human_notes`). `notes` queda intacta
-- (sigue siendo provenance y nunca se muestra al usuario). El operador
-- puede tipear contexto libre sin riesgo de pisar metadata técnica.
--
-- Constraints:
--   - Idempotente: `ADD COLUMN IF NOT EXISTS`.
--   - CHECK length <= 2000: defensa contra input gigante (alínea con
--     `notes` length validation del POST /api/fumigations y con la
--     convención del repo de 2000 chars para texto libre de operador).
--   - NULL permitido: fumigaciones sin nota humana son válidas (ej. las
--     del backfill automático, donde solo hay provenance en `notes`).

alter table public.dji_fumigations
  add column if not exists human_notes text
  check (human_notes is null or length(human_notes) <= 2000);

comment on column public.dji_fumigations.human_notes is
  'Nota libre del operador fumigador sobre el evento (contexto: lluvia, '
  'problema del equipo, cambio de producto, etc.). Separada de `notes`, '
  'que es provenance del backfill (JSON técnico, no visible al usuario).';
