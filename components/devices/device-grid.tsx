import { DEVICE_KIND_META, DEVICE_STATUS_META, type Device } from "@/lib/devices";

export interface DeviceGridProps {
  devices: Device[];
  showAddPlaceholder?: boolean;
}

export function DeviceGrid({ devices, showAddPlaceholder = false }: DeviceGridProps) {
  if (devices.length === 0) {
    return (
      <div className="rounded-2xl border border-[#d2ddd6] bg-white p-10 text-center text-sm text-[#4a5b50] shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
        No hay dispositivos registrados.
      </div>
    );
  }

  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {devices.map((device, index) => {
        const kindMeta = DEVICE_KIND_META[device.kind];
        const statusMeta = DEVICE_STATUS_META[device.status];
        return (
          <div
            className="rounded-2xl border border-[#d2ddd6] bg-white p-6 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
            data-testid={`device-card-${index}`}
            key={device.name}
          >
            <div className="mb-4 flex items-center gap-3">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-full text-white ${
                  device.kind === "drone"
                    ? "bg-[#0b5f2d]"
                    : device.kind === "sensor"
                      ? "bg-[#587064]"
                      : "bg-[#7b6b1e]"
                }`}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  {kindMeta.icon}
                </span>
              </div>
              <div>
                <h3 className="font-bold text-[#121815]">{device.name}</h3>
                <p className="text-xs text-[#4a5b50]">{device.model}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#4a5b50]">Estado</span>
                <span className={`font-semibold ${statusMeta.badgeClass}`}>{statusMeta.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#4a5b50]">{kindMeta.detailALabel}</span>
                <span className="font-semibold text-[#121815]">{device.detailA}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#4a5b50]">{kindMeta.detailBLabel}</span>
                <span className="font-semibold text-[#121815]">{device.detailB}</span>
              </div>
            </div>
          </div>
        );
      })}

      {showAddPlaceholder ? (
        <div
          className="flex cursor-not-allowed items-center justify-center rounded-2xl border-2 border-dashed border-[#cfd8d3] bg-white/50 p-6 opacity-60 shadow-[0px_18px_40px_rgba(15,23,42,0.04)]"
          title="Próximamente"
        >
          <div className="text-center">
            <span className="material-symbols-outlined text-4xl text-[#4a5b50]" aria-hidden="true">
              add_circle
            </span>
            <p className="mt-2 text-sm font-semibold text-[#4a5b50]">+ Agregar dispositivo</p>
            <p className="mt-1 text-xs text-[#4a5b50]">Próximamente</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
