# T-CAP-01 — OE4: Manual del operador + capacitacion + onboarding + DR

> **Origen**: gap analysis del objetivo general del proyecto (3.1 OE4:
> "Documentar y capacitar al personal de la empresa en el uso del SIG
> implementado para garantizar su sostenibilidad"). Master actual
> `fa1fb89` (2218/2218 tests verde, RC funcional, **sin documentacion
> para el operador fumigador**).
>
> **Audiencia**: operador fumigador del Valle del Cauca, **NO es dev**.
> Idioma: espanol. Tono: par tecnico-cañero (medidas en ha, litros/ha,
> "lotes" en vez de "parcels" cuando aplica). Cero jerga interna
> ("FK", "endpoint", "migration", "JWT") sin explicar.
>
> **Como usar este doc**:
> 1. Leelo entero antes de asignar la tarea a un agente.
> 2. Decidi: **un solo agente** (consistencia de voz) o **cuatro agentes
>    en paralelo** (velocidad). Ver §6.
> 3. Asignar a un agente con el scope exacto (§2) y las acceptance
>    criteria (§3).
> 4. Validar con el operador fumigador real (vos) antes de marcar
>    "listo".

---

## 0. Por que este task existe

**Hoy**: el sistema funciona, los tests estan verdes, el operador fumigador
tiene usuario (`admin@aeroadmin.local`). Pero:

- No hay manual de usuario en espanol.
- No hay onboarding ("primer dia: login; segundo dia: primer fumigacion").
- No hay plan de mantenimiento del operador (que hacer cuando cambia de
  dron, se agrega una finca, DJI cambia su API, etc.).
- No hay disaster recovery del operador (que hacer cuando la BD esta
  caida, el dron no sube data, se pierde conexion).

**Resultado actual**: el single-contributor es el unico que sabe operar
el sistema. Si se va, el operador fumigador queda varado. Eso rompe el
OE4 textual del objetivo general.

**Cierre OE4** = T-CAP-01 hecho + operador fumigador capacitado + DR
probado al menos una vez.

---

## 1. Resumen de la tarea

| Campo | Valor |
|---|---|
| ID | **T-CAP-01** |
| Sev | **ALTO** (es lo unico que falta para cerrar el OG del proyecto) |
| Tipo | Documentacion (no toca codigo) |
| Lane (archivos) | `docs/manual-operador/**` + `docs/onboarding-operador.md` + `docs/mantenimiento-operador.md` + `docs/disaster-recovery-operador.md` (todos nuevos) |
| Tamanio estimado | ~3.000-5.000 lineas de markdown en total |
| Tiempo estimado | 1 sesion larga (~6h) o 2 sesiones cortas (~3h c/u) con un agente; ~2h con 4 agentes en paralelo |
| Agentes | 1 recomendado (ver §6) |
| Gates | Visual (no tsc, no tests). Spell-check espanol + walkthrough con el operador fumigador |
| Commit pattern | UN solo commit scoped a T-CAP-01 (o 4 commits si se paraleliza) |

---

## 2. Deliverables (archivos exactos)

> El agente NO debe tocar archivos fuera de esta lista. Si encuentra
> que falta algo, lo anota en el reporte y pregunta — no lo agrega
> solo.

### 2.1 Carpeta `docs/manual-operador/`

| Archivo | Contenido | Paginas estimadas |
|---|---|---|
| `00-indice.md` | Indice navegable del manual + como esta organizado + a quien esta dirigido | 1-2 |
| `01-login.md` | Como entrar al sistema, que hacer si olvidaste la contrasena, errores comunes | 2-3 |
| `02-dashboard.md` | Que veo cuando entro, que son los KPIs, que es "salud del sistema" | 2-3 |
| `03-parcelas-inventario.md` | Como buscar una finca/parcela, que informacion tiene cada una | 2-3 |
| `04-fumigaciones-registrar.md` | Wizard paso a paso para registrar una fumigacion (3 pasos: importar vuelo / datos manuales / confirmar) | 5-8 |
| `05-geovisor-mapa.md` | Como usar el mapa estrella: busqueda por texto, filtros, lista de eventos | 3-4 |
| `06-reportes-pdf-csv.md` | Como exportar reportes por finca/parcela, como interpretar el PDF | 2-3 |
| `07-admin-crear-parcela.md` | Como crear una parcela manualmente (dibujo en mapa + metadata) | 4-5 |
| `08-admin-importar-gis.md` | Como importar un archivo SIG (shapefile/GeoJSON) para crear varias parcelas a la vez | 3-4 |
| `09-admin-productos-clientes-fincas.md` | Como agregar productos fitosanitarios, clientes y fincas al catalogo | 2-3 |
| `10-preguntas-frecuentes.md` | FAQ: "no veo una fumigacion", "el mapa no carga", "mi fumigacion no aparece en el reporte", etc. | 3-5 |
| `README.md` | Indice raiz con links a los 10 archivos + nota de version | 1 |

**Total**: 12 archivos en `docs/manual-operador/`.

### 2.2 Archivos sueltos (raíz `docs/`)

| Archivo | Contenido | Paginas estimadas |
|---|---|---|
| `docs/onboarding-operador.md` | Checklist dia 1 / dia 2 / dia 3 / semana 1 para un operador nuevo. Items tipo "[ ] loguearse por primera vez", "[ ] registrar primera fumigacion manual", "[ ] importar shapefile de fincas". | 2-4 |
| `docs/mantenimiento-operador.md` | Guia de "que hacer cuando..." para el operador: cambia de dron, se agrega finca nueva, DJI cambio el API, etc. Cada caso con: **sintoma** → **causa probable** → **accion del operador** → **a quien escalar**. | 3-5 |
| `docs/disaster-recovery-operador.md` | Guia de "que hacer cuando todo falla": BD caida, sin conexion, dron no sube data, sistema no responde. Cada caso con **sintoma observable** → **verificacion en 30s** → **accion inmediata** → **contacto de emergencia**. | 3-5 |

**Total**: 3 archivos sueltos.

### 2.3 Indice publico (opcional)

Si el operador fumigador va a acceder al manual desde el navegador,
agregar una pagina estatica simple:

| Archivo | Contenido |
|---|---|
| `public/docs/index.html` | Pagina HTML minima que linkea a los `.md` servidos como raw (`docs/manual-operador/00-indice.md` accesible via `/docs/manual-operador/00-indice.md`). Estilo AFM (logo + colores). |

> **Decidir**: si el operador fumigador necesita acceso web al manual,
> esto es parte del scope. Si solo necesita PDF, NO se hace.

**Recomendacion**: hacer el PDF como build step en una mini-tarea futura
(`scripts/build-manual-pdf.js` con `md-to-pdf` o similar). NO incluir
en T-CAP-01.

---

## 3. Acceptance criteria

### 3.1 Manual del operador (`docs/manual-operador/**`)

- [ ] Cada archivo tiene frontmatter con `> Audience: operador fumigador`
      y `> Ultima actualizacion: <YYYY-MM-DD>`.
- [ ] Cada paso tiene **numeracion explicita** (1, 2, 3...) sin saltos.
- [ ] Cada flujo tiene **prereq al inicio** ("necesitas estar logueado").
- [ ] Cada flujo tiene **verificacion al final** ("deberias ver X").
- [ ] **Cero** terminos tecnicos sin glosario: si aparece "FK", "endpoint",
      "JWT", "migration", "PostGIS", linkear a un box "que es esto?" o
      incluir glosario al final del archivo.
- [ ] **Cero** referencias a nombres de archivos del repo (`api/repositories.ts`)
      salvo en contexto "si sos dev y queres ver el codigo".
- [ ] Donde aplique, incluir **capturas de pantalla** con rutas del tipo
      `/docs/img/<archivo>-<paso>.png`. **NO generar capturas falsas**:
      si no existen, dejar el placeholder `[CAPTURA: descripcion de lo
      que se ve]` y avisar al cierre.
- [ ] Cada archivo tiene al final "Si esto no funciona" con 2-3 bullets
      de troubleshooting.

### 3.2 Onboarding (`docs/onboarding-operador.md`)

- [ ] Estructurado por tiempo: **Dia 1**, **Dia 2**, **Dia 3**, **Semana 1**,
      **Mes 1**.
- [ ] Cada item es **checklist** (`- [ ]`) con **tiempo estimado** (5min, 30min, 1h).
- [ ] Cada item tiene **link al manual** que lo cubre.
- [ ] Al final: **"Cuando estes listo"** con la lista de capacidades que
      el operador deberia tener.

### 3.3 Mantenimiento (`docs/mantenimiento-operador.md`)

- [ ] Estructura: tabla o lista de "Si pasa X → hace Y → escala a Z".
- [ ] Cubrir minimo estos 6 casos:
   1. Operador cambia de dron (T50 → T40).
   2. Se agrega una finca nueva al cliente.
   3. DJI cambia su API / scraper deja de funcionar.
   4. Se necesita agregar un producto fitosanitario nuevo al catalogo.
   5. Se necesita dar de baja un operador fumigador.
   6. La BD crece y los reportes se ponen lentos.
- [ ] Cada caso tiene: **sintoma observable por el operador**,
      **verificacion que puede hacer el operador**, **accion que puede
      hacer solo**, **a quien escalar** (vos, como dev).

### 3.4 Disaster recovery (`docs/disaster-recovery-operador.md`)

- [ ] Estructura: **sintoma** → **verificacion 30s** → **accion inmediata**
      → **contacto**.
- [ ] Cubrir minimo estos 5 casos:
   1. "No puedo entrar al sistema" (login falla).
   2. "El mapa no carga" (geovisor en blanco).
   3. "El dashboard muestra datos viejos" (cache stale).
   4. "Registre una fumigacion pero no aparece" (submit OK pero invisible).
   5. "DJI no esta subiendo vuelos" (scraper fallo).
- [ ] Incluir **contacto de emergencia** arriba del todo (tu telefono,
      horario, tiempo de respuesta esperado).
- [ ] Lenguaje **no tecnico** — el operador entra en panico, no le
      tires SQLSTATE ni nombres de tablas.

### 3.5 General

- [ ] **Ortografia y gramatica espanol colombia** (verificable con un
      spell-checker o Grammarly en espanol). NO espana de espana.
- [ ] **Tono consistente**: instructivo, calmo, sin diminutivos ni
      jergas ("un pokito", "rapidito", etc.).
- [ ] **Cero emoji** (es documentacion formal del operador, no Slack).
- [ ] **Cero marketing-speak** ("revolutionary", "next-gen", etc.).
- [ ] Cross-links entre archivos funcionando (`[Ver §4](04-fumigaciones-registrar.md#paso-2)`).

---

## 4. Verificacion

| Check | Como |
|---|---|
| tsc / arch:check / tests | **NO CORREN** (no toca codigo) |
| Spell check espanol | `npx cspell docs/manual-operador/ docs/onboarding-operador.md docs/mantenimiento-operador.md docs/disaster-recovery-operador.md` (si cspell esta instalado; si no, manual) |
| Links internos | `npx markdown-link-check docs/manual-operador/**/*.md` (recomendado, opcional) |
| Walkthrough con operador fumigador | **OBLIGATORIO antes de merge**. El operador sigue el manual en orden, sin ayuda, y vos observas. Anotar fricciones. |
| Tiempo de ejecucion del walkthrough | Meta: operador nuevo termina el onboarding (Dia 1+2+3) en <2h |

---

## 5. Riesgos y notas

### 5.1 Capturas de pantalla

El manual referencia imagenes. **NO generar capturas falsas** — si el
agente no tiene acceso a la UI corriendo, dejar placeholder `[CAPTURA:
descripcion]` y avisar al cierre. Las capturas se capturan en una mini-tarea
futura (`T-CAP-02`) con el sistema deployado en staging.

### 5.2 Drift con UI

La UI cambia. El manual queda obsoleto. **Mitigacion**:

- Agregar a `docs/DEEPSEEK-COORDINATION.md` §3 como item recurrente:
  "revisar manual-operador contra UI cada sprint".
- Cada archivo de manual tiene frontmatter con fecha; si pasa >60 dias,
  marcarlo para revision.

### 5.3 Operador fumigador como reviewer

El unico que puede validar la utilidad del manual es el operador fumigador.
**Antes de marcar T-CAP-01 como hecho**, vos (el dev) tenes que sentarte
30 min con el y ver si puede seguir Dia 1 del onboarding solo. Si no
puede, el manual esta mal y hay que re-trabajarlo.

### 5.4 Glosario

Algunos terminos tecnicos inevitables ("DJI SmartFarm", "ICA",
"PostGIS"). Crear `docs/manual-operador/glosario.md` con definiciones
simples en 1 linea cada uno. Linkearlo desde `00-indice.md`.

### 5.5 Idioma de la UI

Toda la UI esta en espanol. Si el operador fumigador reporta strings
en ingles en la UI (post #37 deberian estar todos), el manual NO debe
taparlo — debe **escalar como bug** a Fase X de UX.

---

## 6. Recomendacion: 1 agente o 4 agentes en paralelo?

| Opcion | Pros | Contras |
|---|---|---|
| **1 agente** | Voz consistente, sin contradicciones entre docs, un solo commit limpio | Tarda mas (~6h), el agente tiene que sostener contexto de 3000+ lineas |
| **4 agentes en paralelo** (A=manual, B=onboarding, C=mantenimiento, D=DR) | Termina en ~2h, cada agente es especialista en su tono | **Riesgo alto de inconsistencia**: "BD caida" en D vs "la base de datos no responde" en C, link roto entre archivos, distinto nivel de detalle |

**Recomendacion**: **1 agente**, en modo foreground (vos esperas el
resultado). El agente tiene que leer primero `docs/USER-FLOWS.md` +
`docs/AEROADMIN-AFM-OVERVIEW.md` + 4 archivos clave de la UI
(`app/(auth)/page.tsx`, `app/(auth)/fumigaciones/nueva/page.tsx`,
`app/(auth)/geovisor/page.tsx`, `app/(auth)/admin/parcels/import/page.tsx`)
para entender los flujos antes de escribir.

Si se paraleliza: **B, C, D primero** (mas chicos, menos riesgo de
inconsistencia), **A al final** integrando los links.

---

## 7. Briefing para el agente (literal, copy-paste)

```markdown
# T-CAP-01 — Manual del operador + onboarding + DR

## Que vas a hacer
Escribir la documentacion para el operador fumigador del Valle del Cauca.
NO es dev. Idioma espanol colombia. Tono calmo, instructivo, sin jerga
interna. Sin emoji, sin marketing-speak.

## Files a tocar (SOLO estos)
- docs/manual-operador/ (carpeta nueva, 12 archivos)
- docs/onboarding-operador.md (nuevo)
- docs/mantenimiento-operador.md (nuevo)
- docs/disaster-recovery-operador.md (nuevo)
- docs/manual-operador/glosario.md (nuevo)

NO toques codigo. NO toques AGENTS.md. NO toques docs/DEEPSEEK-*.
NO instales dependencias.

## Antes de escribir, lee (en este orden)
1. docs/USER-FLOWS.md (172 lineas, flows tecnicos de cada vista)
2. docs/AEROADMIN-AFM-OVERVIEW.md (304 lineas, vision general)
3. app/(auth)/page.tsx (dashboard)
4. app/(auth)/fumigaciones/nueva/page.tsx (wizard fumigacion)
5. app/(auth)/geovisor/page.tsx (mapa estrella)
6. app/(auth)/admin/parcels/import/page.tsx (wizard GIS)

## Acceptance criteria
[Copiar §3 de este doc]

## Verificacion
[Copiar §4 de este doc]

## Riesgos
[Copiar §5 de este doc]

## Al cerrar
Reporte con:
- Lista de archivos creados + lineas
- Caminos de onboarding testeados mentalmente
- Capturas pendientes (si dejaste placeholders)
- Cualquier friccion que encontraste con la UI actual
```

---

## 8. Estado

| Tarea | Estado |
|---|---|
| T-CAP-01 diseno | ✅ este doc |
| T-CAP-01 ejecucion | ⬜ esperando OK para asignar |

---

## 9. Cuando T-CAP-01 este hecho

1. Commit scoped: `docs(operador): T-CAP-01 manual + onboarding + mantenimiento + DR`.
2. Update `docs/DEEPSEEK-COORDINATION.md` §3: marcar OE4 cerrado.
3. Update `AGENTS.md`: borrar el pendiente "Manual del operador" si lo
   habia.
4. **Walkthrough real** con el operador fumigador. Anotar feedback.
5. Si el walkthrough revela gaps → mini-tarea `T-CAP-02 polish manual`.
