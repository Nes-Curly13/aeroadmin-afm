# Mejores prácticas para agentes de IA
## AeroAdmin AFM — Guía operativa del equipo

> Este documento es el "cómo comportarse" trabajando en este repo. Léelo junto con
> `01_SDD_AeroAdmin_AFM.md` (arquitectura) y `02_TDD_AeroAdmin_AFM.md` (testing).

---

## 0. Antes de escribir una sola línea de código

Todo agente debe cargar contexto en este orden antes de empezar cualquier tarea:

1. `docs/STACK.md` — snapshot técnico completo (este documento base).
2. `ARCHITECTURE.md` — topología de directorios y decisiones de DB.
3. `docs/SPEC.md` — decisiones de producto (qué se decidió NO hacer, y por qué).
4. `docs/audit/BITACORA.md` — histórico de auditoría + roadmap vigente (S5-S7, M1-M7, L1-L5).
5. Si la tarea toca el scraper DJI: `docs/DJI_SCRAPER.md` y `docs/SCRAPER_DEFECTS.md`.
6. Si la tarea toca unidades o cadencia: `docs/DJI_AREA_UNITS.md` y
   `docs/FUMIGATION_CADENCE.md`.

Un agente que empieza a escribir código sin este contexto va a reinventar decisiones
ya tomadas (y descartadas) o a romper convenciones invisibles en el código pero
documentadas en estos archivos.

---

## 1. Git — riesgo crítico activo

**El repo actualmente no tiene remote configurado.** Esto es una prioridad operativa,
no solo una nota:

- Antes de cualquier trabajo grande, el agente (o el humano a cargo) debe confirmar
  si ya se resolvió (`git remote -v`). Si no, señalarlo como bloqueante.
- Mientras no haya remote: commits frecuentes y atómicos, mensajes descriptivos,
  y **nunca** operaciones destructivas sobre `.git/` (`git gc --aggressive`,
  reescritura de historia) sin backup manual del directorio `.git/`.
- Convención de mensajes: imperativo, en español o inglés consistente con el resto
  del historial existente — revisar `git log` antes de decidir.
- Un cambio grande (migración de schema, refactor de una feature completa) merece
  su propia rama, no commits directos a `main`.

---

## 2. Convenciones de código

### Frontend
- Server Components por defecto. `"use client"` solo si hay estado o interactividad.
- Componentes en `PascalCase`, **named exports** (nunca `export default`).
- Props tipadas con `interface ComponentNameProps`, exportada solo si otro archivo
  la necesita.
- Tailwind v4 con hex inline como estilo actual; usar `lib/ui-tokens.ts` como
  referencia de paleta, no reinventar colores.
- Cero `any` en código de producto — si TypeScript se resiste, es señal de que el tipo
  de dominio (en `lib/types.ts`) está incompleto, no una licencia para `any`.
- Sin CSS Modules, styled-components ni Emotion — mantener consistencia con Tailwind.

### Backend
- `export const dynamic = "force-dynamic"` en todo route handler nuevo, salvo que
  haya una razón explícita para cachear a nivel de Next (documentarla si aplica).
- Validar todo input con los helpers de `lib/request.ts` (`parseIntParam` y
  equivalentes) — no parsear a mano ni introducir Zod sin discutirlo primero
  (es un cambio de convención, no una corrección puntual).
- Toda lógica de acceso a datos pasa por `api/repositories.ts` — nunca hacer un
  `pool.query` suelto en un route handler o script nuevo sin pasar por ahí.
- `try/catch` siempre en route handlers; error consistente:
  `NextResponse.json({error: msg}, {status: 500})` (o el código apropiado).

### Naming
- Strings de UI, comentarios y mensajes de error visibles al usuario: **español**.
- Identificadores (archivos, funciones, columnas SQL, variables): **inglés**.
- Alias de import `@/*` apunta a la raíz — usarlo en vez de rutas relativas largas.

---

## 3. Migraciones de base de datos

- Viven en `supabase/migrations/*.sql`, se aplican con `npm run db:migrate`
  (idempotente).
- **Nunca editar una migración ya aplicada en producción/Supabase.** Si algo salió
  mal, se crea una migración nueva que corrige, no se reescribe la anterior.
- Toda tabla con geometría: definir el tipo explícito
  (`geometry(MultiPolygon, 4326)`, etc.) y su índice GIST en la misma migración que
  la crea — no como paso separado "para después".
- Antes de dropear una tabla, snapshot a `_legacy_snapshot` primero (patrón usado
  con `dji_land_assets`/`dji_daily_summaries`) — permite rollback sin restaurar
  backup completo.
- Correr `scripts/smoke-test-db.js` después de aplicar una migración nueva.

---

## 4. Unidades y tiempo — no negociable

- **Geometría**: SRID 4326 siempre. Si un dato llega en otro sistema de referencia,
  convertir en el punto de ingesta, no dejar geometrías mixtas en la misma tabla.
- **Área**: DJI reporta en MU. `1 MU = 666.67 m²`. Usar siempre los helpers
  documentados en `docs/DJI_AREA_UNITS.md` — un cálculo manual del factor es una
  fuente frecuente de bugs sutiles (diferencias de redondeo que se acumulan en
  reportes agregados).
- **Fechas**: TZ `America/Bogota` para todo lo visible al usuario. Las conversiones
  viven en `lib/format.ts`. Un `new Date()` sin pasar por ahí en código de producto
  es una bandera roja en review.

---

## 5. Gotchas del scraper DJI (memoria institucional — no repetir errores ya resueltos)

1. **Locale trap**: sin `Accept-Language: zh-CN`, el query `?name=lands` devuelve
   vacío silenciosamente (no error, solo `[]`). Cualquier debugging de "no llegan
   datos" empieza revisando esto.
2. **HMAC vive en el interceptor Axios del WASM**: un `fetch()` hecho desde
   `page.evaluate()` da 408 porque la firma no se genera igual. Usar los helpers
   existentes en `lib/djiag-korean-client.js`, no reimplementar el fetch.
3. **Paginación Ant Design**: `.ant-pagination-jump-next` solo carga la landing page;
   usar `.ant-pagination-next` para avanzar de a una página por click.
4. **`serial_number` no es el chassis del dron**: es un session-id que cambia. Para
   deduplicar usar `drone_nickname`; el chassis real está en `hardware_id` del
   endpoint de detalle.
5. **Storage state** de sesión se reutiliza 7 días (`lib/djiag-storage.js`) — no
   forzar re-login en cada corrida del pipeline sin razón, es costoso y frágil.

Cualquier gotcha nuevo descubierto debe agregarse a `docs/DJI_SCRAPER.md` o
`docs/SCRAPER_DEFECTS.md` en el mismo cambio que lo resuelve — no dejarlo solo en
el mensaje de commit.

---

## 6. Seguridad — checklist antes de cerrar cualquier PR que toque datos o auth

- [ ] SQL parametrizado (`$1, $2, ...`), nunca concatenación de strings.
- [ ] Input de usuario (parcelId, droneSerial, pilot, etc.) validado con regex antes
      de llegar a una query.
- [ ] Nada de secrets (`DJIAG_EMAIL`, `DJIAG_PASSWORD`, `AUTH_SECRET`,
      `DATABASE_URL*`) hardcodeado ni commiteado — solo en `.env.local` (gitignored).
- [ ] Si el cambio toca `auth.ts`/`auth.config.ts`: confirmar que el split
      Edge/Node sigue intacto (bcrypt no puede llegar al bundle de Edge).
- [ ] Si el cambio agrega una ruta nueva: confirmar que `requireAuth()` se llama
      salvo que la ruta deba ser pública (y en ese caso, justificarlo).
- [ ] CSP sigue pendiente de implementar — no asumir que ya protege nada.

---

## 7. Caching

- Tags por dominio en `lib/cache.ts`: `parcels`, `flights`, `alerts`, `dashboard`,
  `fumigations`, `task-history`.
- Toda mutación debe invalidar su tag explícitamente
  (`invalidateAfterFumigationMutation`, etc.) — un POST/PUT que no invalida cache es
  un bug silencioso (el usuario ve datos viejos hasta el próximo TTL).
- Task History **no cachea** por decisión de producto — no agregar cache ahí sin
  discutir el trade-off con el equipo (afecta la frescura de datos operativos).

---

## 8. Documentación viva

- `docs/STACK.md` es un "documento vivo" — cualquier cambio de stack, tabla nueva,
  o convención nueva debe reflejarse ahí en el mismo PR, no en uno posterior.
- `docs/audit/BITACORA.md` registra el histórico de auditoría y el roadmap — un
  agente que cierra un ítem del roadmap (S5-S7, M1-M7, L1-L5) debe marcarlo ahí.
- Si se descarta una decisión de arquitectura (ver SDD §7), documentar el nuevo ADR
  y por qué se reemplazó el anterior — no borrar el rastro de la decisión vieja.

---

## 9. Definition of Done (general, más allá de testing)

Un cambio está listo para integrarse cuando:
- [ ] Cumple el Definition of Done de testing (`02_TDD_AeroAdmin_AFM.md` §7).
- [ ] Sigue las convenciones de código de la sección 2.
- [ ] No introduce unidades o TZ manuales fuera de los helpers (sección 4).
- [ ] Si tocó el scraper, no repite un gotcha ya documentado (sección 5).
- [ ] Pasa el checklist de seguridad si aplica (sección 6).
- [ ] Invalida cache correctamente si mutó datos (sección 7).
- [ ] Actualiza documentación viva si corresponde (sección 8).
- [ ] El mensaje de commit explica el *porqué*, no solo el *qué*.

---

## 10. Cómo debe operar un agente de IA específicamente en este repo

- **No asumir nada sobre la API de DJI sin revisar los gotchas documentados** — el
  costo de un supuesto incorrecto ahí es alto (sesiones rotas, datos vacíos
  silenciosos).
- **No regenerar mocks de DJI a mano** cuando existen fixtures reales en
  `tests/fixtures/djiag-live/` — usar esos.
- **No tocar `db/schema.sql`** como si fuera la fuente de verdad runtime — es
  canónico mas no se usa en runtime; las migraciones en `supabase/migrations/` sí
  son la fuente de verdad aplicada.
- **Preguntar/señalar, no improvisar**, cuando una tarea empuje contra un ADR
  documentado (SDD §7) o contra el alcance explícito del producto (SDD §1).
- **Preferir cambios pequeños y verificables** sobre refactors grandes de una sola
  vez — dado el riesgo de git sin remote (sección 1), un cambio grande sin commits
  intermedios es una apuesta innecesaria.
