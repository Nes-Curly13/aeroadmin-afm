"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plane } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuraBackground } from "@/components/aura-background";

/**
 * Login page (Client Component).
 *
 * Sprint 3 (Opcion A): form nativo con action-as-state para evitar
 * re-renders innecesarios. La accion del server maneja la auth via
 * NextAuth v5 + bcrypt contra `app_users`.
 *
 * v2.3 (S8 — V0 rebuild): visuales portados a los primitives V0
 * (Card / Button / iconografía lucide).
 *
 * v2.4 (Sprint 2026-08-15): fondo con `AuraBackground` (Sunrise Drift
 * sobre la paleta AFM — verde/teal/lime/azul). Ver `app/globals.css`
 * para la arquitectura de las capas. La base sigue siendo el
 * `bg-background` del body, removido el `bg-background` del <main>
 * para que las capas en multiply compongan contra el body.
 *
 * v2.7.5 (Sprint S8 2026-08-29): reescrito el submit para usar
 * `fetch` contra el endpoint estándar de NextAuth
 * `/api/auth/callback/credentials` en vez del server action. El
 * server action con `useActionState` + `signIn` from
 * `@/lib/auth.ts` fallaba en producción con 303 a /login sin error
 * visible (bug conocido de Next.js 16 + NextAuth v5 server actions
 * en deploy serverless). El endpoint de NextAuth responde bien
 * (verificado en E2E prod 2026-08-23: BAD → 200 /login?error=...,
 * GOOD → 200 / con cookie de sesion). Esta implementacion:
 *   1. GET /api/auth/csrf para obtener token + cookie
 *   2. POST /api/auth/callback/credentials con csrfToken en body
 *   3. Check `resp.url` para distinguir exito (final URL = /) vs
 *      fallo (final URL contiene ?error=CredentialsSignin)
 *   4. Si exito: router.push("/") + router.refresh()
 *   5. Si fallo: set error state
 */

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      setError("Email y password son obligatorios.");
      return;
    }

    startTransition(async () => {
      try {
        // 1) CSRF token + cookie
        const csrfRes = await fetch("/api/auth/csrf", { credentials: "same-origin" });
        if (!csrfRes.ok) {
          setError("No se pudo obtener el token CSRF. Recargá la página.");
          return;
        }
        const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

        // 2) POST al callback de NextAuth. Usamos `redirect: "follow"`
        //    (default) para que la cookie Set-Cookie se establezca y la
        //    URL final refleje exito vs error.
        const body = new URLSearchParams({
          csrfToken,
          email,
          password,
          callbackUrl: "/",
          json: "true",
        });
        const authRes = await fetch("/api/auth/callback/credentials", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          credentials: "same-origin",
        });

        // 3) Distinguish: NextAuth redirects to / on success, or to
        //    /login?error=CredentialsSignin&code=credentials on failure.
        //    En ambos casos el status final es 200 (porque fetch sigue
        //    el redirect), pero la URL final distingue.
        const finalUrl = authRes.url;
        if (finalUrl.includes("/login") && finalUrl.includes("error=")) {
          setError("Email o password incorrectos.");
          return;
        }

        // 4) Verificamos sesion explicita para evitar "falsos positivos"
        //    en caso de un edge case (ej. cookies third-party).
        const sessionRes = await fetch("/api/auth/session", { credentials: "same-origin" });
        const session = (await sessionRes.json()) as { user?: { email: string } };
        if (!session?.user) {
          setError("No se pudo iniciar sesión. Intentá de nuevo.");
          return;
        }

        // 5) Éxito: navegar al panel. Usamos `window.location.href` en
        //    vez de `router.push` + `router.refresh` por una sutileza:
        //    cuando el form está en `/login` (que es un path PUBLIC para
        //    el middleware), `router.push("/")` no navega porque Next.js
        //    no detecta cambio de URL. Con `window.location.href` se
        //    fuerza un hard navigation que el middleware sí procesa con
        //    la cookie de sesion nueva, y el server component del
        //    dashboard ve la sesion real (no cacheada).
        window.location.href = "/";
      } catch (err) {
        setError("Error de conexión. Intentá de nuevo.");
      }
    });
  }

  return (
    <AuraBackground>
      <main className="flex min-h-svh items-center justify-center p-4">
        <Card className="w-full max-w-sm gap-0 py-6">
          <CardHeader className="items-center gap-3 px-6 pb-4">
            <div className="grid size-12 place-items-center rounded-lg bg-primary/10 text-primary">
              <Plane className="size-6" aria-hidden />
            </div>
            <div className="flex flex-col items-center gap-1">
              <CardTitle className="text-lg">AeroAdmin AFM</CardTitle>
              <CardDescription>Panel admin — Iniciar sesion</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-6">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Email
                </span>
                <input
                  autoComplete="email"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
                  disabled={pending}
                  name="email"
                  placeholder="piloto@afm.local"
                  required
                  type="email"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Password
                </span>
                <input
                  autoComplete="current-password"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
                  disabled={pending}
                  name="password"
                  placeholder="••••••••"
                  required
                  type="password"
                />
              </label>
              {error ? (
                <p
                  aria-live="polite"
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              <Button disabled={pending} size="default" type="submit" className="w-full">
                {pending ? "Validando..." : "Ingresar"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </AuraBackground>
  );
}
