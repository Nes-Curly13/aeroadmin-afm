import { handlers } from "@/lib/auth";

/**
 * NextAuth (Auth.js v5) — handler de las rutas /api/auth/*.
 * Re-export del objeto `handlers` que arma NextAuth() con la config en
 * `lib/auth.ts`. NextAuth expone GET y POST en este mismo route; el
 * server hace dispatch según la operacion (signin, signout, callback, etc).
 */
export const { GET, POST } = handlers;
