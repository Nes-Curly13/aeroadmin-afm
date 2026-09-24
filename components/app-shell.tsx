import { auth } from "@/lib/auth"
import type { AppRole } from "@/lib/auth/role"
import { ShellLayout } from "./shell-layout"

/**
 * AppShell — sidebar + main wrapper.
 *
 * v2.8 (Sprint 2026-08-04 — UX): top header con email + role del
 * usuario actual. `await auth()` lee del JWT (no pega a la BD).
 *
 * PR-2 (auditoría UI, 2026-09-20): este componente queda como
 * **wrapper server** (auth + props) y delega el chrome interactivo a
 * `<ShellLayout />` (client), que es la **única** implementación del
 * sidebar (con drawer mobile). Ver components/shell-layout.tsx.
 *
 * 2026-09-21: se quitó el prop `health` (panel de salud del pipeline DJI
 * AG). El scraper ya no corre; el shell no muestra indicador de pipeline.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  // Sesión actual (lee del JWT firmado, no query a la BD).
  // El middleware ya filtra /admin/* por role, así que si llegamos
  // acá siempre hay sesión — pero el `?` es defensa.
  const session = await auth();
  const user = session?.user;
  const role: AppRole | undefined = user?.role;

  return (
    <ShellLayout user={user} role={role}>
      {children}
    </ShellLayout>
  );
}
