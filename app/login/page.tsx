"use client";

import { useActionState } from "react";
import { loginAction, type LoginResult } from "./actions";
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
 */

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<LoginResult | null, FormData>(
    loginAction,
    null
  );

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
          <form action={formAction} className="flex flex-col gap-4">
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
            {state && state.ok === false ? (
              <p
                aria-live="polite"
                className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive"
                role="alert"
              >
                {state.error}
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
