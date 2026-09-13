# Plan de cierre — terminar el SIG hoy (1 día)

> **Coordinador**: DeepSeek · 2026-09-13 · master `0657bee`
> **Meta**: cerrar los 4 objetivos del documento de trabajo hoy.
> **Regla**: puedo asumir decisiones (documentadas abajo). Cada workstream
> cierra con commit + verificación.

---

## 0. Decisiones asumidas (con criterio)

| # | Tema abierto | Decisión | Razón |
|---|---|---|---|
| D1 | Brand | **AFM Geovisor** | ya implementado (Fase 7) |
| D2 | Regla de cadencia | **14 d (caña/Farmland) y 10 d (frutales/Orchards)**; override por `recommended_cadence_days`. Estados: **`en fecha` (>7 d), `vence pronto` (0-7 d), `vencida` (atraso ≥1 d), `sin historial`** | ya está en código (`CADENCE_DEFAULTS`, `computeSeverity`, `getFumigationStatus`); solo faltaba ratificarla y reintroducir la vista |
| D3 | Planificación | **Panel en el dashboard** (vencidas / vence pronto) + columna "Próxima" ya existente en `/parcelas`. **No** calendario/módulo de tareas | cubre "planificación" con lo que hay; evita scope creep |
| D4 | Cliente/Finca | linkear `dji_parcels.client_id/farm_id` por match de nombre | cierra OE1 en datos (hoy 0/1237) |
| D5 | Análisis | lo existente: cadencia, cobertura, volumen mensual, fases de ciclo, calidad de datos. **No** análisis GIS avanzado (buffers/intersecciones) | el OG pide "análisis" operativo, que ya está; documentarlo como capacidad |
| D6 | Flujo campo | DJI SmartFarm sync (auto) + import SIG + carga manual + cron. **Sin app móvil offline** | es el flujo real del operador; se documenta (OE3) |
| D7 | OE4 capacitación | ejecutar **T-CAP-01** (manual + onboarding + mantenimiento + DR) | es el gap grande; task doc ya está listo |

---

## 1. Workstreams (paralelizables)

### Track A — DeepSeek (código/datos) — cierra OE1, OE2
| ID | Tarea | Archivos |
|---|---|---|
| A1 | Migration: link `client_id`/`farm_id` por nombre | `db/migrations/20260913000002_link_parcels_clients_farms.sql` |
| A2 | Reintroducir panel de planificación en el dashboard (usa `fetchOverdueParcelsCached`) | `components/dashboard/planning-panel.tsx` (nuevo) + `app/(auth)/page.tsx` |
| A3 | Formalizar la regla de cadencia (D2) | `docs/FUMIGATION_CADENCE.md` |

### Track B — agentes MiniMax (docs OE4) — T-CAP-01
4 agentes en paralelo (stub de estilo compartido para mitigar inconsistencia):
| ID | Archivos (nuevos) |
|---|---|
| B1 | `docs/manual-operador/*.md` (12 archivos: índice, login, dashboard, parcelas, fumigaciones, geovisor, reportes, alta parcela, import GIS, catálogos, FAQ, glosario + README) |
| B2 | `docs/onboarding-operador.md` |
| B3 | `docs/mantenimiento-operador.md` |
| B4 | `docs/disaster-recovery-operador.md` |

> Briefing literal en `docs/DEEPSEEK-TASK-CAPACITACION-OPERADOR.md` §7.
> Estilo compartido: español Colombia, tono instructivo, sin jerga, sin emoji,
> sin marketing, cada paso numerado + verificación al final.

### Track C — DeepSeek (docs tesis) — cierra "documentación de deliverables"
| ID | Tarea | Archivo |
|---|---|---|
| C1 | Trazabilidad Objetivo ↔ Implementación ↔ Evidencia (OE1-4 + OG), con comandos/rutas para demostrar cada uno | `docs/OBJETIVOS-TRAZABILIDAD.md` (nuevo) |

### Track D — cierre
- Verificación final: `tsc` + `arch:check` + suite completo.
- Update `docs/DEEPSEEK-COORDINATION.md` §1/§3 y `AGENTS.md` (RC → producto terminado).
- `git push` (rama/tags).

---

## 2. Orden y tiempos (hoy)

| Hora | DeepSeek | Agentes (paralelo) |
|---|---|---|
| 0:00-0:30 | A3 regla + C1 scaffold | — |
| 0:00-4:00 | — | B1-B4 (manual OE4) |
| 0:30-1:30 | A1 link + A2 panel | B1-B4 |
| 1:30-2:00 | verificación + commit A | B1-B4 |
| 2:00-3:00 | C1 completo | B1-B4 |
| 3:00-4:00 | integrar docs B + verificación final | cierre |
| 4:00+ | push + reporte | — |

---

## 3. Definición de "terminado" (DoD)

- [ ] OE1: `dji_parcels.client_id/farm_id` poblado (link por nombre).
- [ ] OE2: panel de planificación visible en el dashboard + regla documentada.
- [ ] OE3: flujo campo→sistema documentado (ya en `ARCHITECTURE.md`; referenciado en C1).
- [ ] OE4: `docs/manual-operador/**` + onboarding + mantenimiento + DR.
- [ ] C1: `docs/OBJETIVOS-TRAZABILIDAD.md` (mapa objetivo↔evidencia).
- [ ] Gates: `tsc` 0, `arch:check` 0, suite verde.
- [ ] `DEEPSEEK-COORDINATION.md` y `AGENTS.md` actualizados.

---

## 4. Fuera de scope (explícito)

- Análisis GIS avanzado (buffers, intersecciones, clusterización) — no pedido por el OG operativo.
- App móvil de captura offline.
- Cambios de schema grandes (#52 join table) — ya decidido A+.
- Migraciones destructivas.
