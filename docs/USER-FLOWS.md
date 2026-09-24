# AeroAdmin AFM — User Flows

> **Snapshot 2026-09-24**, master vigente (Release Candidate).
> **Source of truth:** `app/(auth)/**/page.tsx` + `components/**`.
> **Audience:** quien quiera entender qué hace el operador día a día (sustentación / review).

---

## 0. Actores

- **Operador fumigador** (rol `admin`): pilota drones, registra fumigaciones, edita
  metadata de parcelas, mantiene ciclos y reglas.
- **Supervisor** (rol `supervisor`): lectura + puede **registrar fumigaciones** y asignar
  parcelas a huérfanas; **no** accede a `/admin/**`.
- **Dron físico** (T40/T50/T70): vuela y sincroniza a DJI SmartFarm al hacer login el piloto.
- **Sistema DJI SmartFarm**: backend que la plataforma consulta vía cliente Playwright.

---

## 1. Login

**Path:** `/login` (público, sin AppShell) · **Files:** `app/(public)/login/page.tsx`

1. El usuario llega a `/login` (sin shell, por el route group `(public)`).
2. Form HTML `email` + `password`.
3. JS `fetch` a `/api/auth/csrf` → `/api/auth/callback/credentials`.
4. NextAuth valida contra `app_users.password_hash` (bcrypt).
5. OK → `/` (dashboard) con cookie de sesión; FAIL → "Email o password incorrectos".
6. El middleware (`proxy.ts`) protege el resto; sin sesión → `/login`.

> En local/self-host se requiere `AUTH_TRUST_HOST=true` (si no, `UntrustedHost`).

---

## 2. Dashboard (`/`)

**Path:** `/` (AppShell) · **Files:** `app/(auth)/page.tsx`

- **KPIs:** Fumigaciones, Área aplicada, Cobertura real, Volumen, Vuelos.
- **Filtros:** período (30/90d, año, todo), hacienda, dron, estado (con/sin parcela,
  por revisar), búsqueda por suerte/hacienda.
- **Bloques:** tendencia (semanal), cumplimiento de planificación, flota por hectáreas,
  mix por categoría, cobertura por hacienda, y **planificación de fumigaciones** (agenda
  manual: planificar/marcar hecha/cancelar).
- Carga con Suspense boundaries.

---

## 3. Geovisor (`/geovisor`)

**Path:** `/geovisor` (AppShell, **map-first**) · **Files:** `app/(auth)/geovisor/page.tsx`,
`components/geovisor/geovisor-client.tsx`, `components/geovisor/inspector-panel.tsx`.

- **Mapa como capa base** (full-bleed) con capas toggleables (parcelas, aplicaciones,
  etiquetas) y basemap (Satélite/Híbrido/Calles/Topo según key).
- **Overlay superior:** KPIs (Fumigaciones, Parcelas tratadas, Área aplicada, Última) +
  toggles "Filtros"/"Eventos".
- **Rail de filtros** (overlay izquierdo, colapsable): búsqueda por texto, rango
  Desde/Hasta (default últimos 90 días), capas y leyenda.
- **Inspector** (overlay derecho, único): 3 modos — **Contexto** (parcela seleccionada +
  sus fumigaciones + detalle), **Parcelas**, **Fumigaciones**. El mapa **no abre popups**:
  resalta + centra.
- **Huérfanas:** badge "Sin asignar"; admin/supervisor pueden **asignar parcela**
  (`AssignParcelDialog`).

---

## 4. Parcelas (`/parcelas`)

**Path:** `/parcelas` (AppShell) · **Files:** `app/(auth)/parcelas/page.tsx`,
`components/parcels/parcels-table.tsx`

- Tabla con búsqueda full-text, filtro Cliente y Estado, sort por columnas y paginación.
- Columnas: nombre, cliente/hacienda, área, última/ próxima fumigación, estado (chip),
  eventos, fase del ciclo.
- Click en fila → `/parcelas/[id]`.
- Botones **admin**: "Importar GIS" (`/admin/parcels/import`) y "Crear parcela"
  (`/admin/parcels/new`).

---

## 5. Ficha de parcela (`/parcelas/[id]`)

**Path:** `/parcelas/[id]` (AppShell) · **Files:** `app/(auth)/parcelas/[id]/page.tsx`

- **Header/breadcrumb:** cliente → finca → parcela; áreas; estado.
- **Mapa** con el polígono + fumigaciones.
- **KPIs** y **ciclo/fase** (con `CycleActions`: "Iniciar nuevo ciclo" / "Registrar corte").
- **Manejo fitosanitario** (requerimientos por fase).
- **Historial de trabajos** (timeline de fumigaciones) + **cambios de cadencia**.
- **Form de fumigación manual** (`RegisterFumigationForm`).
- **Admin:** reportes PDF/CSV y edición de metadata (vía `/admin/parcels`).

---

## 6. Nueva fumigación (`/fumigaciones/nueva`)

**Path:** `/fumigaciones/nueva` (AppShell) · **Files:** `app/(auth)/fumigaciones/nueva/page.tsx`,
`components/admin/fumigations/new-fumigation-page-client.tsx`

**Wizard 3 pasos:**
1. **¿Qué se fumigó?** — tabs Importar (vuelo DJI) / Manual; selector de parcela
   (autocomplete o dibujo en mapa); si Importar → `DjiFlightPicker` (cards clickeables).
2. **¿Con qué se fumigó?** — `RegisterFumigationForm` (producto, dosis, área, duración,
   dron, vehículo, ICA, piloto, fase, notas) + mapa. Validación zod antes de avanzar.
3. **Confirmar** — resumen read-only; "Confirmar y registrar" hace el **POST** y navega a
   `/fumigaciones`.

- **Auto-fill** desde el vuelo DJI (fecha, duración, área, dron, notas).
- Volver desde Confirm **preserva** lo tipeado.

---

## 7. Fumigaciones — listado (`/fumigaciones`)

**Path:** `/fumigaciones` (AppShell) · **Files:** `app/(auth)/fumigaciones/page.tsx`,
`data-loader.tsx`, `fumigaciones-table.tsx`

- Filtros URL-driven: `?source=dji|manual|import&category=&from=&to=&parcel=&drone=&q=&page=`.
- **Operaciones bulk:** borrar y asignar categoría (confimación con `AlertDialog`).
- Estado de selección por página actual.

---

## 8. Detalle de fumigación (`/fumigaciones/[id]`)

**Path:** `/fumigaciones/[id]` (AppShell) · **Files:** `app/(auth)/fumigaciones/[id]/page.tsx`

- Header (producto, fecha, parcela(s), área, duración) + badges (categoría, tipo, source).
- Mapa (centroide/track), lista de vuelos, multi-parcela si aplica.
- **Audit trail** (timeline created/edited/deleted/restored).
- **Facturas** (crear/cancelar).
- Admin: **Editar** (`/fumigaciones/[id]/editar`) y **Eliminar** (soft-delete con `AlertDialog`).

---

## 9. Editar fumigación (`/fumigaciones/[id]/editar`)

**Path:** `/fumigaciones/[id]/editar` (AppShell) · **Files:**
`app/(auth)/fumigaciones/[id]/editar/page.tsx`

- Mismo `RegisterFumigationForm` en `mode="edit"`; **PATCH sparse** (solo campos cambiados).
- Inmutables: `parcel_id`, `source`, `recorded_by`, `flight_ids`, `recorded_at`.
- Sin permisos → card "Sin permisos para editar".

---

## 10. Reportes (`/reportes`)

**Path:** `/reportes` (AppShell) · **Files:** `app/(auth)/reportes/page.tsx`,
`components/reports/`

- **2 tabs:** **Reporte operativo** (detalle de fumigaciones) y **Resumen por parcela**.
- Filtros de rango de fechas.
- **Export CSV/PDF** (admin); el supervisor no ve botones que recarguen.

---

## 11. Administración (`/admin/**`) — solo admin

- `/admin` — landing de herramientas internas.
- `/admin/parcels` — edición inline (Cliente/Finca FK, municipio, variedad) + búsqueda
  server-side; filtra "sin asignar"/campos vacíos.
- `/admin/parcels/new` — alta manual con dibujo de polígono.
- `/admin/parcels/import` — import GIS (KML/SHP/GPKG): upload → preview → commit.
- `/admin/reglas-fitosanitarias` — CRUD de reglas por fase + "Restaurar recomendados".

> Retirados (2026-09-24): `/admin/calidad` (calidad de datos), `/admin/pipeline`
> (salud del pipeline), `/admin/applications` (Excel).

---

## 12. Auth + roles (cross-cutting)

`getViewerRole()` (`lib/auth/role.ts`) decide qué ve cada usuario:
- **admin**: botones admin (Importar GIS, Crear parcela, Editar metadata, bulk, ciclos, reglas).
- **supervisor**: lectura + registrar fumigaciones + asignar huérfanas.

Helpers: `requireRole([...])` en route handlers, `getViewerRole()` en pages.

---

## 13. Resumen de paths

| Path | Auth | Página |
|---|---|---|
| `/login` | público | Login |
| `/` | AppShell | Dashboard |
| `/parcelas` | AppShell | Inventario |
| `/parcelas/[id]` | AppShell | Ficha de parcela |
| `/fumigaciones` | AppShell | Listado |
| `/fumigaciones/nueva` | AppShell | Wizard 3 pasos |
| `/fumigaciones/[id]` | AppShell | Detalle |
| `/fumigaciones/[id]/editar` | AppShell | Editar |
| `/geovisor` | AppShell | Geovisor (map-first + Inspector) |
| `/reportes` | AppShell | Reportes (2 tabs) |
| `/admin` | admin | Administración (landing) |
| `/admin/parcels` | admin | Edición inline |
| `/admin/parcels/new` | admin | Alta manual |
| `/admin/parcels/import` | admin | Import GIS |
| `/admin/reglas-fitosanitarias` | admin | Reglas fitosanitarias |

---

**Para implementar cambios:** leer `docs/AEROADMIN-AFM-OVERVIEW.md` +
`docs/DATA-MODEL.md` + `docs/API-INVENTORY.md`, y las reglas de UI en
`skills/aeroadmin-ui/SKILL.md`.
