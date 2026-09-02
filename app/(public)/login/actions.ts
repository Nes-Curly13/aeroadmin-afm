"use server";

import { signOut } from "@/lib/auth";

/**
 * Server actions para logout.
 *
 * v2.7.5 (Sprint S8 2026-08-29): eliminamos `loginAction` y el wrapper
 * `LoginResult` porque el login ahora va por el cliente (fetch al
 * endpoint `/api/auth/callback/credentials` — ver `page.tsx`). El
 * server action con `signIn` from `@/lib/auth.ts` fallaba en
 * produccion con Next.js 16 (303 a /login sin error visible). El
 * logout sigue siendo server action porque ahi no hay redirect
 * confuso: `signOut` borra la cookie y redirige a /login.
 */

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
