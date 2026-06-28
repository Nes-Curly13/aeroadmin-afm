"use server";

import { signIn, signOut } from "@/lib/auth";
import { AuthError } from "next-auth";

/**
 * Server actions para login / logout.
 *
 * Sprint 3 (Opcion A): usamos el `signIn`/`signOut` de NextAuth v5
 * directamente, sin helpers intermedios. Solo anadimos manejo del
 * `AuthError` para devolver mensajes user-friendly en vez del stack
 * tecnico ("CallbackRouteError: ...") que Auth.js devolveria por default.
 */

export type LoginResult =
  | { ok: true }
  | { ok: false; error: string };

export async function loginAction(
  _prevState: LoginResult | null,
  formData: FormData
): Promise<LoginResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { ok: false, error: "Email y password son obligatorios." };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/"
    });
    // Si llego aca, signIn() no redirigio (raro). Devolvemos ok de todos
    // modos para que el cliente no bloquee.
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthError) {
      // CredentialsSignin = credenciales invalidas (user no existe o pwd mal).
      if (err.type === "CredentialsSignin") {
        return { ok: false, error: "Email o password incorrectos." };
      }
      return { ok: false, error: "No se pudo iniciar sesion. Intenta de nuevo." };
    }
    // Re-throw de NEXT_REDIRECT etc. — Auth.js usa redirect signals que no
    // deben ser capturados.
    throw err;
  }
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
