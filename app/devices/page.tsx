import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { DeviceGrid } from "@/components/devices/device-grid";
import { auth } from "@/lib/auth";
import { normalizeRole } from "@/lib/auth/role-display";
import { DEFAULT_DEVICES } from "@/lib/devices";

/**
 * /devices — Gestion de dispositivos.
 *
 * Track B v1.4 — UI gates por role:
 *   - Si el user es supervisor (no admin) -> redirect("/").
 *     El banner "Proximamente" y la grilla son contenido admin-only
 *     (gestion de flota, alta/baja de equipos). El supervisor no
 *     necesita verlos.
 *   - Si el user es admin -> renderiza la pagina completa.
 *   - Si no hay sesion -> el middleware Edge (proxy.ts) ya redirige
 *     a /login antes de llegar aca. La lectura de `auth()` es
 *     defensiva: si por algun motivo pasa sin sesion, redirect a /.
 *
 * El redirect es server-side (no client-side gate) porque esta
 * pagina es server component y el server es la unica fuente de
 * verdad que el usuario no puede bypassear. Un RoleGate client
 * ocultaria la UI pero un curl podria leer la pagina igual.
 */
export default async function DevicesPage() {
  const session = await auth();
  const user = session?.user as { role?: string | null } | undefined;
  const role = normalizeRole(user?.role);

  if (role !== "admin") {
    // Supervisor (o sin sesion, defensivo) -> fuera.
    redirect("/");
  }

  return (
    <AppShell
      actions={
        <div className="rounded-full border border-[#cfd8d3] bg-white px-4 py-2 text-sm font-semibold text-[#4a5b50]">
          Gestión de dispositivos
        </div>
      }
      activeSection="devices"
      eyebrow="Configuración"
      subtitle="Vista previa del inventario de la flota. El CRUD real se habilitará cuando esté la auth (S3 del roadmap)."
      title="Dispositivos"
      // v1.5: el role ya está validado arriba (redirect a / si != admin).
      // Pasarlo al sidebar mantiene coherencia visual (ocultar /devices
      // no tiene efecto porque el supervisor no llega a esta page, pero
      // si en el futuro se permite ver algo del listado sin redirect, el
      // sidebar ya queda consistente).
      viewerRole={role}
    >
      <div
        className="mb-6 rounded-2xl border border-[#d4b23c] bg-[#fff8e3] p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
        role="status"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#d4b23c] text-sm font-bold text-[#7a5f0d]"
          >
            i
          </span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#7a5f0d]">
              Próximamente
            </p>
            <p className="mt-1 text-sm text-[#121815]">
              La lista de dispositivos es ilustrativa (datos hardcodeados). El inventario
              real y el alta/edición/baja de dispositivos se habilitarán cuando se implemente
              autenticación (S3 del roadmap de auditoría, sesión 2026-06-28).
            </p>
          </div>
        </div>
      </div>
      {/* showAddPlaceholder=false: la page /devices está en modo "Próximamente"
          (audit ui-ux-2026-07 §4.3). El banner amarillo ya comunica el estado, así
          que renderizar el card "+ Agregar dispositivo" solo agregaría ruido UX
          (el operador cliquea esperando hacer algo y no pasa nada). El card vuelve
          a aparecer cuando se habilite el CRUD real (S3 del roadmap).

          Track B v1.4: el banner y la grilla solo se muestran para admin (el
          redirect de arriba ya filtro al supervisor). Esto centraliza la
          decision de acceso en el server. */}
      <DeviceGrid devices={DEFAULT_DEVICES} showAddPlaceholder={false} />
    </AppShell>
  );
}
