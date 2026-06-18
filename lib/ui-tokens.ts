import type { AlertLevel } from "@/lib/types";

/**
 * Tokens de diseño de AeroAdmin AFM.
 *
 * Single source of truth para colores, spacing y elevation.
 * Los componentes referencian estos tokens para garantizar coherencia
 * con la paleta ya existente en el repo (verde AeroCrop + cálidos).
 *
 * Nota: los hex siguen apareciendo inline en clases Tailwind
 * (e.g. `border-[#0b5f2d]`) por compatibilidad con el tree-shaking
 * de Tailwind 4. Esto es intencional — los tokens son la **referencia
 * semántica**; el bundler no los trata distinto a un literal.
 */

export const COLORS = Object.freeze({
  primary: "#0b5f2d",
  "primary-active": "#2c7f44",
  "primary-soft": "#dbe7df",
  "primary-soft-text": "#9fceb0",
  success: "#2c7f44",
  warning: "#c7a43a",
  "warning-soft": "#fff9e7",
  danger: "#a93232",
  "danger-strong": "#7a1d1d",
  "danger-soft": "#fff0ee",
  info: "#1f4d80",
  neutral: "#4a5b50",
  "neutral-strong": "#121815",
  "neutral-medium": "#587064",
  "neutral-soft": "#f4f7f4",
  "border-cool": "#d2ddd6",
  "border-cool-2": "#cfd8d3",
  "border-warm": "#e2bfb0",
  surface: "#ffffff",
  background: "#f7f9fb",
  "sidebar-bg": "#0f1713",
  "report-bg": "#101814"
});

export const SPACING = Object.freeze({
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32
});

export const ELEVATION = Object.freeze({
  card: "0px 18px 40px rgba(15,23,42,0.08)",
  panel: "0px 18px 40px rgba(15,23,42,0.18)",
  overlay: "0px 8px 24px rgba(15,23,42,0.24)"
});

export type UiTone = "default" | "success" | "warning" | "danger" | "info";

/**
 * Mapea el nivel de una alerta a un tono semántico del UI.
 * Sirve para colorear badges, bordes, fondos y textos consistentemente.
 */
export function getStatusTone(level: AlertLevel): UiTone {
  if (level === "HIGH") return "danger";
  if (level === "MEDIUM") return "warning";
  return "success";
}

/**
 * Decide el tono del KPI del dashboard según la métrica.
 * Convención:
 *   - default para contadores neutros (vuelos)
 *   - success para cobertura (positivo)
 *   - info para catálogos / assets
 *   - danger para alertas / riesgo
 * Métrica desconocida -> default (fallback seguro).
 */
export function getDashboardKpiTone(metric: keyof DashboardKpiToneMap): UiTone {
  return DASHBOARD_KPI_TONE_MAP[metric] ?? "default";
}

type DashboardKpiToneMap = {
  totalFlights: never;
  totalAreaCovered: never;
  totalAssets: never;
  highAlertParcels: never;
};

const DASHBOARD_KPI_TONE_MAP: Record<string, UiTone> = Object.freeze({
  totalFlights: "default",
  totalAreaCovered: "success",
  totalAssets: "info",
  highAlertParcels: "danger"
});
