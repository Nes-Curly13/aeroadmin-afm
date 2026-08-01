-- Migration: Add djiag_health table for serverless health tracking
-- Date: 2026-07-24
-- Sprint: E (Production-ready) — Task 2
--
-- Por qué existe:
--   Hasta Sprint D, la fuente de verdad del health del pipeline DJI AG
--   era el archivo `djiag_exports/_health.json` en el filesystem. Eso
--   funciona en dev/CI pero NO en Vercel serverless: el filesystem es
--   **ephemeral** y se borra entre deploys (y entre cold starts de la
--   misma lambda). El endpoint `GET /api/admin/djiag-health` siempre
--   devolvería `status='unknown'` en producción.
--
--   Solución: mover la fuente de verdad a una tabla Postgres con
--   1 sola fila (id=1) que se actualiza al final de cada corrida del
--   pipeline. El filesystem sigue siendo el path en dev local
--   (backwards compat con el script `scripts/run-pipeline.js` que ya
--   escribe el JSON; ahora también escribe a la tabla).
--
-- Decisiones de diseño:
--   - **Singleton row (id=1 con CHECK).** No queremos histórico de
--     corridas — solo la última. Un historial se podría implementar
--     con una tabla `djiag_health_runs` aparte, pero no es scope de
--     esta task (la UI del admin muestra "última corrida", no
--     histórico).
--   - **UPSERT (`ON CONFLICT DO UPDATE`).** El pipeline usa
--     `INSERT ... ON CONFLICT (id) DO UPDATE` para que la fila se
--     actualice en cada corrida. Si la fila no existe, se crea; si
--     existe, se reemplaza.
--   - **JSONB para `steps`.** Los steps son una lista heterogénea
--     (cada step tiene order, name, status, durationMs, error). JSONB
--     evita un JOIN con otra tabla y permite queries con operadores
--     jsonb si en el futuro queremos filtrar "todas las corridas
--     que tuvieron un step de 'scrape' fallido".
--   - **No FK a otras tablas.** Es metadata operacional, no
--     datos del cliente. La tabla es independiente del schema
--     de parcelas/fumigaciones.
--   - **Sin RLS.** Esta tabla solo la lee el endpoint admin
--     (que ya gatea por `requireRole('admin')` o bypass
--     `HEALTH_TOKEN`) y solo la escribe el script del pipeline
--     (que usa la service role key de Supabase o la `DATABASE_URL`
--     directa). No hay acceso desde el cliente.

-- ============================================================
-- Tabla: djiag_health (singleton, id=1)
-- ============================================================
create table if not exists public.djiag_health (
  -- Singleton: solo puede existir la fila id=1. El CHECK es
  -- defensivo — el UPSERT usa `id = 1` siempre, pero si alguien
  -- intenta INSERTar id=2, el CHECK lo bloquea.
  id int primary key default 1 check (id = 1),

  -- Última corrida (exitosa o no). En el JSON del filesystem se
  -- llama "lastRunAt"; acá lo partimos en 2 campos para que el
  -- ORDER BY y los filtros en SQL sean directos (vs. parsear el
  -- JSONB en cada query).
  last_run_at timestamptz null,
  -- 'ok' = todos los steps OK.
  -- 'partial' = algunos steps OK, otros fallaron.
  -- 'failed' = el primer step falló (no se ejecutó nada).
  -- 'unknown' = nunca se ejecutó el pipeline (fila recién creada
  -- o migration aplicada sin que el pipeline haya corrido).
  last_run_status text null
    check (last_run_status is null
        or last_run_status in ('ok', 'partial', 'failed', 'unknown')),

  -- Última corrida EXITOSA. Si la última corrida fue 'partial' o
  -- 'failed', este campo se preserva del valor anterior (no se
  -- actualiza) — es lo que el frontend usa para calcular
  -- "hoursSinceLastSync" y mostrar el SyncBanner.
  last_successful_sync_at timestamptz null,

  -- Contadores del último sync exitoso (no de la última corrida).
  -- Si la última corrida fue 'partial', estos NO se actualizan
  -- (preservan los del último 'ok').
  flights_count int null check (flights_count is null or flights_count >= 0),
  fumigations_count int null check (fumigations_count is null or fumigations_count >= 0),
  lands_count int null check (lands_count is null or lands_count >= 0),

  -- Steps de la última corrida (no del último sync exitoso). Esto
  -- es útil para debugging: si la última fue 'partial', queremos
  -- ver QUÉ step falló, no los steps de la última exitosa.
  steps jsonb null,

  -- Timestamp de la última escritura a esta fila. Útil para
  -- debugging ("¿cuándo se actualizó por última vez?") y para
  -- detectar rows zombies (si updated_at es muy viejo y la fila
  -- no debería estar fresca).
  updated_at timestamptz not null default now()
);

comment on table public.djiag_health is
  'Health del pipeline DJI AG. Singleton row (id=1). Escrito por scripts/run-pipeline.js al final de cada corrida. Leído por GET /api/admin/djiag-health.';

comment on column public.djiag_health.id is
  'Primary key. Forzado a 1 (CHECK) para garantizar singleton row. La fila es la ÚNICA source of truth del health.';

comment on column public.djiag_health.last_run_at is
  'Timestamp ISO de la última corrida del pipeline (exitosa o no). Null si nunca corrió.';

comment on column public.djiag_health.last_run_status is
  'Status de la última corrida. ok=todo OK, partial=algunos steps fallaron, failed=primer step falló, unknown=nunca corrió.';

comment on column public.djiag_health.last_successful_sync_at is
  'Timestamp ISO de la última corrida EXITOSA. Se preserva del valor anterior si la última corrida fue partial/failed. Null si nunca hubo una corrida exitosa.';

comment on column public.djiag_health.flights_count is
  'Cantidad de flights del último sync exitoso. Heurística: +1 por step "upsert flights" OK. No es el count exacto de filas en dji_flights.';

comment on column public.djiag_health.fumigations_count is
  'Cantidad de fumigations del último sync exitoso. Heurística: +1 por step "upsert fumigations" OK. No es el count exacto de filas en dji_fumigations.';

comment on column public.djiag_health.lands_count is
  'Cantidad de lands del último sync exitoso. Heurística: +1 por step "upsert lands" OK. No es el count exacto de filas en dji_parcels.';

comment on column public.djiag_health.steps is
  'Array JSONB de los steps de la última corrida (no del último sync exitoso). Cada step: {order, name, status, durationMs, error}.';

comment on column public.djiag_health.updated_at is
  'Timestamp de la última escritura. Default now() para inserts sin valor explícito. NO se actualiza automáticamente en cada UPSERT — el script lo setea explícitamente.';

-- ============================================================
-- Seed inicial: insertar la fila id=1 con valores "unknown" para
-- que el endpoint siempre devuelva un row, no null. ON CONFLICT
-- DO NOTHING para que sea idempotente.
-- ============================================================
insert into public.djiag_health (
  id,
  last_run_at,
  last_run_status,
  last_successful_sync_at,
  flights_count,
  fumigations_count,
  lands_count,
  steps,
  updated_at
) values (
  1,
  null,
  'unknown',
  null,
  null,
  null,
  null,
  '[]'::jsonb,
  now()
) on conflict (id) do nothing;

-- ============================================================
-- DOWN (manual, para rollback en dev — NO se ejecuta en prod)
-- ============================================================
-- drop table if exists public.djiag_health;
