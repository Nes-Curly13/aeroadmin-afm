/**
 * Global setup para Playwright — Sprint S8.2 (2026-07-29).
 *
 * Crea (o resetea) el usuario E2E en `app_users` antes de que la suite arranque.
 * Idempotente: si ya existe, el UPSERT del seed script actualiza password +
 * role=admin + is_active=true.
 *
 * Variables:
 *   - E2E_USER_EMAIL (default e2e@aeroadmin.local)
 *   - E2E_USER_PASSWORD (default E2ETest12345!)
 *
 * Si la BD no está disponible, el test suite falla en el primer login —
 * el error es claro (no se pudo autenticar) y dejamos que el caller
 * sepa que necesita `npm run db:init` + `npm run auth:seed` primero.
 *
 * Sprint S8.2: este setup es compartido con auth-and-dashboard.spec.ts
 * (test 7 /admin/parcels) y admin-parcels.spec.ts (PATCH /api/admin/
 * parcels/[id]/metadata). El usuario E2E debe ser role=admin para
 * ambos.
 */

import { execSync } from "node:child_process";

const email = process.env.E2E_USER_EMAIL ?? "e2e@aeroadmin.local";
const password = process.env.E2E_USER_PASSWORD ?? "E2ETest12345!";

export default async function globalSetup(): Promise<void> {
  console.log(`[playwright global-setup] seeding admin user: ${email}`);
  execSync(
    `node scripts/seed-admin-user.js --email=${email} --password=${password} --role=admin`,
    {
      stdio: "inherit",
      env: {
        ...process.env
      }
    }
  );
}
