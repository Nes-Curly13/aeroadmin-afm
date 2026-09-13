# Propuesta de modelo de datos — #49 y #52 (para discutir)

> **Autor**: DeepSeek (coordinador) · 2026-09-13
> **Estado**: BORRADOR — no implementado. Requiere decisión antes de tocar schema.
> **Contexto**: los dos únicos épicos abiertos en
> `docs/DEEPSEEK-COORDINATION.md` §3. El resto del backlog está cerrado.
> **Objetivo de este doc**: presentar opciones, trade-offs y una
> recomendación para discutir, NO ejecutar.

---

## 0. Resumen para decidir rápido

| Épico | Problema | Recomendación | Esfuerzo | Riesgo |
|---|---|---|---|---|
| **#49** Cliente/Finca | `client_name`/`farm_name` (texto) vs `client_id`/`farm_id` (FK): doble fuente | **Opción A+**: mantener el modelo actual (ya mitigado) **+ invariant guard** que detecte drift | ~0.5 día | Muy bajo |
| **#52** `flight_ids[]` | array de IDs sin integridad referencial + JOIN no-sargable | **Opción A+**: mantener el array **+ monitor de huérfanos**; escalar a join table solo si aparecen problemas | ~0.5 día | Muy bajo |

> Ambas recomendaciones son **conservadoras**: el producto es un RC single-tenant
> que funciona; preferimos observabilidad (invariants) antes que refactors de
> schema que puedan regresionar. Si querés ir por el modelo "puro", están las
> opciones B/C/D abajo.

---

## 1. #49 — Cliente/Finca: fuente única de verdad

### 1.1 Estado actual

- `dji_parcels` tiene **dos** representaciones del cliente y la finca:
  - `client_name` / `farm_name` (TEXT, **denormalizado**) — lo que usan la UI
    y los filtros.
  - `client_id` / `farm_id` (FK a `clients` / `farms`, Fase 3.A).
- **Sync app-level** ya existe: `updateParcelMetadata` deriva `client_name` del
  `client_id` (salvo override explícito).
- **Sync one-time** ya corrido (migration `20260910000002_*`).
- Parcelas **sin FK** conservan su texto legacy (free-text fallback).
- `vw_parcels` (join calculado) fue creada en Fase 3.A pero **NO se usa en
  ningún lado** (grep confirmado) → deuda/huérfana.
- Volumen de uso: ~68 sitios en `api/repositories.ts`, 32 en
  `admin-parcels-client.tsx`, 14 en `map-filter-logic.ts`, etc.

### 1.2 Opciones

#### A+ — Status quo + invariant guard (recomendada)
- **Qué**: no cambiar el modelo. Agregar a `computeInvariants`
  (`/api/data-quality/invariants`) un check:
  `parcela_cliente_nombre_desincronizado` cuando
  `p.client_id IS NOT NULL AND p.client_name IS DISTINCT FROM c.name`
  (idem finca). El operador lo ve en `/admin/calidad`.
- **Pro**: cero riesgo de regresión; el drift se hace **visible** en vez de
  silencioso; no toca schema ni queries.
- **Con**: el drift sigue siendo *posible* (no *imposible*) vía SQL directo.
- **Esfuerzo**: ~0.5 día. **Riesgo**: muy bajo. **Reversible**: sí.

#### B — Trigger de BD que derive el nombre desde la FK
- **Qué**: `BEFORE INSERT OR UPDATE` en `dji_parcels` que setee
  `client_name = (SELECT name FROM clients WHERE id = NEW.client_id)`.
- **Pro**: integridad en cualquier path (SQL, imports, scripts).
- **Con**: **pisa el override explícito** que hoy permite `updateParcelMetadata`
  (el operador puede querer un nombre visible distinto al del catálogo).
  Además hay que definir la política para `client_id = NULL` (¿null el texto?,
  ¿preservar el legacy?). Es exactamente el tipo de regla implícita que causó
  bugs antes.
- **Esfuerzo**: ~1 día. **Riesgo**: medio-alto (semántica de override). **Reversible**: sí (drop trigger).

#### C — Leer de la FK (COALESCE), texto solo como fallback
- **Qué**: las queries de lectura usan `COALESCE(c.name, p.client_name)` vía
  JOIN a `clients`; el texto queda como fallback para parcelas sin FK. Migrar
  los ~68 usos de repos + filtros (`missingClientName`, `client_name ILIKE`).
  Nota: `vw_parcels` ya hace este join → se podría adoptar (o recrear con el
  shape correcto) en vez de repetir el JOIN.
- **Pro**: **fuente única real** para parcelas con FK; imposible drift.
- **Con**: refactor grande y transversal; la búsqueda por nombre deja de usar el
  índice `idx_dji_parcels_client_name` (pasa a un `COALESCE` → indexable con
  expression index, o seq scan aceptable para 1.2k filas).
- **Esfuerzo**: ~3-5 días. **Riesgo**: medio (regresiones en filtros/reportes). **Reversible**: difícil.

#### D — Eliminar el denormalizado
- **Qué**: `DROP COLUMN client_name/farm_name`; toda parcela debe tener FK.
- **Pro**: modelo "correcto".
- **Con**: rompe el free-text (parcelas sin cliente/finca), requiere crear
  registros de cliente/finca para todo texto legacy, refactor total.
- **Esfuerzo**: ~1-2 semanas. **Riesgo**: alto. **Reversible**: no.

### 1.3 Recomendación: **A+**

El modelo actual **ya está mitigado** (sync app-level + sync one-time). El único
hueco es la observabilidad del drift residual, que A+ cierra con ~0.5 día y
riesgo nulo. C (fuente única real) queda como **objetivo de largo plazo** si el
operador reporta inconsistencias; D no la justifica un producto single-tenant.

### 1.4 Plan de A+ (si se aprueba)

1. Migration `20260913000002` (opcional): recrear/dropear `vw_parcels` huérfana
   (decidir: adoptar en C o `DROP VIEW` en A+). **Pregunta abierta.**
2. Agregar los 2 checks a `computeInvariants` + tipos en `WarningCode`.
3. Tests de regresión (`tests/api-data-quality-invariants.test.ts`).
4. (Opcional) Banner `/admin/calidad` ya lista los warnings — sin cambios.

---

## 2. #52 — Integridad de `flight_ids[]` / `parcels[]`

### 2.1 Estado actual

- `dji_fumigations.flight_ids` (`INT[]`) contiene `dji_flights.flight_id`
  (**externo DJI**, no el PK). Índice GIN parcial `idx_dji_fumigations_flight_ids_gin`.
- `dji_fumigations.parcels` (`TEXT[]`) contiene `external_id` de suertes
  secundarias.
- Consumidores hacen `JOIN dji_flights fl ON fl.flight_id = ANY(f.flight_ids)`
  (trazabilidad, MV de centroides, reportes) → **no-sargable** (expansión de array).
- **No hay FK posible** sobre un array → `flight_ids` puede referenciar IDs que
  no existen en `dji_flights` (huérfanos), p.ej. si un flight se borra/re-importa.
- El bug histórico (flight_ids con PK interno en vez de externo) ya se corrigió
  en el backfill (Fase 1) + sync one-time.

### 2.2 Opciones

#### A+ — Status quo + monitor de huérfanos (recomendada)
- **Qué**: mantener `INT[]`; agregar un chequeo (script o invariant) que cuente
  `unnest(f.flight_ids)` sin match en `dji_flights.flight_id`. Si > 0, alertar.
- **Pro**: cero refactor; visibilidad de integridad; el GIN ya soporta las
  queries actuales a la escala del proyecto (17k fumigaciones).
- **Con**: no impide huérfanos futuros; el JOIN sigue no-sargable (irrelevante
  hoy: la MV pre-calcula los centroides y el resto es por-fumigación).
- **Esfuerzo**: ~0.5 día. **Riesgo**: muy bajo. **Reversible**: sí.

#### B — Join table `fumigation_flights`
- **Qué**: `CREATE TABLE fumigation_flights (fumigation_id FK, flight_id FK, PRIMARY KEY(fumigation_id, flight_id))`
  + backfill desde `flight_ids[]` + migrar todos los consumidores
  (trazabilidad `getFumigationFlights`, MV centroides, reportes) + actualizar el
  write-path (`backfillFumigationsFromFlights`, create/update) + deprecar el array.
- **Pro**: integridad referencial real (FK + ON DELETE), joins sargables,
  indexable. Modelo "correcto".
- **Con**: migración + backfill + refactor transversal (MV, reportes, timeline,
  scripts) + mantener dual-write durante la transición. La MV de centroides
  tendría que recrearse sobre el join table y re-indexarse.
- **Esfuerzo**: ~3-5 días. **Riesgo**: medio-alto. **Reversible**: difícil.

#### C — Híbrido (array para escritura, join table para lectura)
- Mantener el array por comodidad del backfill y agregar la join table como
  fuente de query. **Con**: dos fuentes de verdad → más complejidad que B sin
  el beneficio de simplicidad. No recomendada.

### 2.3 Recomendación: **A+**

A la escala actual (16k flights / 17k fumigaciones) el array funciona bien y la
MV pre-calcula lo caro. El riesgo real es la integridad silenciosa, que A+
monitorea. B se justifica solo si: (a) aparecen huérfanos reales, (b) se suman
clientes/volumen (>>100k), o (c) se necesita FK/ON DELETE formal. **Trigger de
escalación** definido.

### 2.4 Plan de A+ (si se aprueba)

1. Script de diagnóstico `scripts/check-flight-ids-integrity.js` (read-only,
   reporta huérfanos y duplicados).
2. (Opcional) invariant `fumigacion_flight_huerfano` en
   `/api/data-quality/invariants`.
3. Documentar el invariante en `docs/DATA-MODEL.md`.

---

## 3. Preguntas para discutir

1. **#49**: ¿aceptás A+ (observabilidad) o querés ir a C (fuente única real)?
   ¿Hay hoy nombres visibles que el operador quiera distintos del catálogo
   (override)? — define si el trigger B es viable.
2. **#49**: `vw_parcels` está huérfana. ¿La adoptamos (camino a C), la
   actualizamos al shape real, o la dropeamos?
3. **#52**: ¿viste algún caso real de fumigación con un vuelo que "no aparece"
   (síntoma de huérfano)? — si sí, pasamos a B ya.
4. **#52**: ¿prevés crecer a múltiples clientes / >100k vuelos? — define si B
   vale la pena a futuro.
5. **General**: ¿querés que ambas recomendaciones A+ entren en la próxima tanda
   (son ~1 día total, riesgo mínimo)?

---

## 4. Decisión (llenar después de la discusión)

| Épico | Opción elegida | Fecha | Notas |
|---|---|---|---|
| #49 | **A+** (status quo + invariant guard) | 2026-09-13 | Implementado: checks `parcela_cliente_nombre_desincronizado` / `parcela_finca_nombre_desincronizado` en `/api/data-quality/invariants` |
| #52 | **A+** (status quo + monitor de huérfanos) | 2026-09-13 | Implementado: `scripts/check-flight-ids-integrity.js` (`npm run check:flight-integrity`, read-only) |
| `vw_parcels` | **mantener** (reservada para un futuro camino C) | 2026-09-13 | No se usa hoy; documentada como tal |

> **Contexto de la decisión**: el producto tiene ~10k vuelos / ~1.2k parcelas y
> 1 operador. A+ cubre el riesgo real (drift/integridad silenciosos) con ~1 día
> y riesgo mínimo. Las opciones B/C/D quedan documentadas para escalar si
> aparece un caso concreto.
