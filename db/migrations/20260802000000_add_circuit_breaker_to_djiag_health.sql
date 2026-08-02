-- Migration: add circuit_breaker column to djiag_health
-- Date: 2026-08-02
-- Sprint: H2 follow-up
--
-- Por qué existe:
--   El estado del circuit breaker del cliente DJI se persistía solo en
--   el filesystem (`djiag_exports/_health.json`). Eso funciona en dev
--   local pero NO en Vercel serverless: el filesystem es ephemeral y
--   se borra entre deploys y entre cold starts.
--
--   El endpoint admin `GET /api/admin/djiag-health` (Sprint H2) ahora
--   consume el shape `PipelineHealth` que incluye `circuitBreaker`. Si
--   el filesystem no lo tiene, `readHealthFromDb` no puede devolverlo.
--
-- Solución: espejar la sección `circuitBreaker` del JSON a la tabla
-- `djiag_health` como JSONB. La fuente de verdad sigue siendo el
-- filesystem (escrita por `lib/djiag-korean-client.js` cuando intenta
-- logins), pero al final de cada corrida el pipeline hace un merge:
-- lee la sección actual del file y la persiste en la columna.
--
-- Decisiones de diseño:
--   - **JSONB nullable**: `null` = nunca se intentó login (estado
--     equivalente a "circuit closed" pero sin tener que escribir un
--     objeto vacío). El reader (`readHealthFromDb`) trata `null` igual
--     a `undefined` y lo propaga como `circuitBreaker: null` en el
--     shape `PipelineHealth`.
--   - **No CHECK constraint sobre el shape del JSONB**: el shape
--     exacto está en TypeScript (`CircuitBreakerSnapshot`). Validar
--     en SQL duplica la lógica y se desactualiza. La validación
--     defensiva vive en `lib/djiag-health.ts#getCircuitBreakerState`
--     que es la fuente de verdad del contrato.
--   - **No FK a otra tabla**: el circuit breaker es metadata del
--     cliente DJI, no de las parcelas.

alter table public.djiag_health
  add column if not exists circuit_breaker jsonb null;

comment on column public.djiag_health.circuit_breaker is
  'Estado del circuit breaker del cliente DJI (S1, audit 2026-07-22 H2). Espejo de la sección `circuitBreaker` de `djiag_exports/_health.json`. Shape: ver `CircuitBreakerSnapshot` en `lib/djiag-health-types.ts`. Null si nunca se intentó login. Para deployments serverless (Vercel) donde el filesystem es ephemeral, este campo es la fuente autoritativa del estado del circuit.';
