/**
 * Middleware — protege todas las rutas excepto login + NextAuth handler.
 *
 * Sprint 3 (Opcion A): este middleware es la primera linea de defensa.
 * Usa el `authorized` callback de NextAuth (definido en `lib/auth.ts`)
 * para evaluar cada request en el Edge runtime.
 *
 * Por qué Edge runtime (no Node):
 *   - Es lo que Next.js ejecuta antes de SSR. Tener la auth aqui evita
 *     que ni siquiera se rendericen pages si el usuario no esta logueado
 *     → 0 costo de BD/JS para requests no autorizados.
 *   - Se compila a un Edge Function y corre en <5ms t\u00edpicamente.
 *
 * Por qué NO usa `request.cookies` directo: ya lo hace NextAuth por
 * nosotros via `auth()`. Solo delegamos.
 */

import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth";

const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  /**
   * Matcher: todo excepto assets estaticos y Next.js internals.
   * Dejamos `/login` y `/api/auth/*` pasar — el `authorized` callback
   * se encarga de aceptar/rechazar.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|public|api/auth).*)"
  ]
};
