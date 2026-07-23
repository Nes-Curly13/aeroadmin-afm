-- Migration: Add ICA + Aerocivil compliance metadata
-- Date: 2026-07-23
-- Sprint: H2 (Business, M) — compliance / auditoría regulatoria
--
-- Por qué existe:
--   El operador cañero opera bajo regulación colombiana de dos entidades:
--     - ICA (Instituto Colombiano Agropecuario): regula el registro de
--       productos agroquímicos (herbicidas, fungicidas, etc.). Cada
--       producto aplicado debe tener un número de registro ICA visible
--       (formato típico: "ICA-1234-PN", donde PN = Plaguicida Nacional).
--     - Aerocivil (Aeronáutica Civil): regula drones y pilotos. Cada
--       dron tiene una matrícula (formato "HK-1234-UAV" para RPA, o
--       "UAV-..." según resolución) y cada piloto tiene una licencia
--       (formato "PCA-12345" para Piloto Certificado de Aeronave, o
--       "PC-1234567" para Piloto Comercial).
--
--   Sin estos 3 campos:
--     - Auditor ICA: el operador no puede demostrar qué productos
--       aplicó ni con qué registro. Multa potencial.
--     - Auditor Aerocivil: el operador no puede demostrar que el
--       dron/piloto que fumiga está autorizado. Riesgo de suspensión
--       de operaciones.
--
--   Estos 3 campos son el MÍNIMO INDISPENSABLE para cubrir la
--   auditoría. El gap regulatorio completo (libro de operaciones,
--   bitácora de mantenimiento, plan de aplicación firmado por
--   agrónomo, etc.) es scope de otro sprint.
--
-- Decisiones de diseño:
--   - Texto libre, no FK a catálogos. Justificación:
--     * ICA tiene miles de productos registrados, no podemos mantener
--       una tabla sincronizada sin fuente oficial.
--     * Cada producto aplicado puede tener un ICA distinto, y los ICA
--       cambian con el tiempo (renovaciones). Texto libre + regex
--       suave es el patrón estándar para compliance metadata.
--     * Aerocivil matrículas/licencias: una por dron/piloto, no tiene
--       sentido un catálogo compartido.
--   - CHECK constraints suaves (regex laxa). No forzamos el formato
--     exacto porque:
--     * Los formatos pueden cambiar con resoluciones nuevas.
--     * Hay historicos con formatos legacy (ej: "PC12345" sin guión).
--     * La validación exacta puede hacerse en el frontend con
--       helper text.
--   - Columnas NULLables: la mayoría de fumigaciones existentes no
--     tienen estos campos poblados. El operador los va completando
--     progresivamente.
--   - Idempotente: ADD COLUMN IF NOT EXISTS, no rompe si se re-corre.

-- ============================================================
-- 1. dji_fumigations: ICA del producto + licencia del piloto
-- ============================================================
alter table public.dji_fumigations
  add column if not exists product_registered_ica text
  check (product_registered_ica is null or length(product_registered_ica) between 3 and 50);

alter table public.dji_fumigations
  add column if not exists pilot_license text
  check (pilot_license is null or pilot_license ~ '^[A-Z0-9-]{4,20}$');

comment on column public.dji_fumigations.product_registered_ica is
  'Número de registro ICA del producto agroquímico aplicado (formato: "ICA-1234-PN"). Requerido para auditoría ICA. Lo llena el operador fumigador.';

comment on column public.dji_fumigations.pilot_license is
  'Licencia del piloto que operó el dron en esta fumigación (formato Aerocivil: "PCA-12345" o "PC-1234567"). Requerido para auditoría Aerocivil. Lo llena el operador fumigador.';

-- ============================================================
-- 2. dji_drone_models: matrícula del dron (Aerocivil)
-- ============================================================
-- Esta columna NO se edita desde el form de fumigación — es
-- metadata del dron que se setea una vez por dron (admin only).
-- Scope de la task 3 H2: solo AGREGAR la columna. El panel
-- admin para editarla queda para un sprint futuro.
alter table public.dji_drone_models
  add column if not exists registration_number text
  check (registration_number is null or registration_number ~ '^[A-Z0-9-]{3,20}$');

comment on column public.dji_drone_models.registration_number is
  'Matrícula del dron según Aerocivil (formato: "HK-1234-UAV" para RPA). Requerido para auditoría Aerocivil. Lo setea el admin una vez por dron vía SQL.';

-- ============================================================
-- DOWN (manual, para rollback en dev — NO se ejecuta en prod)
-- ============================================================
-- alter table public.dji_fumigations drop column if exists product_registered_ica;
-- alter table public.dji_fumigations drop column if exists pilot_license;
-- alter table public.dji_drone_models drop column if exists registration_number;
