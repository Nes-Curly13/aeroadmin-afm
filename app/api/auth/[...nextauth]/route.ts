import { handlers } from "@/lib/auth";

/**
 * NextAuth (Auth.js v5) — handler de las rutas /api/auth/*.
 * Re-export del objeto `handlers` que arma NextAuth() con la config en
 * `lib/auth.ts`. No tocar: la lógica vive en `authConfig.callbacks`.
 */
export const { GET, POST } = handlers;
