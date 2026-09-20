import { auth } from "@/lib/auth"
import type { AppRole } from "@/lib/auth/role"
import type { DjiAgHealth } from "@/lib/types"
import { ShellLayout } from "./shell-layout"

/**
 * AppShell — sidebar + main wrapper.
 *
 * v2.3 (S8 — V0 rebuild): recibe `health` por prop en vez de llamar
 * `getHealth()` adentro. Razón: si este componente importa `getHealth`
 * desde `@/lib/data` (server-only), Turbopack arrastra `lib/djiag-health`
 * (con `node:fs/promises`) al bundle del cliente cuando el children es
 * un Client Component → "the chunking context (unknown) does not support
 * external modules".
 *
 * v2.3.2 (S8.2 — leak fix): `health` ahora es OPCIONAL. El layout NO
 * llama `getHealth()` en cada request (causaba leak de ~3MB/req que
 * tumbaba el dev server en ~30 reqs). Si el caller (e.g. un page
 * server que sí necesita health) lo pasa por prop, se muestra el
 * badge; si no, el sidebar oculta el indicador de pipeline.
 *
 * v2.8 (Sprint 2026-08-04 — UX): top header con email + role del
 * usuario actual. `await auth()` lee del JWT (no pega a la BD).
 *
 * PR-2 (auditoría UI, 2026-09-20): este componente queda como
 * **wrapper server** (auth + props) y delega el chrome interactivo a
 * `<ShellLayout />` (client), que es la **única** implementación del
 * sidebar (con drawer mobile). Ver components/shell-layout.tsx.
 */
export async function AppShell({
  children,
  health
}: {
  children: React.ReactNode;
  health?: DjiAgHealth;
}) {
  // Sesión actual (lee del JWT firmado, no query a la BD).
  // El middleware ya filtra /admin/* por role, así que si llegamos
  // acá siempre hay sesión — pero el `?` es defensa.
  const session = await auth();
  const user = session?.user;
  const role: AppRole | undefined = user?.role;

  return (
    <ShellLayout health={health} user={user} role={role}>
      {children}
    </ShellLayout>
  );
}
