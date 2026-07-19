import { AppShell } from "@/components/app-shell";
import { DeviceGrid } from "@/components/devices/device-grid";
import { DEFAULT_DEVICES } from "@/lib/devices";

export default function DevicesPage() {
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
          a aparecer cuando se habilite el CRUD real (S3 del roadmap). */}
      <DeviceGrid devices={DEFAULT_DEVICES} showAddPlaceholder={false} />
    </AppShell>
  );
}
