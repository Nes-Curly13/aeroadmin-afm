# Business Architecture Review — AeroAdmin AFM (2026-07-22)

> Revisión de arquitectura de **negocio** (no técnica) del panel administrativo
> AeroAdmin AFM. Enfoque: ¿el producto resuelve el problema real del cliente?
> ¿qué decisiones quedan sin data? ¿qué compliance falta? ¿qué gaps tiene
> el modelo desde la perspectiva de un operador fumigador con drones en
> Valle del Cauca?
>
> Lente: BA senior con experiencia en agtech / SaaS B2B / operaciones de campo.
> NO se tocan temas de implementación. NO se proponen features fuera del
> scope confirmado (no NDVI, no prescripción, no Pix4Dfields, no ODM).

---

## 1. Modelo de negocio inferido

**Tipo de empresa**: operador subcontratado de **fumigación aérea con
drones DJI Agras** que presta servicio a cañeros (y posiblemente
fruticultores) del Valle del Cauca, Colombia. No es una empresa de
software: es una empresa de servicios agrícolas con un panel admin
construido in-house.

**Stack operativo** (inferido de docs, código y de los datos scrapeados):
- **Flota**: 1 dron de survey (M3M, multispectral) + 2 drones fumigadores
  principales (Agras T50) + 1 legacy (Agras T40). 4 drones en total.
- **Operación**: piloto vuela con control remoto + SIM; sync automático a
  DJI SmartFarm; scraper captura; sistema persiste.
- **Personal**: al menos 1 dueño (admin), 1 supervisor, 2-3 pilotos
  (no usan el panel). Mínimo 4 personas. Single contributor de
  software (el mismo user que está leyendo este review).
- **Cobertura de data**: 1.207 fincas scrapeadas, 16.353 vuelos
  acumulados. La operación es **diaria y continua** desde hace años
  ("Agricultura / 4219.31 mu / 6272 sorties / 80183 L" en el último
  periodo scrapeado, ≈ 23 años de operación DJI en cuenta).

**Cómo factura** (alta confianza, no documentado explícitamente):
- **Cobro por ha fumigada**, modelo estándar de fumigación
  subcontratada en Colombia. La unidad de negocio es el área tratada,
  no el vuelo (DJI vende por mu/L/hora, pero la facturación al cañero
  se negocia en hectáreas).
- Precio variable según: tipo de cultivo, topografía, producto
  agroquímico usado, urgencia (lluvia incipiente = prima), volumen
  (descuentos por paquetes).
- **El sistema NO captura nada de esto** (ver §3).

**A quién sirve**:
- Clientes = cañeros medianos/grandes del Valle del Cauca (Cenicaña
  reporta que el 80% de las fincas cañeras del Valle se manejan con
  terceros para fumigación). Probablemente entre 50-200 clientes
  activos al año.
- Decisor del lado cliente: el **administrador de la finca** o el
  **ingeniero agrónomo** del ingenio. El cañero dueño rara vez
  decide; el ingeniero sí.

**Propuesta de valor implícita del producto** (lo que el panel
pretende entregar):
1. **Trazabilidad operativa**: "qué se fumigó, cuándo, con qué dron".
2. **Cumplimiento de cadencia**: "esta parcela debería fumigarse
   cada 14 días; van 18 desde la última; hay que ir".
3. **Visibilidad gerencial**: dashboard con KPIs de operación.

**Lo que el panel NO entrega** (y un operador fumigador profesional
necesita):
- Rentabilidad por cliente / por parcela / por dron.
- Cumplimiento regulatorio (ICA, Aeronáutica Civil).
- Control de inventario de agroquímicos.
- Facturación / cuentas por cobrar.
- Trazabilidad histórica robusta (depende de disciplina manual).
- Calidad del servicio (quejas, satisfacción del cañero).

---

## 2. Decisiones de negocio que el dueño debería poder tomar con esta data

Lista priorizada. Las primeras son las que **ya se pueden tomar con
mínima mejora**; las últimas requieren más captura de data.

### Tier 1 — Decisiones que el dueño YA debería poder tomar (con gaps menores)

| # | Decisión | Data que el sistema ya tiene | Brecha |
|---|---|---|---|
| 1 | **"¿Qué cañero me está debiendo fumigaciones?"** (alertas por cadencia) | `dji_fumigation_schedule.next_due_date` + 1.207 fincas | Solo si el supervisor registró la última fumigación. Para las que no, status = `no_history` (no actionable). |
| 2 | **"¿Cuánta área llevamos fumigada este mes/trimestre?"** | `dji_daily_summaries.area_mu` agregado | OK. Pero el "área fumigada" es la zona tratada, no las hectáreas contratadas — el dueño no sabe si cumplió con el contrato. |
| 3 | **"¿Qué drones están siendo más usados y cuáles están parados?"** | `dji_daily_summaries` + `dji_drone_models` | OK a nivel día. No hay **ROI por dron** (no hay costo operativo ni depreciación). |
| 4 | **"¿Hay días con fumigación anormalmente alta?"** (alertas) | `getAlertLevel` con umbral `area_mu >= 60` o `times >= 80` | OK funcionalmente. Pero los umbrales son **estáticos** — no saben de estacionalidad (zafra vs inter-zafra). |
| 5 | **"¿Qué parcelas se fumigaron esta semana y cuáles no?"** | `dji_daily_summaries` global + fumigaciones manuales por parcela | **Gap crítico**: el roll de DJI es por día-global, no por parcela. El supervisor debe llevar este control a mano. |

### Tier 2 — Decisiones que requieren data nueva (Sprint siguiente)

| # | Decisión | Data que falta |
|---|---|---|
| 6 | **"¿Cuánto le voy a facturar a cada cañero este mes?"** | Precio/ha por cliente + área fumigada por cliente. El sistema no sabe cuánto cobra a quién. |
| 7 | **"¿Cuál es mi margen bruto por ha?"** | Costo de agroquímicos (L usado × precio unitario) + costo operativo (hora-dron + piloto). Sin esto no hay margen. |
| 8 | **"¿Qué agroquímicos tengo en bodega?"** | Stock de inventario + entradas por compra + salidas por fumigación. Hoy solo se loguea `product_used` como texto libre ("Glifosato 1L/ha") en cada fumigación. |
| 9 | **"¿Estoy aplicando dentro de la dosis legal?"** | Catálogo de productos con **dosis máxima permitida por ICA** + alerta si la dosis aplicada la supera. Riesgo regulatorio real. |
| 10 | **"¿Qué clientes son rentables y cuáles no?"** | `clients` table + área fumigada por cliente + precio/ha por cliente. Sin esto el dueño no sabe a quién buscar y a quién dejar. |

### Tier 3 — Decisiones estratégicas (requieren data + proceso)

| # | Decisión | Data que falta |
|---|---|---|
| 11 | **"¿Debería comprar un quinto dron?"** | ROI por dron actual + demanda insatisfecha (clientes potenciales que no se pudieron atender). |
| 12 | **"¿En qué zona geográfica debería expandir?"** | Concentración geográfica de clientes, tiempo de traslado entre fincas, costos logísticos. |
| 13 | **"¿Cuál es la cadencia ÓPTIMA por tipo de cultivo y zona climática?"** | Histórico largo + outcomes (rendimiento, plagas reportadas) + clima. No hay data de outcome. |
| 14 | **"¿Estamos cumpliendo con la regulación de RAC 100 / ICA?"** | Bitácora de vuelo (drone, piloto, condiciones), registro de aplicación (producto, dosis, parcela, fecha, operador). |

---

## 3. Datos que FALTAN para esas decisiones

### 3.1 Datos financieros y comerciales (CRÍTICOS)

| Dato | Por qué falta | Dónde debería vivir | Impacto de no tenerlo |
|---|---|---|---|
| **Precio por ha cobrado al cañero** | No se captura en ningún lado | `clients` (tabla nueva) → `price_per_ha` o `price_per_liter` | El dueño no puede calcular facturación ni comparar clientes |
| **Costo de agroquímico por L** | No se captura | `products` (catálogo) → `cost_per_liter` | No hay margen por fumigación |
| **Costo hora-dron** (depreciación, mantenimiento, baterías) | No se captura | `dji_drone_models` → `hourly_cost` o tabla `operating_costs` | No hay ROI por dron |
| **Costo hora-piloto** | No se captura | `users` (rol piloto) → `hourly_cost` | No hay costo laboral por fumigación |
| **Costo de transporte entre fincas** | No se captura | `clients` o `fumigation_events` → `travel_cost` | No hay margen real (especialmente para fincas lejanas) |
| **Forma de pago / plazo / estado de cuenta** | No se captura | `invoices` (tabla nueva) | El dueño no tiene control de cartera |

### 3.2 Datos regulatorios y de cumplimiento (CRÍTICOS para operar)

| Dato | Por qué falta | Dónde debería vivir | Impacto de no tenerlo |
|---|---|---|---|
| **Registro ICA del producto aplicado** | `product_used` es texto libre | `products` (catálogo) → `ica_registration` | No se puede demostrar cumplimiento ante una visita del ICA |
| **Dosis máxima legal por producto** | No se valida en el form | `products` → `max_dose_l_per_ha` | Riesgo de sanción si se aplica de más |
| **Banda de seguridad / zonas sensibles cercanas** | No se modela | `parcels` → `adjacent_sensitive_zones` (colegios, ríos, apiarios) | Riesgo civil si se fumiga cerca |
| **Matrícula del dron ante Aeronáutica Civil** | No se captura | `dji_drone_models` o `dji_drones` → `civil_aviation_id` | Multa / inmovilización en inspección |
| **Certificación del piloto** (vigencia, tipo) | No se captura | `users` (rol piloto) → `pilot_license`, `license_expiry` | Multa / bloqueo de operación |
| **Plan de vuelo presentado ante Aerocivil** | No se captura | `fumigation_events` → `flight_plan_id` o `flight_plan_filed_at` | Sin esto la operación es informal |
| **Condiciones meteorológicas al volar** | DJI las tiene en `parameter.json` (parcialmente) pero no se persisten | `fumigation_events` → `wind_speed`, `temperature`, `humidity` | Sin seguro no se demuestra "vuelo seguro" |
| **Geolocalización real del área fumigada (no la planeada)** | Solo se captura el plan | `fumigation_events` → `actual_geom` (PostGIS) | Imposible demostrar que se fumigó lo que se cobró |

### 3.3 Datos de operación de campo (IMPORTANTES)

| Dato | Por qué falta | Dónde debería vivir | Impacto |
|---|---|---|---|
| **Piloto que ejecutó el vuelo** | `recorded_by` es texto libre | FK a `users` (rol piloto) | No se puede auditar quién voló qué |
| **Dron usado en el vuelo** | `drone_code_used` es `int` libre, sin FK a catálogo | FK a `dji_drones` o `dji_drone_models` | No se puede hacer trazabilidad dron-evento |
| **Insumos realmente usados (volumen en L)** | `dose_l_per_ha × area` se calcula, pero no se descuenta de inventario | `fumigation_events` → `liters_consumed` con trigger a `inventory_movements` | Inventario nunca cuadra |
| **Hora real de inicio/fin del vuelo** | Solo `duration_minutes` global | `fumigation_events` → `start_at`, `end_at` | No se puede cruzar con bitácora del piloto |
| **Disparador de la fumigación (alerta, calendario, pedido del cañero)** | No se modela | `fumigation_events` → `trigger_source` (cadence / manual / emergency) | No se mide calidad de planificación |
| **Resultado / calidad post-aplicación** | No se captura | `fumigation_events` → `outcome_notes` o tabla `post_application_checks` | No se mejora el servicio |

### 3.4 Datos del cliente (CAÑEROS)

| Dato | Por qué falta | Dónde debería vivir | Impacto |
|---|---|---|---|
| **Tabla `clients` con RUT/NIT, contacto formal, dirección** | `owner_name` y `owner_contact` son texto libre en `parcels` | Tabla nueva `clients` con FK desde `parcels.client_id` | Imposible facturar; imposible hacer cobro coactivo |
| **Historial de quejas del cañero** | `supervisor_notes` existe pero no es trazable por evento | `complaints` o `quality_issues` table | Problemas se pierden; clientes se van sin saber por qué |
| **Zona climática / micro-región** | No se captura | `clients` o `parcels` → `climate_zone` | No se puede ajustar cadencia por clima |
| **Tipo de contrato** (anual, por evento, paquete) | No se captura | `clients` → `contract_type`, `contract_value` | No se mide valor de vida del cliente |

---

## 4. Compliance / regulación

Colombia tiene **al menos 4 capas regulatorias** que afectan directamente
a una empresa de fumigación con drones. El sistema actual no modela
explícitamente ninguna. Esto es un **riesgo operativo real** (no
teórico): una visita del ICA o de Aerocivil encuentra fácilmente
inconsistencias.

### 4.1 ICA (Instituto Colombiano Agropecuario)

**Aplica a**: registro de aplicación de plaguicidas, Buenas Prácticas
Agrícolas (BPA), habilitación de empresas aplicadoras.

**Lo que exige**:
- **Registro de aplicación por evento**: fecha, parcela (lindero +
  coordenadas), producto usado (con registro ICA + número de lote),
  dosis aplicada, operario responsable, condiciones meteorológicas.
  Debe conservarse por **mínimo 2 años** y entregarse al cañero
  en cada ciclo.
- **Habilitación de la empresa aplicadora**: demostrar que tiene
  personal capacitado, equipos calibrados, registro de clientes.
- **Catastro de fincas atendidas**: para notificación a la
  autoridad sanitaria en caso de intoxicación.

**Gap en AeroAdmin**: el form de fumigación tiene `product_used`
(texto libre) y `dose_l_per_ha` (número) — captura lo mínimo. Pero
**no se puede exportar el registro de aplicación** en el formato
que pide el ICA, **no hay catálogo de productos con número de
registro ICA**, y **no se firma digitalmente** el registro.

**Riesgo**: una visita del ICA pidiendo el registro del último mes
implica generar 100+ PDFs a mano, o explicar por qué el sistema no
lo tiene.

### 4.2 Aeronáutica Civil de Colombia (Aerocivil) — RAC 100

**Aplica a**: operación de RPAS (Remotely Piloted Aircraft Systems),
incluye drones fumigadores. Colombia es más estricta que otros
países de la región.

**Lo que exige**:
- **Registro del dron** (matrícula) ante Aerocivil.
- **Licencia del piloto** vigente (RPAS).
- **Plan de vuelo** para cada operación con coordenadas del polígono
  a tratar, altura, horario, condiciones.
- **Bitácora de vuelo**: dron, piloto, fecha, hora, duración,
  condiciones meteorológicas, observaciones.
- **Seguro de responsabilidad civil** (en revisión, pero ya se exige
  en algunas operaciones).
- **Notificación previa** a autoridades locales en zonas cercanas
  a aeropuertos o населенные centros.

**Gap en AeroAdmin**: el sistema tiene `dji_drone_models` con un
código, pero **no hay matrícula del equipo**, **no hay datos del
piloto** (nombre, licencia, vencimiento), **no hay plan de vuelo
presentado**, **no hay bitácora de vuelo**. El `recorded_by` del
form es texto libre, no FK a `users`.

**Riesgo**: sanción, inmovilización de equipo, suspensión de
operación. Una visita de Aerocivil revisa estos documentos y
multa si no están.

### 4.3 Ministerio de Ambiente / Autoridades ambientales regionales

**Aplica a**: aplicación de agroquímicos cerca de fuentes de agua,
áreas protegidas, zonas de apicultura, escuelas, asentamientos.

**Lo que exige**:
- **Bandas de seguridad** mínimas (típicamente 10-50 metros según
  producto y zona).
- **Franjas de no aplicación** documentadas.
- **Permisos especiales** para aplicaciones cerca de áreas
  ambientalmente sensibles.

**Gap en AeroAdmin**: **no se modelan zonas sensibles adyacentes a
la parcela**. Si la finca del cañero A colinda con un apiario o
una escuela, el sistema no sabe. Esto es responsabilidad civil
directa: si se fumiga y mueren abejas, hay demanda.

### 4.4 Habeas Data / Protección de datos (Ley 1581 de 2012)

**Aplica a**: tratamiento de datos personales del cañero y del
piloto.

**Gap en AeroAdmin**: `owner_name` y `owner_contact` (nombre y
contacto del propietario de la finca) se guardan **sin evidencia
de consentimiento**. La ley exige que se documente el aval del
titular para almacenar y usar esos datos.

**Riesgo**: bajo en la práctica para datos de contacto comercial,
pero acumulable con la superintendencia de industria y comercio.

### 4.5 Resumen de prioridad regulatoria

| Regulación | Esfuerzo de cumplimiento | Riesgo de no cumplimiento | Prioridad |
|---|---|---|---|
| Registro de aplicación ICA | M (catálogo productos + export) | Multa ICA + pérdida de habilitación | **Alta** |
| Bitácora de vuelo Aerocivil | M (tabla nueva + bitácora por vuelo) | Inmovilización de drones + multa | **Alta** |
| Bandas de seguridad ambiental | L (tabla simple) | Demanda civil | Media |
| Habeas Data | XS (checkbox de consentimiento) | Multa superintendencia | Baja |

---

## 5. Errores / discrepancias del modelo de datos

### 5.1 `product_used` como texto libre

**Dónde**: `dji_fumigations.product_used` (`VARCHAR(200)`).

**Problema**: el form tiene placeholder "ej. Glifosato 1L/ha" —
**incluye la dosis en el nombre del producto**. Un supervisor
puede escribir "Glifosato 1L/ha" y otro puede escribir "Roundup
1.5L/ha" para el mismo producto a dosis distintas. No se puede
agregar ni comparar, no se puede calcular costo, no se puede
cruzar con registro ICA.

**Lo que debería ser**:
- Tabla `products` con `id, name, ica_registration, max_dose_l_per_ha, cost_per_liter, unit, safety_band_m`.
- `dji_fumigations.product_id` como FK.
- Dosis en columna propia (`dose_l_per_ha` ya existe).
- Inventario: `inventory_movements(product_id, delta_l, reason, ref_event_id)`.

### 5.2 `owner_name` y `owner_contact` como texto libre en `parcels`

**Dónde**: `dji_parcels.owner_name`, `owner_contact`.

**Problema**: el mismo cañero con 5 fincas aparece 5 veces con
posibles variantes de escritura ("Finca La Esperanza" / "La
Esperanza" / "Esperanza"). No se puede agrupar, no se puede
facturar, no se puede medir "mis 10 principales clientes".

**Lo que debería ser**:
- Tabla `clients(id, name, nit, primary_contact_phone, primary_contact_email, address, contract_type, created_at)`.
- `dji_parcels.client_id` como FK.

### 5.3 `recorded_by` como texto libre

**Dónde**: `dji_fumigations.recorded_by` (`VARCHAR(100)`).

**Problema**: "Juan Pérez" puede ser cualquier Juan Pérez. No
hay forma de saber qué fumigaciones hizo cada piloto, no se
puede medir productividad individual, no se puede hacer la
bitácora de vuelo que pide Aerocivil.

**Lo que debería ser**:
- Tabla `users` con roles (`admin`, `supervisor`, `pilot`).
- `dji_fumigations.recorded_by_user_id` como FK.
- El piloto debería seleccionarse de un dropdown con usuarios
  del rol `pilot`.

### 5.4 `drone_code_used` como `int` libre

**Dónde**: `dji_fumigations.drone_code_used`.

**Problema**: el form lo permite, pero no se valida contra
`dji_drone_models`. Un supervisor puede escribir 999 y la BD
lo acepta.

**Lo que debería ser**:
- Tabla `dji_drones(id, model_code FK to dji_drone_models, civil_aviation_id, serial, status, acquired_at, hourly_cost)`.
- `dji_fumigations.drone_id` como FK (no el código del modelo,
  sino la unidad física).

### 5.5 Fumigaciones reales (de DJI) NO se linkean a parcelas

**Dónde**: `dji_daily_summaries` es por día-globales. No tiene
`parcel_id`.

**Problema**: DJI te dice "el 2026-05-28 se fumigaron 67.95 mu
en 82 sorties usando 840.3 L", pero **no te dice de cuáles
parcelas**. El dueño no puede decir "esta semana fumigué las
parcelas X, Y, Z" sin que el supervisor lo cargue a mano.

**Consecuencia**: el sistema depende de disciplina humana. Si el
supervisor no carga, la cadencia aparece como "no_history" para
todo. **El 80% del valor del sistema depende del supervisor
sentándose a registrar eventos**.

**Lo que debería ser**:
- Tabla `dji_fumigations_actual(parcel_id, date, area_m2, product_liters, drone_id, duration_seconds)` poblada por matching espacial entre el roll diario y la geometría de las parcelas (las geometrías ya están en PostGIS, el `ST_Intersects` resuelve el 90% de los casos).
- Esto **no requiere tecnología nueva** (no es Pix4Dfields, no es NDVI); es PostGIS point-in-polygon sobre geometrías que ya existen.

### 5.6 La cadencia recomendada es estática (14d caña, 10d orchard)

**Dónde**: `lib/fumigation-cadence.ts` con `CADENCE_DEFAULTS`
hardcoded.

**Problema**: en caña de azúcar, la cadencia cambia según la
etapa del cultivo (plantilla = cada 30 días, soca = cada 14-21
días, renovación = sin fumigación). En orchard cambia según
la floración o la temporada de lluvias. Una cadencia estática
**sobrestima fumigaciones en plantilla** y **subestima en
zafra**.

**Lo que debería ser**:
- Tabla `cadence_rules(crop_type, growth_stage, climate_zone, recommended_cadence_days, valid_from, valid_to)`.
- Lookup por `(parcel.crop_type, parcel.growth_stage, parcel.climate_zone)`.
- El sistema ya tiene `crop_type` y `planting_date` en parcels — falta `growth_stage` (que se puede derivar de `planting_date` con reglas simples).

### 5.7 No hay modelo de "incidencia" / "queja"

**Dónde**: no existe.

**Problema**: si un cañero reclama que se fumigó mal, no quedó
el producto, se dañó un cultivo cercano, etc., no hay registro.
El supervisor lo pone en `supervisor_notes` y se pierde.

**Lo que debería ser**:
- Tabla `incidents(id, parcel_id, reported_by, type, severity, description, resolved_at, resolution_notes)`.
- Vinculable a `fumigation_events` (`fumigation_event_id`).
- Reporte de "incidencias por cliente por trimestre" para el dueño.

### 5.8 Catálogo de productos agroquímicos ausente

**Dónde**: no existe.

**Problema**: el sistema no tiene cómo saber "qué productos
están registrados ante el ICA", "cuál es la dosis máxima legal
de Glifosato en caña", "qué productos no se pueden usar cerca
de apiarios". El supervisor escribe cualquier cosa.

**Lo que debería ser**:
- Catálogo curado (no exhaustivo) con los 10-30 productos que
  realmente usa la empresa, con `ica_registration`, `max_dose`,
  `safety_band`, `withholding_period_days`, `cost_per_liter`.
- El form de fumigación elige de este catálogo, no es texto
  libre.

### 5.9 No hay versioning ni auditoría de cambios

**Dónde**: no hay tabla `audit_log`.

**Problema**: si un supervisor cambia la cadencia de una
parcela, no queda registro de quién la cambió, cuándo, ni el
valor anterior. Si el dueño pregunta "¿quién me subió el
precio del cañero X?", no hay forma de saberlo.

**Lo que debería ser**:
- Tabla `audit_log(id, table_name, row_id, operation, changed_by, changed_at, before, after)`.
- Trigger en todas las tablas editables.
- Vista de "cambios de cadencia últimos 30 días".

---

## 6. Mejoras priorizadas (5-8)

Criterio de priorización: **valor de negocio para el dueño / supervisor
× esfuerzo de implementación**. Asumo que el equipo de desarrollo
sigue siendo 1 persona.

### P1 — Tabla `clients` + relación con `parcels` (S, ~1 sprint)

**Valor**: habilita 5 de las decisiones Tier 2 (facturación,
rentabilidad por cliente, ranking de clientes, contacto formal,
Habeas Data documentado).

**Cambio mínimo**:
- Crear `clients` table.
- Migrar `owner_name` y `owner_contact` desde `dji_parcels` a
  `clients` (1 fila por cañero único, con heurística de matching).
- FK `dji_parcels.client_id → clients.id`.
- UI: nueva página `/clients` con listado + drill-down a sus
  parcelas + estado de cuenta básico.

**Lo que NO hace**: no captura precio/ha por cliente. Eso es
P3.

### P2 — Catálogo de productos + dosis legal + costo (M, ~1.5 sprints)

**Valor**: habilita cumplimiento ICA, control de inventario
embrionario, cálculo de margen, alerta de sobredosis.

**Cambio mínimo**:
- Tabla `products` con catálogo curado de 10-30 productos
  (input del supervisor, validado por el dueño).
- `dji_fumigations.product_id` como FK.
- Validación server-side: `dose_l_per_ha <= product.max_dose_l_per_ha`
  (warning, no bloqueante en MVP).
- `product.cost_per_liter` para cálculo de costo por fumigación.
- El form cambia de input de texto a dropdown con búsqueda.

**Lo que NO hace**: inventario propiamente dicho (entradas/salidas
con stock). Eso es P5.

### P3 — Precios y costos por evento de fumigación (S, ~1 sprint)

**Valor**: **esta es la mejora que habilita TODAS las decisiones
financieras**. Sin esto no hay facturación, no hay margen, no
hay ROI.

**Cambio mínimo**:
- `clients.price_per_ha` (cobrado al cañero).
- `fumigation_events.cost_chemicals` (calculado: liters ×
  product.cost_per_liter).
- `fumigation_events.cost_drone` (calculado: duration_minutes ×
  drone.hourly_cost / 60).
- `fumigation_events.cost_labor` (calculado: hours × pilot.hourly_cost).
- Nuevo KPI en dashboard: "Margen bruto del mes" =
  Σ(area_ha × price_per_ha) − Σ(cost_chemicals + cost_drone + cost_labor).
- Endpoint nuevo `/api/reports/profitability?from=&to=` para drill-down.

**Trade-off conocido**: requiere que el dueño invierta tiempo
en cargar precios y costos. Es el costo de tener data financiera
real. Sin esto, el panel es "bonito pero no rentable".

### P4 — Registro de aplicación ICA exportable (S, ~1 sprint)

**Valor**: cumplimiento regulatorio. Reduce riesgo de multa y
es un deliverable concreto que el dueño le puede dar al cañero.

**Cambio mínimo**:
- Endpoint `GET /api/reports/applicacion-ica?parcel_id=&from=&to=`
  que devuelve PDF o CSV con: parcela, fecha, producto
  (con número de registro ICA), dosis, operario, condiciones
  (si están), lindero.
- Botón "Descargar registro ICA" en `parcels/[id]/page.tsx`.
- Acumula fumigaciones reales (las del supervisor) + las reales
  de DJI (si P8 está).

**Lo que NO hace**: la firma digital del registro. Eso es
una capa legal que se delega al ERP / software de facturación.

### P5 — Inventario de agroquímicos (M, ~2 sprints)

**Valor**: control de bodega, evita compras de último momento,
permite calcular `cost_of_goods_sold` real.

**Cambio mínimo**:
- Tabla `inventory_movements(product_id, delta_l, reason, ref_event_id, occurred_at)`.
- Cuando se crea una fumigación con `product_id`, trigger
  automático: `INSERT INTO inventory_movements(-liters, 'fumigation', event_id)`.
- UI de bodega: stock actual por producto, alertas de stock bajo,
  entradas manuales por compra.

### P6 — Bitácora de vuelo Aerocivil (M, ~1.5 sprints)

**Valor**: cumplimiento regulatorio. Sin esto, una inspección
de Aerocivil inmoviliza la flota.

**Cambio mínimo**:
- Tabla `flight_logs(id, drone_id, pilot_user_id, parcel_id, planned_at, started_at, ended_at, weather_summary, observations, flight_plan_id)`.
- Tabla `pilots` (extensión de `users` con `license_number`, `license_expiry`, `medical_certificate_expiry`).
- Tabla `drones` con `civil_aviation_registration`.
- UI mínima: el supervisor crea la bitácora al cierre de cada
  jornada. Exportable a PDF.

**Trade-off**: requiere disciplina de captura. La alternativa
"se hace a mano en Excel" es la actual; el valor del sistema
es que se hace desde la app y queda consistente con el resto.

### P7 — Cadencia por etapa de cultivo (S, ~1 sprint)

**Valor**: predicciones más precisas, evita fumigaciones
innecesarias en plantilla, mejora la confiabilidad del
"KPIs Atrasadas por cadencia".

**Cambio mínimo**:
- Tabla `cadence_rules(crop_type, growth_stage, recommended_cadence_days)`.
- Reglas para caña: plantilla 30d, soca joven 21d, soca
  madura 14d, pre-cosecha sin fumigación.
- Reglas para orchard: floración 21d, llenado 14d, maduración
  10d (placeholder — requiere input del agrónomo).
- Lookup desde `fumigation-cadence.ts`.

### P8 — Matching espacial de fumigaciones DJI a parcelas (L, ~3 sprints)

**Valor**: **el cambio de mayor impacto operacional**. Deja
de depender de disciplina manual. La cadencia se calcula
automáticamente con data real.

**Cambio mínimo**:
- Para cada `dji_daily_summaries` row, hacer `ST_Intersects`
  con la `dji_parcels.spray_geom` y atribuir las sorties/L a
  las parcelas que intersectan el centroide del flight path
  (que DJI expone en `flight_record_responses.json`).
- Tabla `dji_fumigations_actual(parcel_id, date, area_m2,
  liters, drone_model_code, duration_seconds, source='djiag-match')`.
- UI: en la hoja de vida del lote, mostrar fumigaciones
  detectadas automáticamente + fumigaciones manuales del
  supervisor en una sola timeline.

**Riesgo**: el matching no es 100% preciso. Los vuelos DJI
vienen sin lindero; el match es por spray zone. Aceptar
~85% de precisión como MVP y refinar con feedback del
supervisor.

---

## 7. Lo que NO se debe hacer

Decisiones tentadoras que el dueño o el developer pueden proponer,
pero que **rompen el foco del producto** o son **claramente fuera
de scope** dado el tamaño de la operación (1 empresa, 4 drones,
single contributor dev).

### NO hacer multi-tenant

**Tentación**: "si el panel funciona bien, lo vendemos como SaaS
a otros fumigadores del Valle".

**Por qué NO**:
- El modelo de datos, la cadencia, los productos ICA, la
  regulación son **específicos de Colombia / caña**. SaaS
  a otros fumigadores colombianos tiene sentido, pero
  requiere 3-6 meses de trabajo de re-modelado (RBAC por
  tenant, schema por tenant, billing, onboarding).
- El scope actual ya está al límite de 1 persona.
- Antes de multi-tenant: primero，巩固 lo que hay.

**Cuándo reconsiderar**: si el dueño decide que la empresa
pivota a "software para fumigadores" (no "fumigador con software"),
ahí se justifica. Hoy, no.

### NO agregar app móvil para cañeros

**Tentación**: "los cañeros deberían poder ver sus fincas".

**Por qué NO**:
- Los cañeros no pidieron eso. El supervisor es el punto de contacto.
- Una app para cañeros requiere: auth, onboarding por cliente,
  soporte, multi-tenant, GDPR local. Es 10× el esfuerzo actual.
- El dueño puede mandar un PDF del registro ICA por WhatsApp.
  Eso resuelve el 90% del valor para el cañero.

### NO integrar Pix4Dfields, NDVI, prescripción, ODM

**Confirmado por el dueño**: fuera de scope. Razón válida:
- El modelo de negocio es **fumigación**, no **agricultura de
  precisión**. El cañero ya tiene su agrónomo o su proveedor
  de imágenes (a menudo Pix4Dfields o similar). No es
  diferenciador de este producto.
- Imágenes satelitales son **caras y frágiles** (APIs, storage,
  procesado). Single contributor no soporta.
- La prescripción depende de agrónomo, no de fumigador.

**Si el dueño cambia de opinión**: que sea un nuevo producto
separado, no una feature de AeroAdmin.

### NO agregar predicción meteorológica

**Tentación**: "el panel debería mostrar el clima de los
próximos 3 días para no salir a fumigar bajo lluvia".

**Por qué NO**:
- El piloto ya tiene app de clima. No es diferenciador.
- Las APIs de clima son ruidosas y agregan dependencia
  externa.
- Si vale la pena, un link a OpenWeatherMap en la página
  de fumigation es 30 minutos de trabajo; no construir un
  sistema de predicción.

### NO migrar a un sistema de facturación

**Tentación**: "el panel debería poder facturar".

**Por qué NO**:
- AeroAdmin es un **panel admin / GIS**, no un ERP. La
  facturación electrónica en Colombia requiere
  certificación DIAN, integración con proveedor autorizado,
  manejo de retenciones, IVA, etc. Es otro producto.
- Lo que sí puede hacer: **exportar a CSV/PDF los datos
  necesarios para que el dueño facture desde su software
  contable actual** (Siigo, Helena, etc.). Eso es 1 sprint.

### NO agregar chat / mensajería con el cañero

**Tentación**: "los cañeros quieren WhatsApp directo desde el
panel".

**Por qué NO**:
- WhatsApp Business API cuesta plata y requiere número dedicado.
- Los cañeros ya usan WhatsApp directamente. La fricción de
  aprender otro canal es peor que el beneficio.
- Si vale la pena: un botón "Compartir por WhatsApp" que abre
  wa.me con un mensaje pre-armado (PDF del registro ICA +
  próxima fumigación). Eso es 1 hora de trabajo.

### NO agregar login para cañeros (RBAC más fino)

**Tentación**: "los cañeros también deberían entrar al panel".

**Por qué NO**:
- Hoy hay 2 roles: admin y supervisor. Suficiente.
- Multi-rol con cañero requiere: onboarding, recuperación
  de contraseña, soporte, multi-tenant. Escala exponencialmente.
- Si el dueño quiere dar visibilidad al cañero: PDF/CSV
  compartido. No es lo mismo pero es 1% del esfuerzo.

### NO hacer el panel en tiempo real (websockets, push, etc.)

**Tentación**: "el dashboard debería actualizarse en vivo".

**Por qué NO**:
- La cadencia de fumigación es **diaria**. Un dashboard que
  actualiza cada 60 segundos no aporta más que uno que
  actualiza cada 5 minutos.
- La data viene de un cron (no de eventos). Forzar real-time
  requiere repensar el pipeline entero.
- El `revalidate` de Next + cache de 60s en overdue / upcoming
  es suficiente.

### NO reemplazar el cliente Playwright por AirData Enterprise

**Confirmado en DJIAG_AUDIT.md**: el cliente no paga. Y aunque
pagara, migrar a AirData es 1-2 sprints de trabajo sin valor
funcional nuevo (mismos datos, distinto proveedor).

### NO reescribir el frontend en otro framework

El stack (Next 16 + React 19 + Tailwind 4 + Leaflet) está
sólido. Replatformar (a SvelteKit, a Astro, a lo que sea) es
**6 meses de trabajo sin valor de negocio**. La deuda que hay
(cleanup de UI legacy, métricas reales) es gestionable.

---

## Apéndice: lo que el sistema YA hace bien (reconocimiento)

Antes de cerrar, vale destacar que **varias decisiones críticas
ya están bien resueltas** y no hay que tocarlas:

1. **Trazabilidad operativa día-a-día** funciona: el panel sabe
   qué se fumigó cada día, en qué cantidad, con cuánto
   producto. Eso es el 60% del valor de cualquier sistema
   admin de fumigación.

2. **Detección de anomalías** (alertas) está bien: los umbrales
   de HIGH (60 mu / 80 sorties) son razonables y están
   centralizados en `getAlertLevel`.

3. **Hoja de vida del lote** (parcels/[id]) es **muy completa**
   para el estándar de la industria: crop_type, planting_date,
   owner, parámetros de aspersión, geometría, waypoints, plan
   de vuelo, cadencia, fumigaciones manuales. Es el mejor
   componente del producto.

4. **Modelo de cadencia** (fumigation-cadence.ts) está bien
   diseñado: pura, testeable, con defaults conservadores
   documentados. Solo falta parametrizar por etapa (P7).

5. **Resiliencia del pipeline** (sprint 2026-07-22): health
   endpoint, circuit breaker, race fix. Esto es **crítico**
   para un sistema que depende de una API no documentada.

6. **Single source of truth** (post-Q1): el KPI de alertas
   altas y el panel de alertas ahora derivan del mismo set
   de datos. Eso es disciplina que se ve.

7. **Específicidad de Colombia**: español de Colombia, formato
   de área en ha, unidades consistentes. No se nota pero
   importa.

El producto tiene una base sólida. Las mejoras propuestas en §6
son **extensiones naturales** sobre lo que ya está, no reemplazos.

---

## Changelog de este review

- **2026-07-22** — Compilado por BA senior (Mavis, sesión
  general). Análisis de 1 pasada. Enfoque: ¿qué decisiones
  de negocio quedan sin data? ¿qué compliance falta? ¿qué
  gaps de modelo?
