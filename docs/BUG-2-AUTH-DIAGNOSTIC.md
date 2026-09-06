# Bug 2 — Diagnóstico: `/geovisor` accesible sin login

> **Status**: instrumentación lista (PR #41). Falta el paso manual en Vercel.

## TL;DR

La instrumentación loggea cada hit al callback `authorized` del proxy/middleware.
Necesitamos ver el log real en Vercel para diagnosticar por qué `/geovisor` no
bloquea cuando no hay sesión.

## Pasos para vos

### 1. Abrí Vercel Logs

1. https://vercel.com/nes-curly13s-projects → elegí el proyecto (aeroadmin-afm o aeroadmin-afm2, el que uses para el bug)
2. Click en el último deploy a `master` (los PRs #48+ están deployados)
3. Tab "Logs" → filter `Production` env
4. Buscá el patrón: `[auth.authorized]`

### 2. Reproducí el bug

1. Abrí una ventana de incognito en el browser
2. Pegá `https://<tu-proyecto>.vercel.app/geovisor` (SIN loguearte antes)
3. **Debería** redirigirte a `/login` — pero se reporta que NO lo hace
4. Mantené la ventana abierta hasta ver el log

### 3. Capturá el log

Buscá líneas con el prefijo `[auth.authorized]`. Vas a ver algo como:

```json
{
  "pathname": "/geovisor",
  "isLoggedIn": false,
  "hasAuth": false,
  "hasUser": false,
  "userEmail": null
}
```

Copialo y pegamelo en el chat. Con eso puedo diagnosticar:

| Qué se ve | Qué significa | Fix |
|---|---|---|
| `pathname: "/geovisor"` + `isLoggedIn: false` + NO redirige | El `authorized` está OK pero el proxy no bloquea | Verificar `proxy.ts` (la función default de NextAuth) |
| NO aparece ningún log para `/geovisor` | El proxy NO se está ejecutando para esa ruta | Verificar `matcher` en `proxy.ts` |
| El log aparece pero `auth` viene con `user` populado | Bug de NextAuth: sesiones inválidas se reportan como "logged in" | Invalidar cookie de sesión |
| `pathname: "/_next/..."` o `"/static/..."` | El log es de un asset, no del page request | Esperar y buscar más |

## Estado del código

- **`lib/auth.config.ts:146-157`**: `console.log("[auth.authorized]", { ... })` con pathname, isLoggedIn, hasAuth, hasUser, userEmail. Remover después del fix.
- **`proxy.ts`**: importa `authConfig` y exporta `default auth((request) => ...)`. El `matcher` está en `proxy.ts:30+`.
- **`app/(auth)/layout.tsx`**: envuelve todo en `<AppShell>`. Las páginas autenticadas viven en `app/(auth)/...` — el `authorized` debe devolver `false` para redirigir a `/login`.

## Hipótesis probables

1. **`authorized` se llama pero devuelve `true` por error** — algún branch del código permite el paso
2. **El matcher del proxy no incluye `/geovisor`** — el middleware no corre para esa ruta
3. **El proxy se ejecuta en Edge runtime y no tiene acceso a la sesión** — el cookie no se propaga

## Después del fix

Una vez diagnosticado y arreglado, remover el `console.log` en `lib/auth.config.ts:149-157`
y commit con `fix(auth): Bug 2 — /geovisor accesible sin login`.

---

## Patron zod para tests anti-Bug-2 (Sprint S11+)

> **Sprint S11+ / Quality Gauntlet compuerta 4**: usar zod para validar
> la shape de responses en tests, especialmente en endpoints auth-gated.

### Por que zod aca

El Bug 2 era conceptualmente "un endpoint (page route o API) que deberia
bloquear retorna 200 con shape incorrecta en vez de 401". El patron
zod que sigue evita este tipo de bug en futuras regresiones:

```ts
import { errorResponseSchema } from "@/lib/api-schemas";

it("endpoint sin sesion → 401 con body zod-valid", async () => {
  mockRequireRole.mockRejectedValueOnce({
    code: "UNAUTHENTICATED",
    message: "no auth"
  });
  const res = await handler(makeRequest("/api/...") as NextRequest);
  // Check 1: status code
  expect(res.status).toBe(401);
  // Check 2: body shape via zod (catches rename/refactor bugs)
  const parsed = errorResponseSchema.parse(await res.json());
  expect(parsed.error).toBeDefined();
});
```

### Que tests ya tenemos con este patron

`tests/api-auth-zod-validation.test.ts` (PR #56) cubre 5 endpoints
auth-gated:

| Endpoint | Sin sesion | Sin role |
|---|---|---|
| GET /api/dji-flights/search | 401 ✅ | 403 ✅ |
| GET /api/data-quality/invariants | 401 ✅ | n/a (admin-only) |
| GET /api/admin/parcels/search | 401 ✅ | n/a |
| POST /api/admin/cycles/backfill | 401 ✅ | n/a |

### Como agregar el patron a un nuevo endpoint

1. Importa `errorResponseSchema` de `@/lib/api-schemas`.
2. En el test, simula `requireRole` tirando `UNAUTHENTICATED`.
3. Assert: `expect(res.status).toBe(401)`.
4. Parsea: `errorResponseSchema.parse(await res.json())`.
5. Si la API route retorna 200 con shape incorrecta, el test #4 falla
   con detalle del path que no matchea.

### Cuando el patron NO alcanza

El Bug 2 es un page route (`/geovisor`), no un API endpoint. Los
tests de API no van a detectarlo porque el proxy/middleware bloquea
a nivel de page request, no de API. El patron zod funciona
principalmente para:

- API routes: el test anti-Bug-2 es directo
- Page routes: el test es a nivel de `proxy.ts` matcher y del callback
  `authorized` en `lib/auth.config.ts`

Para page routes, la guia actual (pasos 1-3) sigue siendo el approach
correcto. Los tests zod complementan, no reemplazan.
