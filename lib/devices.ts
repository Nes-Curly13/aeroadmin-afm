export type DeviceKind = "drone" | "sensor" | "gps";

export type DeviceStatus = "active" | "connected" | "rtk_fix" | "warning" | "offline";

export interface Device {
  name: string;
  model: string;
  status: DeviceStatus;
  kind: DeviceKind;
  detailA: string;
  detailB: string;
}

export interface DeviceKindMeta {
  icon: string;
  detailALabel: string;
  detailBLabel: string;
}

export interface DeviceStatusMeta {
  label: string;
  badgeClass: string;
}

export const DEVICE_KIND_META: Record<DeviceKind, DeviceKindMeta> = {
  drone: { icon: "flight", detailALabel: "Batería", detailBLabel: "Horas de vuelo" },
  sensor: { icon: "sensors", detailALabel: "Temperatura", detailBLabel: "Humedad" },
  gps: { icon: "gps_fixed", detailALabel: "Satélites", detailBLabel: "Precisión" }
};

export const DEVICE_STATUS_META: Record<DeviceStatus, DeviceStatusMeta> = {
  active: { label: "Activo", badgeClass: "text-[#0b5f2d]" },
  connected: { label: "Conectado", badgeClass: "text-[#1f4d80]" },
  rtk_fix: { label: "Fix RTK", badgeClass: "text-[#7b6b1e]" },
  warning: { label: "Atención", badgeClass: "text-[#7a1d1d]" },
  offline: { label: "Sin conexión", badgeClass: "text-[#4a5b50]" }
};

export const DEFAULT_DEVICES: Device[] = [
  {
    name: "Drone Principal",
    model: "DJI Agras T40",
    status: "active",
    kind: "drone",
    detailA: "85%",
    detailB: "127 h"
  },
  {
    name: "Estación Meteorológica",
    model: "Davis Vantage Pro2",
    status: "connected",
    kind: "sensor",
    detailA: "28°C",
    detailB: "65%"
  },
  {
    name: "RTK Base",
    model: "Emlid Reach RS2",
    status: "rtk_fix",
    kind: "gps",
    detailA: "18 satélites",
    detailB: "±1 cm"
  }
];
