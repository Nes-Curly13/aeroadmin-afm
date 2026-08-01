-- Migration: Add supervisor-editable metadata to dji_parcels
-- Date: 2026-07-22
-- Sprint: "Hoja de vida de parcelas" — auditoría del módulo parcels
--
-- Por qué existe:
--   DJI expone el nombre del lote, dirección, áreas, geometría, parámetros
--   de aspersión, etc. Pero NO expone:
--     - Cultivo / variedad (DJI no sabe qué se cultiva)
--     - Fecha de siembra (el dron no lo sabe)
--     - Propietario / contacto del lote (dato humano)
--     - Notas libres del supervisor sobre el lote
--
--   Estos campos los llena el supervisor manualmente UNA VEZ por parcela
--   y se mantienen persistentes. La "hoja de vida" del lote se construye
--   sobre estos campos + los datos de DJI (que se actualizan en cada sync).
--
-- Decisión de diseño:
--   - Columnas en `dji_parcels` (mismo row que la data DJI). NO tabla
--     separada "parcel_metadata" — agregaría JOINs innecesarios.
--   - Idempotente: ADD COLUMN IF NOT EXISTS.
--   - NULL permitido: parcelas sin completar (la mayoría al inicio).
--   - Constraints suaves (CHECK length, no FKs) — no rompemos la BD si
--     el supervisor no llena todos los campos.
--
-- Distinción con `notes` existente:
--   - `notes` ya existe en la tabla legacy (no en dji_parcels), pero
--     lo prevenido en caso de que se agregue después: `notes` = JSON técnico
--     (provenance), `supervisor_notes` = texto libre del operador.
--   - Mismo patrón que `dji_fumigations.notes` vs `human_notes`.

alter table public.dji_parcels
  add column if not exists crop_type text
  check (crop_type is null or length(crop_type) <= 100);

alter table public.dji_parcels
  add column if not exists planting_date date;

alter table public.dji_parcels
  add column if not exists owner_name text
  check (owner_name is null or length(owner_name) <= 200);

alter table public.dji_parcels
  add column if not exists owner_contact text
  check (owner_contact is null or length(owner_contact) <= 200);

alter table public.dji_parcels
  add column if not exists supervisor_notes text
  check (supervisor_notes is null or length(supervisor_notes) <= 2000);

comment on column public.dji_parcels.crop_type is
  'Cultivo del lote (caña de azúcar, maíz, arroz, etc.). Lo llena el supervisor — DJI no expone el cultivo.';

comment on column public.dji_parcels.planting_date is
  'Fecha de siembra / plantación. Lo llena el supervisor — DJI no expone.';

comment on column public.dji_parcels.owner_name is
  'Nombre del propietario / cañero. Lo llena el supervisor.';

comment on column public.dji_parcels.owner_contact is
  'Contacto del propietario (teléfono, email). Lo llena el supervisor.';

comment on column public.dji_parcels.supervisor_notes is
  'Notas libres del supervisor sobre el lote (contexto, restricciones, acuerdos, etc.). Separada de cualquier metadata técnica.';
