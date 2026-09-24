# Registro de ejecución de pruebas — PLANTILLA

> **Cómo usar:** copiá este archivo a `docs/PRUEBAS-REGISTRO-<YYYY-MM-DD>.md` y completá
> las tablas. Complementa `docs/PLAN-PRUEBAS-FUNCIONALIDAD-USABILIDAD.md` (casos §5 y
> guion §6) y `docs/PRUEBAS-EJECUCION-2026-09-23.md` (resultados automatizados).
>
> Leyenda resultado: **P** = Pasa · **F** = Falla · **B** = Bloqueado · **NE** = No ejecutado.

---

## 0. Datos de la sesión

| Campo | Valor |
|---|---|
| Fecha / hora | |
| Ejecutor (nombre / rol) | |
| Ambiente | local · staging · prod |
| Commit / SHA (`git rev-parse --short HEAD`) | |
| Versión de la app | |
| Navegador / SO | |
| Dataset | nº parcelas: ___ · nº fumigaciones: ___ |
| Usuario(s) de prueba | admin: ___ · supervisor: ___ |
| Notas del entorno | |

---

## 1. Registro de casos funcionales (§5 del plan)

Completá **Resultado** y **Evidencia** (captura, video, nota, issue#).

### AUTH / ROLES

| ID | Caso | Resultado | Evidencia / nota |
|---|---|---|---|
| AUTH-01 | Login con credenciales válidas | | |
| AUTH-02 | Login con password incorrecto | | |
| AUTH-03 | Logout | | |
| AUTH-04 | Supervisor entra a `/admin/*` (bloqueado) | | |
| AUTH-05 | Sin sesión a ruta privada → `/login` | | |
| AUTH-06 | `/login` sin shell/sidebar | | |

### DASHBOARD (`/`)

| ID | Caso | Resultado | Evidencia / nota |
|---|---|---|---|
| DASH-01 | Carga inicial (KPIs, tendencia, planificación) | | |
| DASH-02 | Filtro por período | | |
| DASH-03 | Empty state sin datos | | |
| DASH-04 | Error con reintento | | |
| DASH-05 | Planes vencidos accionables | | |

### PARCELAS (`/parcelas`, `/parcelas/[id]`)

| ID | Caso | Resultado | Evidencia / nota |
|---|---|---|---|
| PARC-01 | Listado completo con sort/filtros/paginación | | |
| PARC-02 | Búsqueda/filtro + "Limpiar" | | |
| PARC-03 | Detalle de parcela | | |
| PARC-04 | Crear parcela (3 secciones) | | |
| PARC-05 | Crear sin geometría (bloquea) | | |
| PARC-06 | ID inexistente → 404 | | |
| PARC-07 | Export PDF/CSV (admin) | | |
| PARC-08 | Nombre/coordenadas largas | | |

### CICLO / FASE (cadencia — uso en campo)

| ID | Caso | Resultado | Evidencia / nota |
|---|---|---|---|
| CIC-01 | Asignar fecha de siembra (iniciar ciclo) | | |
| CIC-02 | Registrar corte (cerrar ciclo) | | |
| CIC-03 | `end_date < start_date` rechazado | | |
| CIC-04 | Actualizar fecha de siembra/corte en campo | | |
| CIC-05 | Ciclo sin `phase_rule` (UI lo indica) | | |
| CIC-06 | Fumigación en ciclo cerrado (invariante) | | |
| CIC-07 | Reglas fitosanitarias: editar ventana/cadencia | | |

### FUMIGACIONES (`/fumigaciones`, `/nueva`, `/[id]`, `/[id]/editar`)

| ID | Caso | Resultado | Evidencia / nota |
|---|---|---|---|
| FUM-01 | Listado con filtros server-side | | |
| FUM-02 | Wizard — Importar vuelo DJI (registra) | | |
| FUM-03 | Wizard — Manual | | |
| FUM-04 | Volver desde Confirm preserva datos | | |
| FUM-05 | Submit sin requeridos (validación) | | |
| FUM-06 | Detalle (datos, vuelos, mapa, facturas, audit) | | |
| FUM-07 | Editar (PATCH sparse) | | |
| FUM-08 | Eliminar (soft-delete) con AlertDialog | | |
| FUM-09 | Bulk borrar / categoría con AlertDialog | | |
| FUM-10 | Facturas: crear / cancelar | | |
| FUM-11 | Asignar parcela a huérfana | | |
| FUM-12 | Huérfana con badge "Sin asignar" | | |

### GEOVISOR (`/geovisor`)

| ID | Caso | Resultado | Evidencia / nota |
|---|---|---|---|
| GEO-01 | Carga map-first (mapa dominante) | | |
| GEO-02 | Búsqueda de parcela | | |
| GEO-03 | Rango temporal | | |
| GEO-04 | Capas y basemap | | |
| GEO-05 | Selección de evento → Inspector | | |
| GEO-06 | Toggles de filtros/eventos | | |
| GEO-07 | Parcela seleccionada (contexto) | | |
| GEO-08 | Persistencia de boxes (localStorage) | | |
| GEO-09 | Falla de carga del mapa (estado de error) | | |

### REPORTES (`/reportes`)

| ID | Caso | Resultado | Evidencia / nota |
|---|---|---|---|
| REP-01 | 2 tabs (Operativo / Resumen por parcela) | | |
| REP-02 | Filtros de rango | | |
| REP-03 | Export CSV/PDF (admin) | | |

### ADMINISTRACIÓN (`/admin/*`)

| ID | Caso | Resultado | Evidencia / nota |
|---|---|---|---|
| ADM-01 | `/admin` landing | | |
| ADM-02 | `/admin/parcels` búsqueda server-side | | |
| ADM-03 | `/admin/parcels` edición inline + guardar | | |
| ADM-04 | `/admin/parcels/new` + import GIS | | |
| ADM-05 | `/admin/reglas-fitosanitarias` CRUD + restore | | |

### Transversales (a11y / estados / responsive)

| ID | Caso | Resultado | Evidencia / nota |
|---|---|---|---|
| X-01 | Navegación por teclado (foco, Escape) | | |
| X-02 | Estados loading/empty/error | | |
| X-03 | Responsive 320 / 768 / 1024 / 1440 | | |
| X-04 | Overlays accesibles (Dialog/AlertDialog/Sheet) | | |
| X-05 | Color no como único indicador | | |

---

## 2. Guion de usabilidad (§6)

### 2.1 Participantes

| P# | Perfil | Nombre/código | Experiencia | Consentimiento | Notas |
|---|---|---|---|---|---|
| P1 | Operador fumigador | | | ☐ | |
| P2 | Operador fumigador | | | ☐ | |
| P3 | Supervisor | | | ☐ | |
| P4 | Admin/topógrafo | | | ☐ | |

### 2.2 Resultados por tarea

| Tarea | P# | Éxito (S / con ayuda / N) | Tiempo (s) | Errores | Ayuda requerida | Comentarios |
|---|---|---|---|---|---|---|
| T1 Registrar fumigación desde vuelo DJI | | | | | | |
| T2 Registrar fumigación manual | | | | | | |
| T3 Asignar parcela a huérfana | | | | | | |
| T4 Consultar histórico en geovisor | | | | | | |
| T5 Actualizar fecha de siembra/corte en campo | | | | | | |
| T6 Crear parcela dibujando polígono | | | | | | |
| T7 Generar reporte | | | | | | |
| T8 Registrar corte / cerrar ciclo | | | | | | |

### 2.3 SUS — System Usability Scale

Escala 1 (muy en desacuerdo) a 5 (muy de acuerdo). Ítems impares = positivos; pares = negativos.

| # | Ítem | P1 | P2 | P3 | P4 |
|---|---|---|---|---|---|
| 1 | Me gustaría usar este sistema con frecuencia | | | | |
| 2 | Encontré el sistema innecesariamente complejo | | | | |
| 3 | Pensé que el sistema era fácil de usar | | | | |
| 4 | Creo que necesitaría ayuda técnica para usarlo | | | | |
| 5 | Encontré las funciones del sistema bien integradas | | | | |
| 6 | Pensé que había demasiada inconsistencia | | | | |
| 7 | Imagino que la mayoría aprendería a usarlo rápido | | | | |
| 8 | Encontré el sistema muy difícil de usar | | | | |
| 9 | Me sentí muy seguro usando el sistema | | | | |
| 10 | Necesité aprender muchas cosas antes de empezar | | | | |
| | **Puntaje SUS (0–100)** | | | | |

> Cálculo SUS por participante: para ítems impares usar `(valor − 1)`; para pares `(5 − valor)`.
> Sumar los 10 y multiplicar por **2.5**. Promedio del grupo: media de los puntajes.
> Umbral objetivo: **≥ 68**.

### 2.4 Síntesis cualitativa (preguntas abiertas)

- ¿Qué fue lo más confuso?
- ¿Qué faltó?
- ¿Lo usarías en campo? ¿Por qué?
- Citas destacadas (P#, tarea):
- Oportunidades de mejora priorizadas:

---

## 3. Matriz de trazabilidad (objetivos → casos → resultado)

| Objetivo (OE) | Capacidad | Casos del plan | Resultado | Evidencia |
|---|---|---|---|---|
| OE1 | Estructuración (PostGIS, esquema, jerarquía) | ADM-02/03/04, PARC-03 | | |
| OE2 | Gestión / visualización / planificación | AUTH, DASH, PARC, GEO, REP, ADM | | |
| OE3 | Flujo campo → sistema (carga/actualización) | FUM-02/07, CIC-01/02/04 | | |
| OE4 | Documentación + capacitación (walkthrough) | T1–T8 (usabilidad) | | |

---

## 4. Registro de issues

| # | Severidad (P0–P3) | Descripción | Caso | Estado | Responsable |
|---|---|---|---|---|---|
| 1 | | | | | |

---

## 5. Cierre

- Criterios de salida (§7 del plan) cumplidos: ☐ Sí ☐ No
- Casos H aprobados: ___ / ___ · Casos E/N documentados: ___
- Bugs P0/P1 abiertos: ___
- SUS promedio: ___ (umbral ≥ 68)
- Observaciones finales:
- Ejecutor / fecha:
