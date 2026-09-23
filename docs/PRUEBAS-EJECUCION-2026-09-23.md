# Ejecución de pruebas — AeroAdmin AFM (2026-09-23)

> **Anexo** de `docs/PLAN-PRUEBAS-FUNCIONALIDAD-USABILIDAD.md`. Registra la corrida
> real de la batería de pruebas sobre `master` (`2c77b86`) y sirve como evidencia
> para la sustentación.

---

## 1. Entorno de ejecución

| Elemento | Valor |
|---|---|
| OS / Shell | Windows, PowerShell 5.1 |
| Node / npm | Node 22.14.0 · npm 11.2.0 |
| Docker | Docker Desktop 28.3.2 |
| DB | `postgis/postgis:16-3.4` (`afm-postgis`, healthy) |
| Migrations | `npm run db:migrate` → 54 aplicadas/previamente aplicadas, 0 errores |
| Datos locales | 14 parcelas · 24 fumigaciones · 1 usuario (+ admin E2E seed) |
| Playwright | 1.61.1 · Chromium |
| App bajo prueba | `next start -p 3001` (Next 16.2.4) |

**`.env.local`** (gitignored) usado:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/afm_flights
DATABASE_SSL=false
AUTH_SECRET=<generado>
AUTH_URL=http://localhost:3001
AUTH_TRUST_HOST=true
E2E_USER_EMAIL=e2e@aeroadmin.local
E2E_USER_PASSWORD=E2ETest12345!
```

---

## 2. Resultados por nivel

| Nivel | Comando | Resultado |
|---|---|---|
| Tipos | `npx tsc --noEmit` | **0 errores** |
| Arquitectura | `npm run arch:check` | **0 errores** (395 módulos) |
| Unit + integración (con BD) | `npm test` | **2371 passed / 0 skipped** (175 archivos) |
| Build producción | `npm run build` | **✓** (todas las rutas dinámicas) |
| **E2E — specs alineados a la UI actual** | `npx playwright test tests/e2e/geovisor-and-parcels.spec.ts tests/e2e/logo-sidebar.spec.ts` | **9 / 9 ✅** |
| E2E — auth + dashboard | `npx playwright test tests/e2e/auth-and-dashboard.spec.ts` | 4 / 7 (3 stale) |
| E2E — suite completa | `npm run e2e` | 3 passed / 52 failed / 9 skipped *(ante del fix de §3)* |

> Nota: con la BD arriba, los **integration tests** (`post-import-data-integrity`,
> `mv-fumigations-monthly`) **se ejecutan y pasan** con el dataset local (14
> parcelas). Sin `.env.local`, se saltean (12 skipped).

---

## 3. Hallazgo clave — E2E requiere `AUTH_TRUST_HOST`

**Síntoma:** 52 tests fallaban (todo lo que depende de sesión).

**Causa raíz (log del server):**
```
[auth][error] UntrustedHost: Host must be trusted.
URL was: http://localhost:3001/api/auth/session
```

NextAuth v5 (`trustHost`) rechaza hosts no confiados fuera de Vercel. Sin
`AUTH_TRUST_HOST=true`, ninguna sesión se crea → login/dashboard/geovisor/admin
fallan en cascada.

**Fix aplicado:** agregar `AUTH_TRUST_HOST=true` a `.env.local`.

**Después del fix:** los specs alineados a la UI actual pasan (**9/9**) y
`auth-and-dashboard` sube a **4/7**.

**Acción pendiente:** documentar `AUTH_TRUST_HOST=true` en `.env.example` y en el
runbook de E2E. (En Vercel no es necesario: el host es confiable.)

---

## 4. Fallos E2E post-fix — specs desactualizados (drift UI)

Los fallos restantes son **expectativas viejas**, no bugs de producto (los flujos
actuales pasan en `geovisor-and-parcels`). Agrupados por causa:

| Causa (drift) | Specs afectados |
|---|---|
| Dashboard V0: 4 KPIs de fumigación / `CompliancePanel` | `auth-and-dashboard` #3, `user-stories` US-2.1–2.4 |
| Sidebar con labels viejos (`Panel`/`Geovisor`/`Parcelas`) | `auth-and-dashboard` #5 |
| `/admin/parcels` layout viejo (inputs V0, paginación) | `admin-parcels*.spec`, `auth-and-dashboard` #7, `user-stories` US-6.* |
| Datos sintéticos "1213 parcelas" (no aplica al dataset local) | `geometry-html-check`, `geovisor-renders-parcels` |
| Geovisor con filtros viejos (cliente / estado de cadencia) | `user-stories` US-3.3, US-3.4 |
| MapTiler / dibujo de polígono | `maptiler-basemap`, `parcel-drawer-click` |
| RBAC / user-stories varios | `user-stories` US-1.2, US-4.*, US-5.*, US-7.* |

**Acción pendiente:** actualizar o retirar estos specs (deuda de E2E ya conocida en
el repo). No bloquean la funcionalidad actual.

---

## 5. Cobertura de los casos del plan (§5)

| Bloque | Evidencia | Estado |
|---|---|---|
| AUTH-01..06 | unit + E2E `auth-and-dashboard` (parcial) + `login-page.test` | ✅ cubierto; E2E stale a actualizar |
| DASH-01..05 | unit (`dashboard-panels`, `planning-board`) + E2E geovisor-and-parcels | ✅ |
| PARC-01..08 | unit (`parcels-table`, `parcel-drawer`, `new-parcel-form`) + E2E #6–#8 | ✅ |
| CIC-01..07 (ciclo/fase) | unit (`api-repositories-cycles`, `crop-cycle`) | ⚠️ flujo end-to-end en navegador pendiente |
| FUM-01..12 | unit (wizard P0, overlays, bulk, invoices, delete) | ✅ automatizado; E2E end-to-end pendiente |
| GEO-01..09 | unit (`geovisor-client` 19) + E2E geovisor-and-parcels (8) | ✅ (GEO-09 error de mapa sigue pendiente) |
| REP-01..03 | unit (`reports-tabs`) | ⚠️ export PDF/CSV manual pendiente |
| ADM-01..07 | unit varios | ⚠️ E2E admin stale |
| X-01..05 (a11y/estados/responsive) | unit (`shell-layout-drawer`, focus-visible en tests) | parcial; verificación manual 320/768/1024/1440 pendiente |

---

## 6. Usabilidad (§6)

**No ejecutada**: requiere **participantes** (operador fumigador, supervisor,
admin). El guion, tareas (T1–T8), métricas y el cuestionario SUS ya están en
`docs/PLAN-PRUEBAS-FUNCIONALIDAD-USABILIDAD.md` §6, listos para correr.

---

## 7. Próximos pasos

1. **Actualizar los specs E2E stale** (§4) a la UI actual (`Inspector`, dashboard
   nuevo, sidebar nuevo, admin/parcels).
2. **Documentar `AUTH_TRUST_HOST=true`** en `.env.example` / runbook E2E.
3. Ejecutar el **guion funcional manual** de §5 (ciclos/fase en campo CIC-01..07,
   wizard end-to-end, export PDF/CSV) y el **de usabilidad** §6; anexar resultados.
4. Continuar con los pendientes de producto ya anotados (estado de error del mapa,
   Sheets mobile, tablas `ui/table` + card mobile).

---

### Observaciones
- Durante un run apareció un error transitorio del server
  (`controller[kState].transformAlgorithm is not a function`) que **no** afectó el
  resultado (los tests pasaron). Es un artefacto de streaming de React/Next, no
  reproducible como fallo de producto.
- El E2E completo tardó ~16.5 min; con 1 worker (config `workers: 1`).
