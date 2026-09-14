# DeepSeek MD — Coordinación multi-agente (AeroAdmin AFM)

> **Dueño / coordinador**: sesión **DeepSeek** (auditoría 2026-09-10).
> **Qué es**: el punto único de coordinación para trabajar este repo con
> **varios agentes de IA en paralelo** (Claude, GPT, Cursor, Gemini, etc.).
> **Regla de oro**: todo agente que vaya a tocar el repo debe (1) **leer
> este archivo primero**, (2) tomar **un** ítem del §3 y marcarlo
> `🟡 en progreso (agente)`, (3) commitear su trabajo, (4) actualizar el
> estado acá. Así evitamos pisarnos.
>
> Referencia rápida del repo: `AGENTS.md` (índice canónico). Este doc lo
> complementa con **estado vivo + protocolo multiagente**; no lo reemplaza.

---

## ⚠️ 0. Protocolo de coordinación (LEER ANTES DE TOCAR NADA)

**Contexto real**: el 2026-09-10 dos agentes corrieron en paralelo y uno hizo
`git reset --hard`, **borrando trabajo no commiteado del otro** (tuve que
re-aplicar todo). Sin protocolo, multiagente pierde trabajo. Reglas:

1. **Commit frecuente.** Apenas un cambio pasa `tsc` + sus tests, **commiteá**.
   Nunca dejes trabajo valioso solo en el working tree (es lo que se pierde).
2. **PROHIBIDO** sobre el repo entero: `git reset --hard`, `git checkout -- .`,
   `git restore .`, `git stash` (global), `git stash pop`, `git clean -fd`,
   `git rebase` sobre trabajo ajeno. Para limpiar, hacelo **por archivo**
   (`git restore -- <tu-archivo>`).
3. **Un agente = un scope de archivos.** No edites fuera del scope de tu ítem.
   Si necesitás tocar otro archivo, anotalo en §3 y coordiná.
4. **Antes de empezar**: `git status` + `git log --oneline -5`. Si hay
   cambios sin commitear que **no son tuyos**, NO los toques.
5. **Rama por tarea** (recomendado): `feat/<issue>-<slug>` o `fix/<issue>-<slug>`.
6. **Mark it**: en §3, pasá tu ítem a `🟡 en progreso (<agente>)` al empezar
   y a `✅ hecho (<commit>)` al terminar.
7. **Gates antes de commitear**: `npx tsc --noEmit` + `npm run arch:check` +
   `npx vitest run <tus tests>`. El suite completo lo corre quien cierra la fase.
8. **No instalar dependencias sin avisar** (regla de `AGENTS.md`).
9. **Un ítem = un commit scoped** (`tipo(scope): descripción`). No mezcles
   ítems no relacionados.

---

## 1. Estado actual

- **Fecha**: 2026-09-13
- **master**: ver `git log --oneline -1`.
- **Gates**: `tsc` 0 errores · `arch:check` 0 errores · tests **2221/2221** ✅
- **Producto**: Release Candidate. **OE1/OE2 cerrados; OE4 pendiente (manual).**

---

## 2. HECHO — NO re-trabajar

### 2.1 Auditoría original (sesión DeepSeek #1) — commits `7a6172c`, `1f7669c`, `5c4c853`
- **#1-#5** críticos schema/lógica: colisión tabla `clients` (migration nueva),
  alias `COUNT(*)`, typos en `backfillCyclesFromFumigations`, `flight_ids`
  interno→externo, botón "Continuar" del wizard.
- **#6-#8** seguridad: `applications/import` (PII + spoofing), `supervisor`
  no escribe facturas/catálogos, gate token en `print-map`.
- **#9-#13** UI/UX: paginación "anterior", QuickActions, labels de
  `data_validity`, inglés→español, componentes muertos (`compliance-panel`,
  `last-fumigation-card`).

### 2.2 Backlog intermedio (agentes concurrentes)
| Commit | Issues |
|---|---|
| `a5aad74` | #14 `UNIQUE(parcel_id)` en `dji_fumigation_schedule` + #16 idempotencia del backfill de ciclos |
| `7b3fc18` | #17/#18/#19 respetar soft-delete en 3 queries |
| `4f5e3d5` | #20 `bulkSetParcelClientFarm` en 1 query (N+1) |
| `edc78b0` | #25 deny-by-default en `/api/*` + #26 TLS verify + #28 sanitize pg errors |
| `3159c5d` | #34 card doble del dashboard + #38 botón "Coords" en español |
| `8e3d249` | #15 `getRecentFumigations` lee centroide de la MV |
| `c2a83be`/`2e6908e` | #21 `RETURNING` en `createManualParcelsBulk` + #22 schedule dentro de la transacción |
| `d111c40` | #28 sanitize pg errors (handlers restantes) |
| `c4fecc2` (Fase E) | #35 role-gate de botones admin + #37/#39 inglés→español + tokens de color |

### 2.3 Fase 1 + Fase 2 (sesión DeepSeek #2) — commit `690af0f`
| Issue | Fix |
|---|---|
| #41 | `withLocalFallback` estricto en prod (loguea + rethrow; override `DATABASE_STRICT`) |
| #42 | Error boundaries: `app/error.tsx`, `app/(auth)/error.tsx`, `components/error-state.tsx` |
| #43 | Validación de env (`lib/env.ts` + `instrumentation.ts`) y `.env.example` sincronizado |
| #44 | Timeouts del pool (`connectionTimeoutMillis`, `statement_timeout`, `query_timeout`) |
| #45 | Redirect muerto `/history → /fumigaciones` |
| #46 | `print-map` sirve MapLibre **same-origin** desde `/public/maplibre/` (fix CSP) + `scripts/copy-maplibre-assets.js` |
| #47 | Matcher del middleware excluye assets estáticos (SVG de marca) |
| #48 | Endpoint real `/api/health` |
| #51 | Drift de docs: `notes` es TEXT, `vehicle_plate` es columna, `flight_ids` externo |
| #56 | Captura de logs con `AsyncLocalStorage` (`lib/log-capture.ts`) reemplaza el monkey-patch de `console.log` |
| #36 | (parcial) identificadores internos de BD fuera del UI | ✅ Fase 6 (`53ab9ce` MT-08) |

> Los nuevos endpoints/archivos: `app/api/health/route.ts`, `lib/env.ts`,
> `lib/log-capture.ts`, `instrumentation.ts`, `components/error-state.tsx`,
> `app/error.tsx`, `app/(auth)/error.tsx`, `scripts/copy-maplibre-assets.js`.

### 2.4 Fase 3 (sesión DeepSeek #3) — commit `6ecaf59`| # | Fix |
|---|---|
| Flake | `register-fumigation-form`: mock de fetch **URL-aware** + contar solo las llamadas del submit (`submitCalls()`), en vez de `toHaveBeenCalledTimes(1)`; + guard anti doble-submit (`submittingRef`) en el form |
| #57 | Rate-limit de login (`lib/login-throttle.ts`: 8 intentos / 15 min por email, per-instance) integrado en `authorize()` |
| #31 | `authorize()` ya no loguea el error crudo de `pg` (solo el mensaje); email enmascarado |
| #24 | `lib/backfill/refresh-fumigations.ts`: docblock huérfano eliminado + doc de transacción corregida (la maneja el caller) |

### 2.5 Fase 4 (sesión DeepSeek #4)
| # | Fix |
|---|---|
| #29 | `app/api/data-quality/invariants/route.ts`: reescrito `computeInvariants` con WHERE explícitas (sin `String.replace` frágil). **Bug extra encontrado**: usaba `f.parcela_id` (columna inexistente en `dji_fumigations`; es `parcel_id`) → las invariantes 2-5 lanzaban y el `catch` las tragaba en silencio. Corregido + test de regresión (`tests/api-data-quality-invariants.test.ts`). También se sanitizó el error 500. |
| #59 | Eliminado `tests/e2e/geovisor-ui-changes.spec.ts` (obsoleto post QA-01/02, superseded por `geovisor-and-parcels.spec.ts` + `geovisor-renders-parcels.spec.ts`). |

### 2.6 Fase 6 (sesión 2026-09-13) — auth/contratos + MT batch
| Commit | Issue(s) | Descripción |
|---|---|---|
| `54b34b6` | #55 | Índices parciales en `dji_flights(area_m2)` y `(duration_seconds)` (MT-04) |
| `4a08925` | #37 | import GIS i18n + colores (MT-06) |
| `b9ebc82` | cobertura | TODOs de `lib/map-filter-types.ts` + tests directos + README sync (MT-07/10/11 consolidados) |
| `2a0e12f` | cobertura | Tests de `api/queries.ts` (MT-12) — 19 asserts sobre SELECTs/joins |
| `53ab9ce` | #36 | Atribución MT-08 — cambios reales absorbidos en `b9ebc82` |
| `086112c` | #33 | `trustHost` condicional (MT-01) — VERCEL/dev override, sin proxy default |
| `ef93b41` | #27 | `requireFreshRole` para endpoints destructivos (MT-02) — JWT + BD re-validada |

Total Fase 6: 7 commits, +32 tests (2182 → 2214 verde), tsc/arch 0 errores.

### 2.7 Mini-tasks (Tandas 1-3) — cerradas
| ID | Estado |
|---|---|
| MT-01..MT-12 | ✅ Tanda 1 (ver `DEEPSEEK-MINI-TASKS.md` §1) |
| MT-09 | ✅ Tanda 2 — scratch del root limpiado (62 archivos) |
| NT-01 | ✅ `timingSafeEqual` extraído a `lib/timing-safe.ts` (+test) |
| NT-02 | ✅ `loading.tsx` para las 5 rutas de `(auth)` |
| NT-03 | ✅ `error.tsx` para `(public)` |
| NT-04 | 🚫 descartado (el audit trail ya es accesible) |
| NT-05 | 🚫 descartado (`chart-4` no da contraste para texto; app light-only) |

### 2.8 Fase 7 (DeepSeek, cierre) — brand + épicos
| # | Fix |
|---|---|
| #40 | Brand canónico **"AFM Geovisor"**: login, `AfmMark` alts, metadata de páginas. |
| #32 | Contrato de error documentado + `errorResponseSchema` cubre `issues` opcional. |
| #50 | Migration `20260913000001_sync_fumigation_product_used.sql` (sync one-time desde `products.name`). |
| #60 | Scratch del root limpiado (62 archivos) — MT-09. |
| #58 | 🚫 diferido (enhancement; los filtros server-side ya acotan). |

> Detalle en `docs/DEEPSEEK-MINI-TASKS.md`.

### 2.9 Fase 8 (DeepSeek) — épicos de modelo (#49/#52, opción A+)
| # | Fix |
|---|---|
| #49 A+ | Invariants `parcela_cliente_nombre_desincronizado` / `parcela_finca_nombre_desincronizado` en `/api/data-quality/invariants` (drift visible en `/admin/calidad`). |
| #52 A+ | Script read-only `scripts/check-flight-ids-integrity.js` (`npm run check:flight-integrity`) que detecta `flight_ids` huérfanos/nulls; exit 2 si hay. |

> Decisión + opciones descartadas (B/C/D) en `docs/DEEPSEEK-PROPOSAL-MODELO-DATOS.md`.

### 2.10 Fase 9 (DeepSeek) — cierre de objetivos (OE1/OE2)
| # | Fix |
|---|---|
| OE1 | Migration `20260913000002_link_parcels_clients_farms.sql`: link de `dji_parcels.client_id/farm_id` por nombre (aplicada en prod: 7 con cliente, 2 con finca, drift 0). |
| OE2 | `components/dashboard/planning-panel.tsx` (vencidas / por vencer) en el dashboard + regla de cadencia ratificada en `docs/FUMIGATION_CADENCE.md`. |
| OE3 | Flujo campo→sistema ya implementado; documentado en `docs/ARCHITECTURE.md` + referenciado en `docs/OBJETIVOS-TRAZABILIDAD.md`. |
| OE4 | ⏳ Manual del operador (T-CAP-01) — asignar a agentes. |
| — | `docs/OBJETIVOS-TRAZABILIDAD.md` (mapa objetivo↔evidencia para sustentación). |

> Plan + decisiones asumidas: `docs/DEEPSEEK-PLAN-CIERRE.md`.

### 2.11 Fase 10 (DeepSeek) — Planificación fitosanitaria por fase (MVP)
| Capa | Cambio |
|---|---|
| Schema | `phase_application_rules` + seed caña + `application_types('madurante')` + curva canónica 4 fases en `phase_rules` (migration `20260913000003`, aplicada) |
| Lógica | `lib/phase-applications.ts` (`phaseForDays`, `applicationsForPhase`, `computeRequirement`) + 10 tests |
| Repo | `getPhaseApplicationRules`, `getPhaseApplicationsForParcel`, `getPhasePlanningOverview` |
| UI | `PlanningPanel` fenológico en el dashboard (reemplaza cadencia fija) + card "Manejo fitosanitario" en `/parcelas/[id]` + workflow registrar corte / iniciar ciclo (`CycleActions`, `POST /api/admin/cycles/[id]/close`) |
| Docs | `FUMIGATION_CADENCE.md` (sección fase), `DATA-MODEL.md`, propuesta `DEEPSEEK-PROPOSAL-CICLOS-FENOLOGIA.md` |

> Decisiones del usuario: 4 fases (simple), reemplaza las alertas, data-driven
> + UI, categoría×tipo, solo calendario, misma variedad.

---

## 3. PENDIENTE (backlog abierto)

> **Mini-tasks paralelizables para agentes (MiniMax)**: ver
> `docs/DEEPSEEK-MINI-TASKS.md` — tareas chicas, con scope de archivos
> disjunto, listas para correr en paralelo.
>
> **Épicos de modelo (#49/#52)**: propuesta de diseño para discutir en
> `docs/DEEPSEEK-PROPOSAL-MODELO-DATOS.md`.
>
> Estados: `⬜ abierto` · `🟡 en progreso (<agente>)` · `✅ hecho (<commit>)` ·
> `🚫 descartado (motivo)`.
> Antes de tomar un ítem, agregá tu nombre y la fecha.

| # | Tema | Sev | Estado |
|---|---|---|---|
| — | **Flake** `register-fumigation-form` (mockFetch 2×, pasa aislado) | MEDIO | ✅ Fase 3 |
| #23 | `getFarmsReportFumigations` proyecta columnas duplicadas (`land_name` x2) | BAJO | 🚫 descartado (ambas columnas están en el tipo; no es bug) |
| #24 | Docblock huérfano en `lib/backfill/refresh-fumigations.ts` | BAJO | ✅ Fase 3 |
| #27 | `getCurrentUserRole()` (BD-fresh) no lo usa ningún endpoint → rol stale hasta 12h | MEDIO | ✅ Fase 6 (`requireFreshRole` aplicado a 2 endpoints destructivos) |
| #29 | `computeInvariants` construye SQL con `String.replace()` frágil | MEDIO | ✅ Fase 4 (+ bug `f.parcela_id`) |
| #31 | `authorize()` loguea el error crudo de `pg` | BAJO | ✅ Fase 3 |
| #32 | Shape de error 400 inconsistente (zod `{error,issues}` vs `{error}`) | BAJO | ✅ Fase 7 (`errorResponseSchema` cubre `issues` opcional + contrato documentado) |
| #33 | `trustHost: true` incondicional en `auth.config.ts` | BAJO | ✅ Fase 6 (`086112c`) |
| #40 | Branding: conviven "AFM Geovisor" (sidebar) y "AeroAdmin AFM" (login) | BAJO | ✅ Fase 7 — brand canónico **"AFM Geovisor"** |
| #49 | Cliente/Finca: doble fuente de verdad (`client_name` texto vs FK). Sync app-level en `updateParcelMetadata` + migration one-time (Fase 5) + **invariant guard (Fase 8)** | ALTO | ✅ A+ implementado (decisión: doc `DEEPSEEK-PROPOSAL-MODELO-DATOS.md`) |
| #50 | `product_used` (texto) vs `product_id` (FK): mismo patrón dual | MEDIO | ✅ Fase 7 (migration de sync one-time desde `products.name`) |
| #52 | `flight_ids[]`/`parcels[]` sin integridad referencial → evaluar tabla de unión `fumigation_flights` | MEDIO | ✅ A+ implementado (`npm run check:flight-integrity` read-only; join table queda como escalada documentada) |
| #54 | `dji_flights` sin `deleted_at` (intencional) — documentar invariante | BAJO | ✅ Fase 6 (`31df9f9` MT-03) |
| #55 | Posible índice para el scan del dashboard (`area_m2`/`duration_seconds`); **revisar diagnóstico** (el cuello real es el `OR`, no la fecha) | BAJO | ✅ Fase 6 (`54b34b6` MT-04) |
| #57 | Sin rate-limit/lockout en login | MEDIO | ✅ Fase 3 |
| #58 | Paginación server-side real de `/fumigaciones` | BAJO | 🚫 diferido (los filtros server-side de Fase 5 ya acotan; el cap actual es suficiente para el Valle) |
| #59 | Cleanup e2e `tests/e2e/geovisor-ui-changes.spec.ts` (pre-QA-01/02) | BAJO | ✅ Fase 4 |
| #60 | Limpiar scratch sin trackear del root (`gh-pr-body-*`, `git-commit-msg-*`) | BAJO | ✅ Fase 7 (62 archivos) |

> **Nota**: los números `#N` provienen de la auditoría original (ver §8).
> El detalle de cada hallazgo está resumido en la columna "Tema"; para el
> contexto completo, `git show <commit>` y `git log --grep`.

---

## 4. Backfills operacionales pendientes (manual — cada ambiente)

> Correr **UNA vez** por ambiente (local / preview / prod). No son código;
> son tareas del operador.

1. `node scripts/backfill-clients-farms.js` — desbloqueado por #1.
2. `POST /api/admin/cycles/backfill` — **NO correr 2 veces** (no idempotente; #16).
3. `npm run refresh:fumigations` — re-pobla `flight_ids` con los IDs externos
   correctos (#4).

---

## 5. Gates de verificación (definición de "listo")

- [ ] `npx tsc --noEmit` → 0 errores.
- [ ] `npm run arch:check` → 0 errors.
- [ ] `npm run test:coverage` → umbral global 45/65 (sube, nunca baja sin excusa).
- [ ] Si tocás schema → migration en `db/migrations/YYYYMMDDHHMMSS_*.sql` + `npm run db:migrate`.
- [ ] Si tocás módulo crítico (`lib/alerts.ts`, `lib/fumigation-cadence.ts`,
      `lib/dji-flights-aggregate.ts`, `lib/djiag-spatial-aggregator.ts`) → test
      que falle si cambia el comportamiento.
- [ ] Actualizaste este doc (§3) y `AGENTS.md` si cambió el estado global.

---

## 6. Convenciones del repo (resumen — el detalle vive en `AGENTS.md`)

- **R1 datos**: `pg` NUNCA se importa desde `app/` ni `components/`. La capa
  es `api/repositories.ts` + `api/queries.ts` + `lib/db.ts`.
- **R2 scraping**: `lib/djiag-*` no se importa desde `app/**` (excepto
  `space-aggregator`/`health`/`from-make` documentados).
- **R3 tests**: código nuevo en `lib/` viene con tests (happy + edge).
- **R4 fechas**: TZ `America/Bogota`, pasar por `lib/format.ts`.
- **R5 auth/PII**: roles `admin`/`supervisor`; no loguear PII ni secrets.
- **R6 schema**: migrations en `db/migrations/`, aplicar con `npm run db:migrate`.
- **Commits**: `tipo(scope): descripción` en presente, español o inglés.
- **UI**: primitives propios en `components/ui/` (shadcn-style + `@base-ui/react`).

---

## 7. Fases

- **Fase 3 — Correctitud y seguridad** ✅ `6ecaf59`:
  flake del form, #57, #31, #24.
- **Fase 4 — Correctitud de datos + cleanup** ✅ (sesión #4): #29
  (reescritura de `computeInvariants` + bug `f.parcela_id`), #59 (e2e obsoleto).
- **Fase 5 — Modelo de datos (DISEÑO PENDIENTE)**: #49 (mitigado con
  sync one-time; falta decidir vista vs trigger vs eliminar denormalizado),
  #50 (mismo patrón), #52 (tabla de unión `fumigation_flights` + backfill).
  **Acordar approach antes de tocar schema.**
- **Fase 6 — Contratos/auth**: #27, #32, #33.
- **Fase 7 — UI/perf restante**: #40, #55, #58, #60.

> Cada fase se cierra con: gates verdes + commit(s) + update de §1 y §3.

---

## 8. Historial de este doc

- **2026-09-10** — creado por **DeepSeek** a partir de la auditoría completa
  (UI/UX, seguridad/auth, schema BD, lógica). Reemplaza a
  `PLAN-ISSUES-2026-09-10.md` (renombrado). Se agrega §0 (protocolo
  multiagente) tras el incidente de `git reset --hard` entre dos agentes.
- **2026-09-10** — Fase 3 (DeepSeek #3): flake del form resuelto, rate-limit
  de login (#57), sanitización del log de auth (#31), docblock de
  `refresh-fumigations` (#24). Suite 2179/2179.
- **2026-09-10** — Fase 4 (DeepSeek #4): `computeInvariants` reescrito y
  corregido el typo `f.parcela_id` (las invariantes 2-5 estaban rotas en
  silencio); e2e obsoleto eliminado. Suite 2182/2182.
- **2026-09-10** — Fase 5 (DeepSeek #5): migration de sync one-time de
  `client_name`/`farm_name` desde el FK (#49).
- **2026-09-13** — Tanda 1 multi-agente (MiniMax) verificada: MT-01..MT-12
  (10 cerradas, MT-05 descartada). Suite 2214/2214.
- **2026-09-13** — Fase 7 (DeepSeek): brand canónico "AFM Geovisor" (#40),
  contrato de error (#32), sync `product_used` (#50), `timing-safe`, loading
  boundaries, `(public)` error boundary, scratch cleanup (MT-09/NT-01..03).
  NT-04/05 descartadas con rationale. Suite 2218/2218.
- **2026-09-13** — Fase 8 (DeepSeek): épicos de modelo cerrados con opción A+
  (#49 invariant guard; #52 monitor de huérfanos). Decisión en
  `DEEPSEEK-PROPOSAL-MODELO-DATOS.md`.
- **2026-09-13** — Fase 6: 7 commits de la corrida multi-agente (8 agentes en
  paralelo). `trustHost` condicional (#33), `requireFreshRole` (#27), índices
  de dashboard (#55), i18n import GIS (#37), tests/cobertura de
  `map-filter-types` + `api/queries`. Suite 2214/2214 verde. Ver §2.6.

> **Mantené este doc vivo**: si terminás un ítem, actualizá §1/§3 en el mismo
> commit. Si encontrás un agujero nuevo, agregalo a §3 y avisá.
