# Propuesta — Planificación fitosanitaria por ciclo fenológico

> **Autor**: DeepSeek (coordinador) · 2026-09-13
> **Estado**: BORRADOR para discutir. **NO implementado.**
> **Objetivo**: reemplazar las alertas por **cadencia fija** (14 d) por un
> modelo **fenológico** (siembra → fases → corte) que diga, por parcela:
> en qué fase está, qué **tipo de aplicación** requiere y **cuándo**.
>
> **Decisión del usuario**: "reglas según cómo funcionan las cadencias; una
> manera de actualizar fecha de corte y siembra para saber la fase; qué
> tipo de aplicación requiere". Primero planear/estructurar, luego aplicar.

---

## 0. Resumen para decidir

- **Ya existe** casi toda la base: `cycles`, `cycle_events`, `phase_rules`,
  `current_phase()`, `vw_current_cycle`, y los catálogos
  `fumigation_categories` (qué) + `application_types` (para qué).
- **Falta**: (a) reglas de **aplicación por fase**, (b) forma de **registrar
  siembra/corte**, (c) **unificar el drift** de nombres de fase entre la BD y
  `lib/crop-cycle.ts`, y (d) **vista** de planificación por fase.
- **Propuesta**: nueva tabla `phase_application_rules` + workflow de eventos
  (siembra/corte) + planning panel fenológico. Mantener la fenología en data
  (no hardcode), como ya se decidió en Fase 4.

---

## 1. Lo que ya existe (reusar, no reinventar)

| Pieza | Dónde | Nota |
|---|---|---|
| `cycles` (1+ por parcela) | `20260905020000_add_cycles_and_events.sql` | `start_date`, `end_date` (NULL = activo), `crop_type`, `variety`, `source`, `data_validity` |
| `cycle_events` | idem | `planting` / `application` / `harvest` / `renovation` |
| `phase_rules` | idem | `crop_type`, `variety`, `day_from`, `day_to`, `phase_name` |
| `current_phase(crop, variety, start_date)` | idem | SQL STABLE, lee `phase_rules` |
| `vw_current_cycle` | idem | ciclo activo + `age_days` + `current_phase_name` |
| `fumigation_categories` | `20260813160000` | **QUÉ** se aplica: herbicida, insecticida, fungicida, fertilizante, acaricida, nematicida, otro |
| `application_types` | `20260824000000` | **PARA QUÉ/momento**: pre_emergente, post_emergente, bioestimulante, otro |
| Lógica TS de fases | `lib/crop-cycle.ts` | `phaseFor`, `cadenceForPhase`, `effectiveCadence` |

### ⚠️ Drift actual a resolver
Los nombres de fase **no coinciden**:
- BD (`phase_rules`): `Establecimiento`, `Desarrollo inicial`, `Desarrollo`, `Maduración`, `Próximo a cosecha` (por días 0-30/31-90/91-180/181-300/301-999).
- TS (`lib/crop-cycle.ts`): `establecimiento`, `vegetativa`, `madurante`, `cosecha` (por meses <3/<9/<12/>12).

Hay que **elegir una sola taxonomía** y alinear ambos lados.

---

## 2. Modelo fenológico propuesto (valores ASUMIDOS)

> Base: caña de azúcar, Valle del Cauca. Fuente: Cenicaña / literatura
> (plantilla se cosecha a los 12-18 meses; soca/retoño cada ~12 meses,
> 3-5 cortes por ciclo de renovación). **Valores asumidos**, ajustables.

### 2.1 Tipos de ciclo
- **Plantilla** (siembra nueva): siembra → 1er corte ≈ **13 meses**.
- **Soca** (retoño tras corte): corte → corte ≈ **12 meses**.

### 2.2 Fases propuestas (una curva, por días desde `start_date`)

| Fase (slug canónico) | Días | Etiqueta UI | Qué pasa |
|---|---|---|---|
| `establecimiento` | 0-45 | Establecimiento | germinación/emergencia, macollaje inicial |
| `amacollamiento` | 46-120 | Amacollamiento | tillering, define población de tallos |
| `vegetativa` | 121-270 | Crecimiento | elongación, máximo consumo de N/K |
| `madurante` | 271-360 | Maduración | acumulación de sacarosa, poco crecimiento |
| `cosecha` | >360 | Cosecha | madurez; **no se fumiga** |

> Simplificación propuesta: una sola curva para plantilla y soca (la
> diferencia se puede agregar después con `cycle_type`). Si se quiere
> distinguir, agregar `cycle_type ('plantilla'|'soca')` a `phase_rules` y
> `cycles`.

### 2.3 Aplicaciones por fase (lo nuevo)

Relación **fase → (categoría × tipo de aplicación) × momento/cadencia**:

| Fase | Categoría | Tipo de aplicación | Momento / cadencia | Nota |
|---|---|---|---|---|
| establecimiento | herbicida | pre_emergente | 1 vez, 0-20 d post-siembra | control de malezas antes de emerger |
| establecimiento | fertilizante | (fondo) | 1 vez, a la siembra | P y K de fondo |
| amacollamiento | fertilizante | (cobertera) | 1 vez, 45-90 d | N de cobertera |
| amacollamiento | herbicida | post_emergente | según malezas | malezas de hoja ancha/angosta |
| amacollamiento | insecticida | (control Diatraea) | **cada 7-10 d por 2-3 meses** | MIPE: liberación *Trichogramma* o químico si >30% |
| vegetativa | insecticida | (salivazo *Mahanarva*) | según monitoreo | cigarrinha de raíces |
| vegetativa | fungicida | (roya/carbón) | según monitoreo | *Puccinia melanocephala*, *Ustilago* |
| madurante | otro | **madurante** | 1 vez, 30-50 d pre-corte | glifosato (ripener) |
| cosecha | — | — | no aplica | no se fumiga |

> `application_types` necesita un slug nuevo: **`madurante`** ("Madurante /
> madurador"), que hoy no existe (solo pre/post/bioestimulante/otro).

---

## 3. Estructura de datos propuesta

### 3.1 Nueva tabla `phase_application_rules`
```
id, crop_type, variety(NULL=all), phase (slug canónico),
category_slug (FK lógica a fumigation_categories.slug),
application_type_slug (FK lógica a application_types.slug, nullable),
cadence_days INT NULL,        -- si se repite; NULL = una vez
window_from_day INT,          -- días desde start_date del ciclo
window_to_day   INT,
is_required BOOLEAN,          -- obligatoria vs "según monitoreo"
notes TEXT
```
- Es **configuración** (data-driven), igual que `phase_rules`. Un cambio
  agronómico no requiere código.
- Se consulta por `(crop_type, phase)`.

### 3.2 Workflow siembra/corte (eventos)
- **Registrar siembra/renovación** → crea un `cycle` nuevo (`start_date`)
  + `cycle_event(planting|renovation)`.
- **Registrar corte** → setea `cycles.end_date`
  + `cycle_event(harvest)`; opcionalmente **abre la soca** (nuevo cycle con
  `start_date = fecha de corte`, `source='system'`).
- API/server actions + UI en la ficha de parcela (botones "Registrar
  siembra", "Registrar corte").

### 3.3 Planificación (reemplaza la vista por cadencia fija)
Por parcela:
1. Fase actual ← `vw_current_cycle.current_phase_name` (días desde start).
2. Aplicaciones requeridas en la fase ← `phase_application_rules`.
3. Última aplicación de cada (categoría/tipo) ← `dji_fumigations`
   (o `cycle_events` application).
4. Estado por aplicación:
   - **Pendiente** (dentro de la ventana y sin registro).
   - **Vencida** (pasó la ventana sin registro).
   - **Al día** (registrada dentro de la ventana).
   - **Según monitoreo** (no rígida).
5. El **PlanningPanel** muestra: parcela → fase → aplicaciones pendientes.

> Las alertas actuales (`overdue`/`due_soon` por 14 d) quedan como
> **señal secundaria** o se retiran; la vista principal pasa a ser por fase.

---

## 4. Impacto (qué se toca)

| Capa | Cambio |
|---|---|
| Schema | Migración: unificar `phase_rules` (slugs/curva) + tabla `phase_application_rules` + seed + `application_types('madurante')` |
| Repos | `getPhaseApplicationRules`, `getCurrentCycleByParcel`, `registerPlanting`, `registerHarvest` |
| API | Endpoints/acciones para eventos + reglas |
| UI | Ficha de parcela (botones siembra/corte + fase + aplicaciones), PlanningPanel fenológico, `/parcelas` columna fase |
| Docs | `FUMIGATION_CADENCE.md` (sección fenológica), `DATA-MODEL.md` |
| Tests | `phaseFor`/reglas (puro), repos (SQL), panel |

---

## 5. Valores asumidos (a confirmar)

| Parámetro | Valor asumido | Se ajusta con |
|---|---|---|
| Duración plantilla | 13 meses | Cenicaña / operador |
| Duración soca | 12 meses | Cenicaña / operador |
| Cortes por renovación | 4-5 | operador |
| Fase establecimiento | 0-45 d | agronomía |
| Fase amacollamiento | 46-120 d | agronomía |
| Fase vegetativa | 121-270 d | agronomía |
| Fase madurante | 271-360 d | agronomía |
| MIPE (Diatraea) | cada 7-10 d por 2-3 meses en amacollamiento | Cenicaña |
| Madurante (glifosato) | 30-50 d pre-corte | Cenicaña |
| Categorías/tipos | los ya cargados + `madurante` | operador |

---

## 6. Preguntas abiertas (para la discusión)

1. **Curva única** plantilla/soca o **distinguir** (`cycle_type`)? (más fiel,
   más complejo).
2. ¿Reemplazamos del todo las alertas de 14 d, o las dejamos como respaldo?
3. ¿Quién mantiene las reglas: el operador (UI) o el dev (migración)?
   (propongo data-driven + UI admin futura).
4. ¿La "aplicación requerida" se basa en categoría (herbicida/insecticida) o
   en el tipo de uso (pre/post/madurante)? (propongo ambos campos).
5. ¿Modelamos **monitoreo** (aplicación "según umbral de plaga") o solo
   calendario por fase? (propongo `is_required=false` para las de monitoreo).
6. ¿Cargamos las reglas por **variedad** (CC 85-92, etc.) o genérico `cana`?

---

## 7. Propuesta de ejecución (cuando se apruebe)

- **Fase A (schema + seed)**: migración `phase_rules` unificada +
  `phase_application_rules` + `application_types('madurante')`. 0.5 día.
- **Fase B (lógica pura + tests)**: `lib/phase-applications.ts`
  (fase → aplicaciones → estado). 0.5 día.
- **Fase C (workflow siembra/corte)**: repo + API + UI ficha. 1 día.
- **Fase D (planning fenológico)**: panel + `/parcelas`. 0.5 día.
- **Fase E (docs)**: `FUMIGATION_CADENCE.md` + `DATA-MODEL.md`. 0.25 día.

> Antes de código: aprobar §2 (fenología) y §5 (valores). El resto es
> mecánico.
