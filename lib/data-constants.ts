// lib/data-constants.ts
//
// V0 constants que se usan TANTO desde server pages (lib/data.ts) como
// desde client components (geovisor-client, parcels-table, etc).
//
// Por qué este archivo existe separado de `lib/data.ts`:
//
// `lib/data.ts` arranca con `import "server-only"` y `import { readFile }
// from "node:fs/promises"` (vía `lib/djiag-health.ts`). Si un Client
// Component importa CUALQUIER cosa desde `lib/data.ts`, Turbopack arrastra
// el módulo entero al bundle del cliente → "the chunking context
// (unknown) does not support external modules (request: node:fs/promises)".
//
// Solución: este archivo es PURO (sin imports Node-only) y exporta
// solo constantes / tipos. Los Client Components importan de acá.
// `lib/data.ts` re-exporta para que los server pages puedan seguir
// usando la convención del V0 mockup (`import { NOW } from "@/lib/data"`).

import type { ComplianceStatus, DroneModelId } from "@/lib/types";

/** Fecha de referencia para "ahora". En el server, computa `new Date()`;
 *  en el client, se re-asigna en cada render (es la fecha del request,
 *  no del bundle). */
export const NOW = new Date();

export const DRONE_MODELS: { id: DroneModelId; name: string; tank_l: number; color: string }[] = [
  { id: 0, name: "Sin asignar", tank_l: 0, color: "oklch(0.62 0.02 250)" },
  { id: 72, name: "Agras T16 / T20", tank_l: 20, color: "oklch(0.55 0.12 250)" },
  { id: 201, name: "Agras T40 / T50", tank_l: 40, color: "oklch(0.53 0.076 190)" },
  { id: 210, name: "Agras T70", tank_l: 70, color: "oklch(0.42 0.09 150)" }
];

export const droneModel = (id: DroneModelId) =>
  DRONE_MODELS.find((m) => m.id === id) ?? DRONE_MODELS[0];

export function complianceStatus(daysToDue: number | null): ComplianceStatus {
  if (daysToDue === null) return "critico";
  if (daysToDue > 5) return "al_dia";
  if (daysToDue >= 0) return "por_vencer";
  if (daysToDue >= -10) return "vencido";
  return "critico";
}

export const STATUS_META: Record<
  ComplianceStatus,
  { label: string; color: string; token: string }
> = {
  al_dia: { label: "Al día", color: "#3f8f5d", token: "var(--chart-1)" },
  por_vencer: { label: "Por vencer", color: "#16847e", token: "var(--chart-2)" },
  vencido: { label: "Vencido", color: "#e0b500", token: "var(--chart-4)" },
  critico: { label: "Crítico", color: "#c0392b", token: "var(--destructive)" }
};

export type { ComplianceStatus, DroneModelId };
