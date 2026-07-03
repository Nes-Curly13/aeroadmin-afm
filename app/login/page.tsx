"use client";

import { useActionState } from "react";
import { loginAction, type LoginResult } from "./actions";

/**
 * Login page (Client Component).
 *
 * Sprint 3 (Opcion A): form nativo con action-as-state para evitar
 * re-renders innecesarios. La accion del server maneja la auth via
 * NextAuth v5 + bcrypt contra `app_users`.
 *
 * Decisiones UX:
 *   - Email lowercase automatico en el server action.
 *   - Password NUNCA se loguea ni se devuelve al cliente.
 *   - Mensaje de error generico ("email o password incorrectos") para
 *     no filtrar cual de los dos fallo (mitigacion de user-enum).
 *   - Submit disabled mientras loading para evitar doble-submit.
 *   - Sin "recordarme" en Opcion A: la sesion dura 12h fijo.
 */

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<LoginResult | null, FormData>(
    loginAction,
    null
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f0f4f1] p-4">
      <div className="w-full max-w-sm rounded-2xl border border-[#d2ddd6] bg-white p-8 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
        <header className="mb-6 flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt="AeroAdmin AFM"
            className="h-14 w-auto"
            src="/logo.svg"
          />
          <h1 className="text-xl font-black text-[#121815]">AeroAdmin AFM</h1>
          <p className="text-sm text-[#4a5b50]">Panel admin — Iniciar sesion</p>
        </header>
        <form action={formAction} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#587064]">
              Email
            </span>
            <input
              autoComplete="email"
              className="w-full rounded-lg border border-[#d2ddd6] px-3 py-2 text-sm text-[#121815] focus:border-[#0b5f2d] focus:outline-none"
              disabled={pending}
              name="email"
              required
              type="email"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#587064]">
              Password
            </span>
            <input
              autoComplete="current-password"
              className="w-full rounded-lg border border-[#d2ddd6] px-3 py-2 text-sm text-[#121815] focus:border-[#0b5f2d] focus:outline-none"
              disabled={pending}
              name="password"
              required
              type="password"
            />
          </label>
          {state && !state.ok && (
            <p
              className="rounded-lg border border-[#f4caca] bg-[#fff5f5] px-3 py-2 text-sm text-[#a93232]"
              role="alert"
            >
              {state.error}
            </p>
          )}
          <button
            className="w-full rounded-lg bg-[#0b5f2d] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0d7a3a] disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            {pending ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
        <footer className="mt-6 text-center text-xs text-[#4a5b50]">
          Acceso restringido — Operadores autorizados.
        </footer>
      </div>
    </main>
  );
}
