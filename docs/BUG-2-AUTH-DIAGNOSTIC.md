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
