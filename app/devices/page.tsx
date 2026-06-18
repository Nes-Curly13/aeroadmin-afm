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
      subtitle="Inventario de la flota y dispositivos auxiliares (sensores, RTK). La gestión CRUD se habilitará en una iteración posterior."
      title="Dispositivos"
    >
      <DeviceGrid devices={DEFAULT_DEVICES} showAddPlaceholder />
    </AppShell>
  );
}
