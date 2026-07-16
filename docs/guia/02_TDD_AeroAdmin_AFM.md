# TDD — Guía de Test-Driven Development
## AeroAdmin AFM

> Audiencia: agentes de IA desarrollando sobre este repo.
> Complementa `01_SDD_AeroAdmin_AFM.md` (arquitectura) y `03_MEJORES_PRACTICAS_AGENTES.md`.

---

## 1. Filosofía: TDD real, no "tests después"

En este proyecto TDD significa **rojo → verde → refactor**, en ese orden, siempre:

1. Escribir el test que describe el comportamiento esperado (debe fallar).
2. Escribir el mínimo código para que pase.
3. Refactorizar manteniendo el test verde.

Un agente **no debe** escribir el código de producto primero y "agregar tests después
para cumplir". Esto es especialmente importante en este proyecto porque la lógica
geoespacial y de cadencia tiene muchos casos borde (parcela sin geometría, cadencia
sin fumigación previa, TZ) que solo un test-first detecta antes de que se conviertan
en bugs en producción con datos reales de 1207 parcelas.

**Baseline actual**: 588/604 tests verdes (16 se saltan si Docker/PostGIS local está
apagado). Cualquier PR que baje ese número sin justificación explícita es un bloqueo.

---

## 2. Stack de testing

| Tipo | Herramienta | Ubicación |
|---|---|---|
| Unit / lógica pura | Vitest | `tests/*.test.ts` |
| Componentes React | Vitest + jsdom + React Testing Library | `tests/components/*.test.tsx` |
| E2E | Playwright (`@playwright/test`) | `tests/e2e/*` |
| Smoke de base de datos | Script Node plano | `scripts/smoke-test-db.js` |
| Fixtures reales de DJI | Capturas del operador | `tests/fixtures/djiag-live/` |

---

## 3. Pirámide de tests para este proyecto

```
        ▲  E2E (Playwright)
       ╱ ╲  auth-and-dashboard, map-and-history
      ╱   ╲
     ╱     ╲  Integración (API routes + DB real o fixtures)
    ╱       ╲  api-routes, api-task-history, spatial-join
   ╱         ╲
  ╱           ╲  Componentes (RTL + jsdom)
 ╱             ╲  ~25 archivos en tests/components/
╱_______________╲  Unit puro (lib/*, parsers, cadencia, alertas)
```

La mayoría del esfuerzo de un agente debe ir en la base (unit) y en componentes —
son rápidos y detectan el 80% de los bugs de lógica de negocio (cadencia, alertas,
conversión de unidades) sin depender de Docker.

---

## 4. Checklist obligatorio por tipo de artefacto

### 4.1 Componente React nuevo (mínimo, sin excepción)
1. Render con datos típicos.
2. Render con datos vacíos (parcela sin fumigaciones, día sin vuelos).
3. Render con datos extremos (0 vuelos, 1000 vuelos, área en 0).
4. Accesibilidad básica: `role`, `label` correctos vía queries de RTL
   (`getByRole`, no `getByTestId` como primera opción).

### 4.2 Route handler nuevo (`app/api/*/route.ts`)
1. Caso feliz con parámetros válidos.
2. Parámetros inválidos → 400 con `{error: msg}` (no 500).
3. Sin sesión → 401 (verificar que `requireAuth()` está siendo llamado).
4. Si muta datos: verificar que se invalida el cache tag correspondiente
   (`lib/cache.ts`) — un test que compruebe que una lectura posterior refleja el cambio.

### 4.3 Función de `lib/*.ts` (lógica de negocio pura)
1. Caso feliz.
2. Caso borde específico del dominio: cadencia sin `last_fumigation_date`,
   alerta en el límite exacto del umbral (`area_mu == 60`), conversión MU↔ha con
   redondeo.
3. Si toca fechas: usar strings con día ≥15 o mockear `Intl.DateTimeFormat`
   (ver sección 5 — TZ-fragile).

### 4.4 Script de pipeline (`scripts/*.js`)
1. Test de idempotencia: correr el script dos veces sobre el mismo input no debe
   duplicar filas ni romper constraints (`UNIQUE (batch_id, external_id)`, etc.).
2. Test con fixture de `tests/fixtures/djiag-live/` (dato real, no inventado).
3. Si el script depende de un paso anterior del pipeline (ver SDD §5): test que
   verifique el comportamiento cuando el input previo está vacío o parcial.

### 4.5 Cambio a query espacial (`ST_*`)
1. Test con geometría real (usar fixtures existentes, no polígonos de juguete
   irreales) verificando que el índice GIST relevante se usa (o al menos que el
   resultado es correcto — el uso del índice se valida en QA de performance, no en
   test unitario).
2. Test de caso "sin match" (punto fuera de tolerancia) para confirmar que no
   hace matching falso-positivo.

---

## 5. Patrones y gotchas conocidos de este proyecto

- **TZ-fragile tests**: cualquier test que use `toLocaleDateString` o `new Date()`
  sin fijar TZ es frágil en `jsdom` (el runner puede correr en cualquier TZ del CI).
  Mitigación: mockear `Intl.DateTimeFormat`, o usar fechas con día 15+ para evitar
  problemas de borde de mes en conversiones UTC↔America/Bogota. Ver patrones completos
  en `tests/setup.ts`.
- **Contract tests adversariales**: para Task History existe
  `verifier-contract-adversarial.test.tsx`, que valida invariantes de negocio
  (ej. "los totales del header siempre coinciden con la suma de `days[]`", "estado
  vacío no rompe render", "click en filtro produce el query esperado"). Cuando se
  toca esta feature, este archivo es la primera línea de defensa — correrlo antes
  de dar por terminado el cambio.
- **Fixtures reales sobre mocks inventados**: para todo lo relacionado a DJI
  (`djiag-*`), preferir las capturas reales en `tests/fixtures/djiag-live/`
  (generadas con `npm run capture:djiag:*`) en vez de construir JSON de mock a mano.
  El formato real de DJI tiene particularidades (locale zh-CN, camelCase mixto,
  campos `raw_*`) que un mock inventado no replica fielmente.
- **DB smoke test**: `scripts/smoke-test-db.js` corre 8 aserciones sobre el estado
  actual de la base — útil como chequeo rápido tras una migración, no reemplaza los
  tests de Vitest.

---

## 6. Flujo de trabajo esperado de un agente

1. Leer la tarea y ubicar la capa afectada (SDD §3).
2. Escribir el test (o los 3-4 casos del checklist según el tipo de artefacto) **antes**
   de tocar el código de producto.
3. Confirmar que el test falla por la razón correcta (no por un typo o import roto).
4. Implementar el mínimo necesario para pasar.
5. Correr la suite completa relevante:
   - `npm test` (Vitest) para unit/componentes.
   - `npm run e2e:auth` / `npm run e2e:map` si se tocó auth o mapa.
   - `node scripts/smoke-test-db.js` si se tocó schema o migraciones.
6. Refactorizar solo con tests en verde.
7. Si el cambio afecta un contrato documentado en el SDD (§6), actualizar ese
   documento en el mismo cambio — no dejarlo para después.

**Nunca** mergear con la suite en rojo, y nunca reducir el conteo de tests que pasan
sin dejar constancia explícita del porqué (ej. "se elimina X porque la feature se
removió, ver commit Y").

---

## 7. Definition of Done (testing)

Un cambio se considera terminado cuando:
- [ ] Existe al menos un test que hubiera fallado antes del cambio.
- [ ] La suite completa relevante pasa localmente.
- [ ] Se cubrieron los casos del checklist §4 correspondiente al tipo de artefacto.
- [ ] No se introdujeron tests TZ-fragiles sin mitigación.
- [ ] Si se tocó Task History o alertas, `verifier-contract-adversarial.test.tsx`
      (o el contract test equivalente) sigue verde.
- [ ] El conteo total de tests verdes no bajó respecto a la baseline (588/604 con
      Docker apagado, o el número vigente documentado en `docs/STACK.md`).
